//! omp, the `oh-my-pi` fork of pi, over `omp --mode rpc`.
//!
//! One child per session, speaking LF-delimited JSON in both directions. See
//! `apps/desktop/OMP-PLAN.md` for the design, the rejected alternatives and the
//! captured protocol the parser was written against.
//!
//! **This is a fork of the pi harness rather than a new one.** The framing is
//! pi's, most of the vocabulary is pi's, and `harness/rpc.rs` is the shared seam
//! both sit on. Four things differ, and each is stated where it bites:
//!
//! - **`ready` on spawn**, where pi says nothing. Harmless — it falls through to
//!   the event side and the reader drops it — but it is why this does not need
//!   pi's "silence is indistinguishable from a slow start" reasoning.
//! - **`agent_end` closes the turn**, and there is no `agent_settled`. The
//!   mapper's job, and the one thing here that strands a session if it is wrong.
//! - **The command list is pushed**, so `list_slash_commands` probes rather than
//!   reading a stream. See [`commands`].
//! - **Nothing here steers.** pi's mid-turn path is `streamingBehavior: "steer"`
//!   and omp has the same field — but its `abort` does not clear the queue, so a
//!   steered prompt keeps running after a Stop. OMP-PLAN.md §7 has the trace and
//!   the measured repro; until upstream lands `clear_queue`, the prompt is held
//!   in Dray's own queue and flushed at a boundary. The cost is named there: a
//!   prompt typed mid-turn lands on the next turn rather than inside this one.
//!
//! **`DRAY_OMP_TRACE=1` echoes every line read off omp**, tagged by session. A
//! line that reaches the mapper and draws nothing is otherwise invisible: it is
//! not a parse failure, so it is not in `parse_failures.jsonl`, and it is not a
//! mapped event, so it is not in the session log.

pub mod commands;
pub mod dialog;
pub mod mapper;
pub mod models;
pub mod parser;
pub mod rpc;

use crate::events::{AgentEvent, AgentEventPayload, ApprovalPolicy, TurnStatus};
use crate::harness::claude_code::permissions::PendingPermissions;
use crate::harness::{record_failure, Harness::Omp};
use crate::models::{Effort, Model};
use crate::session::{QueuedMessages, Session, StatusTracker, Transport};
use crate::store::{self, next_seq_by_session_id};
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, ChildStdout, Command},
    sync::Mutex,
};

use rpc::{Incoming, OmpClient, HANDSHAKE_TIMEOUT};

/// Appended to omp's own system prompt, never replacing it.
///
/// omp's own file, not pi's shared one: pi's names `AskUserQuestion` and the
/// Agent tool, and while omp has answers for both, the file is Dray's rules and
/// states nothing about either. Copied once here so a later edit to one harness's
/// prompt cannot silently change the other's.
///
/// Applied on every spawn, resume included, because a system prompt is
/// per-process and no CLI carries one across a resume.
const APPEND_SYSTEM_PROMPT: &str = include_str!("system_prompt.md");

/// omp's read-only tools, and the whole of what `Plan` means here.
///
/// An allowlist rather than a list of tools to withhold, and that is the half
/// that matters: **omp extensions and plugins register their own tools**, under
/// names this build has never seen, and any of them can write files or run
/// commands. A blocklist would let every one of those through under the one
/// stance a reader picks precisely because it cannot write. An allowlist gets an
/// unknown read-only tool wrong in the safe direction — it is simply not there.
///
/// `lsp` is deliberately absent even though it reads: omp's LSP surface includes
/// renames and code actions, which write.
const PLAN_TOOLS: [&str; 3] = ["read", "grep", "glob"];

/// The `--tools` allowlist a stance wants, or `None` for every tool omp has.
///
/// `Plan` is the one stance omp can enforce *here*, and it enforces it properly:
/// `--tools` is fixed for the process and applies to extension tools too, so a
/// plan-mode omp is read-only by construction rather than by instruction.
///
/// Every other stance passes nothing, and that is this slice's shape rather than
/// omp's limit. omp *does* have a native gate — `--approval-mode
/// (always-ask|write|yolo)`, and it raises its own approval card, which
/// [`dialog`] draws — but which of the three corresponds to Dray's `auto`, and
/// what `write` means precisely, is not verified against a capture yet. OMP-PLAN
/// §6 and slice 2 own that; guessing here would set a session freer or stricter
/// than the reader asked for, and the picker does not offer omp's stances until
/// then either (`HONOURED` in `permission.ts`).
fn tools_for(mode: ApprovalPolicy) -> Option<Vec<&'static str>> {
    match mode {
        ApprovalPolicy::Plan => Some(PLAN_TOOLS.to_vec()),
        _ => None,
    }
}

/// The last few lines omp wrote to stderr, kept for a failed handshake.
///
/// Shared with the reader task rather than returned by it, because the failure
/// path reads it from the *spawning* half — the reader is still running, or has
/// only just ended, when the handshake gives up.
type StderrTail = Arc<std::sync::Mutex<Vec<String>>>;

/// How many of those lines are kept. Only the end of a failing start is ever
/// read, and a chatty child would otherwise grow this for the life of the
/// session.
const STDERR_TAIL_LINES: usize = 8;

fn stderr_said(tail: &StderrTail) -> String {
    tail.lock().unwrap_or_else(|e| e.into_inner()).join("\n")
}

/// [`crate::harness::read_stderr`] that also keeps the last few lines.
///
/// A copy rather than a change to the shared helper, because the tail is omp's
/// alone: the other four harnesses report a failed start through their own
/// protocols.
async fn read_stderr_keeping(stderr: tokio::process::ChildStderr, tail: StderrTail) -> Result<()> {
    use tokio::io::AsyncBufReadExt;

    let mut lines = tokio::io::BufReader::new(stderr).lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        eprintln!("[omp stderr] {line}");

        let mut kept = tail.lock().unwrap_or_else(|e| e.into_inner());
        kept.push(line);
        if kept.len() > STDERR_TAIL_LINES {
            kept.remove(0);
        }
    }

    Ok(())
}

/// The argument vector for one spawn, minus the binary and the cwd.
///
/// Split out to be tested, because two of these flags are load-bearing in ways
/// a comment cannot check: a wrong model flag makes omp **exit 1 before it will
/// answer anything**, and a wrong tool list silently drops a restriction.
fn launch_args(
    session_file: &std::path::Path,
    model: Option<&Model>,
    effort: Option<Effort>,
    permission_mode: ApprovalPolicy,
    // The session's role, already resolved and wrapped. `None` is the ordinary
    // case and leaves the spawn byte-for-byte what it was before roles existed.
    role: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "--mode".to_string(),
        "rpc".to_string(),
        "--session".to_string(),
        session_file.to_string_lossy().into_owned(),
    ];

    // **One flag, not two, and that is not a preference.** omp's own help marks
    // `--provider` *"legacy; prefer --model"*, and the legacy pair is not merely
    // deprecated — it fails outright for a model whose provider namespaces it:
    //
    //     $ omp --provider opencode-go --model deepseek-v4.1-flash
    //     Model "opencode-go/deepseek-v4.1-flash" not found.
    //
    // omp joins the two and demands that exact catalogue key, which does not
    // exist, and then **exits 1 without answering a single command**. Measured
    // against 18.1.20: the same build answers `get_state` for
    // `--model opencode-go/deepseek-v4.1-flash`, and for
    // `--model commandcode/deepseek/deepseek-v4.1-flash` — the provider whose
    // own model ids already carry a slash.
    //
    // `Model.id` is exactly that qualified spelling, joined once in `models.rs`
    // and used again here, so the index and the spawn cannot disagree about
    // which model a session is on.
    if let Some(model) = model {
        args.push("--model".into());
        args.push(model.id.as_str().to_string());
    }

    // A flag rather than the `set_thinking_level` command next door: both are
    // real, but the flag is applied before the first turn can start, where the
    // command is a round trip after the handshake with a window in between.
    if let Some(effort) = effort {
        args.push("--thinking".into());
        args.push(effort.as_arg().to_string());
    }

    if let Some(tools) = tools_for(permission_mode) {
        args.push("--tools".into());
        args.push(tools.join(","));
    }

    args.push("--append-system-prompt".into());
    // Joined for the same reason Claude Code's is: one flag, one value, and the
    // role goes after what Dray already sends. Resolved by the caller rather
    // than here, so this stays a pure function and a test can assert the
    // argument vector without a store to read.
    args.push(match role {
        Some(role) => format!("{APPEND_SYSTEM_PROMPT}\n\n{role}"),
        None => APPEND_SYSTEM_PROMPT.to_string(),
    });

    args
}

/// Spawns a session's `omp --mode rpc` and handshakes it.
///
/// Takes a resolved [`Model`] like the others, except that for omp it may be
/// absent: omp is multi-provider, so Dray names no default it could be wrong
/// about. With none the flags are omitted and omp's own settings decide, which
/// is both the honest answer and the one its user already configured.
#[allow(clippy::too_many_arguments)]
pub async fn init(
    session_id: &str,
    model: Option<&Model>,
    effort: Option<Effort>,
    permission_mode: ApprovalPolicy,
    cwd: &str,
    session_cwd: &str,
    is_new_session: bool,
    app: &AppHandle,
) -> Result<Session> {
    // The session *file*, not the session id, is omp's resume handle. Dray picks
    // the path and omp mints the id inside it — verified live: two spawns on one
    // path report the same `sessionId`, and `--resume <path>` reports it too. So
    // the path is the one thing Dray gets to choose and the one thing a resume
    // needs.
    let session_file = store::omp_session_file(session_id).await?;
    let role = crate::roles::section_for(session_id).await;
    let args = launch_args(
        &session_file,
        model,
        effort,
        permission_mode,
        role.as_deref(),
    );

    let bin = crate::binpath::omp().await;
    let mut command = Command::new(&bin);

    // Which app the agent's own `dray` calls reach. Dev and release builds listen
    // on different sockets and the CLI's default names the release one.
    if let Some(endpoint) = crate::orchestration::child_endpoint() {
        command.env("DRAY_ENDPOINT", endpoint);
    }

    let mut child = command
        .args(args)
        .current_dir(cwd)
        .env("DRAY_SESSION_ID", session_id)
        .env("PATH", crate::harness::agent_path(&bin))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("couldn't start omp")?;

    let stdin = child.stdin.take().context("failed to take stdin")?;
    let stdout = child.stdout.take().context("failed to take stdout")?;
    let stderr = child.stderr.take().context("failed to take stderr")?;

    let client = OmpClient::new(stdin);

    // omp's own last words, kept for the one caller that needs them: a handshake
    // that fails. `read_stderr` alone copies them to this process's stderr,
    // which is where nobody looks — the reader gets "omp exited during the
    // handshake (exit status: 1)" and nothing else, while omp has already said
    // exactly what was wrong on the pipe beside it.
    let stderr_tail: StderrTail = Default::default();
    let stderr_reader = tokio::spawn({
        let tail = stderr_tail.clone();
        async move {
            if let Err(error) = read_stderr_keeping(stderr, tail).await {
                eprintln!("Failed to read omp stderr: {error}");
            }
        }
    });

    let seq_start: u64 = if is_new_session {
        0
    } else {
        next_seq_by_session_id(session_id).await?
    };
    let seq = Arc::new(AtomicU64::new(seq_start));

    let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let status: Arc<Mutex<StatusTracker>> = Arc::new(Mutex::new(StatusTracker::default()));
    let queued: QueuedMessages = Arc::new(Mutex::new(Vec::new()));
    let pending: PendingPermissions = Default::default();

    // The ring's denominator, filled by the handshake below and read by the
    // mapper at every turn's end. Minted here because the reader has to start
    // *before* that handshake — nothing settles a request except a line off
    // stdout — so the mapper exists a moment before its window does. `0` until
    // then, which draws no ring rather than a wrong one.
    let context_window = Arc::new(AtomicU64::new(0));

    tokio::spawn({
        let client = client.clone();
        let session_id = session_id.to_string();
        let session_cwd = session_cwd.to_string();
        let app = app.clone();
        let events = events.clone();
        let status = status.clone();
        let queued = queued.clone();
        let seq = seq.clone();
        let pending = pending.clone();
        let context_window = context_window.clone();
        async move {
            if let Err(error) = read_stdout(
                stdout,
                client,
                session_id,
                session_cwd,
                events,
                status,
                queued,
                pending,
                seq,
                context_window,
                app,
            )
            .await
            {
                eprintln!("Failed to read omp stdout: {error}");
            }
        }
    });

    // omp writes a `ready` frame before it can answer anything, so unlike pi
    // there *is* a sign of life before this — but it says the process started and
    // nothing about whether it will answer a command. So the handshake is still
    // the proof, and it is also where the ring's denominator comes from.
    let state = client
        .request_within("get_state", Value::Null, HANDSHAKE_TIMEOUT)
        .await;

    let state = match state {
        Ok(state) => state,
        Err(error) => {
            // Everything above is post-spawn, so the child is running with nobody
            // left to talk to it. Killed rather than dropped: a `Child` is not
            // reaped on drop, so every failed start would leave an omp alive for
            // the life of the app.
            //
            // Asked whether it is still there first, because the two failures
            // want different cures and read identically without this: a child
            // that *exited* took its reason with it to stderr, where one still
            // running and silent is omp not answering a command this build sends.
            let died = child.try_wait().ok().flatten();

            // **Waited on, not raced.** An exited child's stderr is closed but
            // not necessarily drained, and omp writes its reason and exits in the
            // same breath — so reading the tail before this task has finished
            // would report the failure as often without its cause as with it.
            // The task ends on EOF, which an exited child has already given it.
            let _ = tokio::time::timeout(Duration::from_secs(2), stderr_reader).await;

            let said = stderr_said(&stderr_tail);
            shutdown(&mut child, &client).await;

            return Err(error).with_context(|| match (died, said.is_empty()) {
                // omp's own sentence, which is the whole reason this is kept:
                // it names the model, the provider, or the login, where "exit
                // status: 1" names nothing a reader can act on.
                (Some(status), false) => {
                    format!("omp exited during the handshake ({status}): {said}")
                }
                (Some(status), true) => format!("omp exited during the handshake ({status})"),
                (None, _) => "omp did not answer the handshake".to_string(),
            });
        }
    };

    // The one number the ring cannot derive. Read off the handshake rather than
    // asked for per turn, which the reader could not do anyway: a request is
    // settled by a line off stdout, so awaiting one inside the read loop waits on
    // itself. Sound for the child's life — Dray respawns for a model change, so
    // nothing moves the window under a running session, and the one case that
    // would (`/model` typed into omp) is re-read on `model_changed` below.
    if let Some(window) = state["model"]["contextWindow"].as_u64() {
        context_window.store(window, Relaxed);
    }
    // The panel's feed: without this a subagent's traffic never reaches the
    // wire at all, and the spawn draws a plain row with nothing nested under
    // it. `events` carries the run's own messages and tool calls; `progress`
    // would leave the panel with a header and no body. Best-effort — a spawn
    // that cannot be subscribed still runs, and its `task` call still draws.
    if let Err(error) = client
        .request(
            "set_subagent_subscription",
            serde_json::json!({"level": "events"}),
        )
        .await
    {
        eprintln!("omp subagent subscription failed: {error:#}");
    }


    Ok(Session {
        id: session_id.to_string(),
        child,
        stdin: Transport::Omp(client),
        harness: Omp,
        // The unset sentinel where omp chose for itself, which is what
        // `models.rs` documents it for.
        model: model.map(|m| m.id.clone()).unwrap_or_default(),
        effort,
        permission_mode,
        events,
        seq,
        status,
        pending_permissions: pending,
        queued,
    })
}

/// Writes one prompt.
///
/// omp answers `success: true` the moment it *accepts* one, and its doc says
/// failures after acceptance arrive through the event stream rather than as a
/// second response. So awaiting this proves the prompt was taken and nothing
/// else — still worth awaiting, because a refusal then reaches the caller as an
/// error instead of as a prompt that vanished.
///
/// **No `streamingBehavior`, and that is deliberate.** omp *requires* it while a
/// turn runs — omitting it there fails rather than queueing — so a prompt
/// reaching this function during a turn would be refused. Dray never sends one
/// during a turn: the omp transport does not steer (see this module's header),
/// so a mid-turn prompt waits in Dray's own queue and is flushed at a boundary,
/// where the child is idle and the field is neither needed nor legal to omit.
pub async fn send_prompt(
    client: &OmpClient,
    text: &str,
    images: &[crate::attachments::PreparedImage],
) -> Result<()> {
    client.request("prompt", prompt_request(text, images)).await?;
    Ok(())
}

/// The `prompt` command's body.
///
/// Split out to be tested. A misspelled field is not refused by omp — its
/// command objects are read permissively — so the failure is a prompt that
/// quietly carried no images, which reads as attachments not being wired at all.
fn prompt_request(text: &str, images: &[crate::attachments::PreparedImage]) -> Value {
    let mut request = json!({"message": text});

    // Omitted when there are none, because `prompt`'s own `images` is optional
    // and an empty array is this build stating something omp already assumes.
    //
    // Not gated on the model taking images: omp resolves the model itself when
    // Dray names none, so the app's copy of that answer can be absent or wrong,
    // and a provider refusing an image is a sentence the reader can act on where
    // silently dropping one is not.
    if !images.is_empty() {
        request["images"] = Value::Array(
            images
                .iter()
                .map(|image| {
                    json!({
                        "type": "image",
                        "data": image.data,
                        "mimeType": image.mime_type,
                    })
                })
                .collect(),
        );
    }

    request
}

/// How long an omp asked to exit is given before it is killed.
///
/// pi's is generous because a kill strands its auth lock onto the next spawn.
/// omp has no such lock, so the reason does not carry — this is kept as an
/// ordinary teardown allowance, long enough for omp to close its session file
/// and its SQLite handles and short enough that a wedged child does not hold a
/// respawn.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

/// Ends an omp, by EOF where it will take one and by force where it will not.
///
/// Every path that stops an omp goes through this. A `Child` is not reaped on
/// drop, so dropping one leaks the process; and asking first is what lets omp run
/// its own teardown rather than dying mid-write.
pub async fn shutdown(child: &mut Child, client: &OmpClient) {
    client.close();

    if tokio::time::timeout(SHUTDOWN_GRACE, child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
    }
}

/// Stops the running turn.
///
/// **`abort` alone, and that is a known gap rather than the whole of a Stop.**
/// pi's Stop is `clear_queue` then `abort`, because a steered prompt is delivered
/// at the next tool-call boundary and aborting alone lets it run. omp has no
/// `clear_queue` on its RPC at all — ten plausible spellings all answered
/// `Unknown command` — and its `abort` does not clear the queue either: OMP-PLAN
/// §7 has the source trace and the measured repro where a second `agent_start`
/// follows the abort's success response.
///
/// The gap is closed on this side instead: the omp transport never steers, so
/// the queue Dray can fill is empty when this runs. What remains is omp's own
/// hidden steers, which `abort` does not drop — narrow and written down rather
/// than papered over.
///
/// The upstream issue that would close it properly is drafted in OMP-PLAN §15.
pub async fn interrupt(client: &OmpClient) -> Result<()> {
    client.request("abort", Value::Null).await?;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn read_stdout(
    stdout: ChildStdout,
    client: OmpClient,
    session_id: String,
    session_cwd: String,
    events: Arc<Mutex<Vec<AgentEvent>>>,
    status: Arc<Mutex<StatusTracker>>,
    queued: QueuedMessages,
    pending: PendingPermissions,
    seq: Arc<AtomicU64>,
    context_window: Arc<AtomicU64>,
    app: AppHandle,
) -> Result<()> {
    let reader = BufReader::new(stdout);
    // Splits on `\n` alone, which is what omp's framing requires: `U+2028` and
    // `U+2029` are legal inside JSON strings, so a reader treating them as line
    // breaks would corrupt any record containing one.
    let mut lines = reader.lines();
    let mut mapper = mapper::Mapper::new(session_id.clone(), seq.clone(), context_window);
    let transport = Transport::Omp(client.clone());

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        if std::env::var_os("DRAY_OMP_TRACE").is_some() {
            // By chars, not bytes: slicing a `String` at a byte offset that lands
            // inside a multi-byte character panics, and this reads lines an agent
            // wrote.
            let head: String = line.chars().take(400).collect();
            eprintln!("[omp {session_id} <<] {head}");
        }

        let raw = match client.accept(&line).await {
            Incoming::Event(raw) => raw,
            Incoming::Response { matched: true } => continue,
            // A refusal with no id lands here too, and that is omp's own shape
            // rather than a stray — see [`OmpClient::accept`]. Filed either way,
            // so the sentence it carried is in the log.
            Incoming::Response { matched: false } => {
                record_failure(Omp, &session_id, "stray_response", "no caller waiting", &line).await;
                continue;
            }
            Incoming::Malformed => {
                record_failure(Omp, &session_id, "parse", "not JSON", &line).await;
                continue;
            }
        };

        let event = match parser::parse_line(&raw) {
            Ok(event) => event,
            Err(err) => {
                record_failure(Omp, &session_id, "parse", &err.to_string(), &line).await;
                continue;
            }
        };

        // Reached only through the catch-all: the line exists and this build has
        // never seen it. Filed for the reason Claude's unknown subtypes are — it
        // is a coverage gap, and the catch-all only stops it costing the line.
        if matches!(event, parser::OmpEvent::Unknown) {
            record_failure(Omp, &session_id, "unknown_line", &parser::describe_line(&line), &line)
                .await;
            continue;
        }

        // The model moved under a running child, which Dray itself never does —
        // it respawns — but a reader running `/model` inside omp does, and omp
        // reports it here whoever asked. The ring's denominator belongs to the
        // model, so it is re-read rather than left describing the old one.
        //
        // Spawned, never awaited: a request is settled by a line off stdout and
        // this loop is what reads them, so awaiting one here waits on itself.
        //
        // The old window is dropped *here*, synchronously, rather than left
        // standing until the answer lands. That is about the *mixed* pair: a
        // fresh occupancy measured against the window of the model that left
        // reads as room where there is none, once the switch is onto a smaller
        // one.
        if matches!(event, parser::OmpEvent::ModelChanged) {
            let client = client.clone();
            let context_window = mapper.context_window();
            context_window.store(0, Relaxed);
            tokio::spawn(async move {
                match client.request("get_state", Value::Null).await {
                    Ok(state) => {
                        if let Some(window) = state["model"]["contextWindow"].as_u64() {
                            context_window.store(window, Relaxed);
                        }
                    }
                    Err(error) => eprintln!("[omp] could not re-read the context window: {error:#}"),
                }
            });
        }

        // A dialog omp is blocked on. Answered from here and never merely
        // ignored: omp holds the tool call until an `extension_ui_response`
        // carrying this id comes back, and its `select` has no timeout, so
        // silence stalls the session with a complete transcript on screen and
        // nothing saying why.
        //
        // Unlike pi this is usually omp's *own* approval card rather than an
        // extension's — see [`dialog`] — and it arrives on the same channel
        // either way.
        if let parser::OmpEvent::ExtensionUiRequest { id, method, title, .. } = &event {
            // The blocking four block. The rest are output: omp mints an id for
            // them and registers no waiter, so a reply is dropped. Anything else
            // is a method this build has never seen, which is worth filing.
            let Some((request_id, request, questions)) = dialog::for_request(&event) else {
                if !dialog::ANNOUNCEMENTS.contains(&method.as_str()) {
                    let asked = title.clone().unwrap_or_else(|| method.clone());
                    record_failure(Omp, &session_id, "unsupported_request", &asked, &line).await;

                    // `cancelled` is the one answer every dialog understands,
                    // resolving each to the default it was built with. A refusal
                    // reaches omp as its own dialog being dismissed, which is a
                    // state its author already had to handle.
                    let _ = client.send(&json!({
                        "type": "extension_ui_response",
                        "id": id,
                        "cancelled": true,
                    }));
                }
                continue;
            };

            let tool_use_id = request.tool_use_id.clone();
            pending
                .lock()
                .expect("pending permissions mutex poisoned")
                .insert(request_id.clone(), request);

            // Registered before it is emitted, so a reader answering the frame it
            // appears cannot beat the entry that resolves the answer.
            let asked = mapper.synthesize(AgentEventPayload::QuestionsAsked {
                request_id,
                tool_use_id,
                questions,
            });

            if let Err(error) = app.emit("agent_event", &asked) {
                eprintln!("[omp emit err] {error}");
            }
            continue;
        }

        let ingest = crate::session::Ingest {
            session_id: &session_id,
            harness: Omp,
            session_cwd: &session_cwd,
            events: &events,
            status: &status,
            queued: &queued,
            flush_seq: &seq,
            flush_events: &events,
            flush_transport: &transport,
        };

        for agent_event in mapper.map(event) {
            crate::session::ingest(&ingest, agent_event, &app).await;
        }
    }

    // The child is gone. `agent_end` is the only line that closes a turn, and an
    // omp that dies mid-turn cannot send one — so without this the session sits
    // `in_progress` forever with a complete-looking transcript, every tool row
    // shimmering, and a Stop that answers success and does nothing.
    //
    // Emitted, never logged, for the reason Claude Code's drained task set is:
    // this describes a child that no longer exists, a persisted copy would be
    // replayed against a session that has already been reset to `idle` at
    // startup, and this runs after a delete may have removed the file, where an
    // append would quietly recreate it.
    if status.lock().await.turn_in_flight() {
        let closed = mapper.synthesize(AgentEventPayload::TurnCompleted {
            status: TurnStatus::Error,
            stop_reason: None,
            // The one sentence that names what happened. `Turn failed` alone is
            // the fallback for an errored turn carrying no text, and this turn
            // has a reason worth reading.
            final_text: Some("omp stopped before the turn finished".to_string()),
            // A child that went away, which no login fixes.
            auth_failed: false,
            usage: None,
            duration_ms: None,
            head: None,
        });

        if let Err(err) = app.emit("agent_event", &closed) {
            eprintln!("[omp emit err] {err}");
        }
        status.lock().await.on_event(&closed.payload);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **One model flag, qualified, and never `--provider`.**
    ///
    /// The legacy pair makes omp look up an exact catalogue key it does not hold
    /// and then exit 1 without answering a single command — measured against
    /// 18.1.20 with `opencode-go/deepseek-v4.1-flash`, which reaches the reader
    /// as a session that will not start. `Model.id` is already the qualified
    /// spelling, so the index and the spawn cannot disagree about which model a
    /// session is on.
    #[test]
    fn the_model_rides_one_qualified_flag() {
        let args = launch_args(
            std::path::Path::new("/tmp/s.jsonl"),
            Some(&deepseek()),
            None,
            ApprovalPolicy::Auto,
            None,
        );

        assert!(
            !args.iter().any(|arg| arg == "--provider"),
            "the legacy pair is what breaks this model: {args:?}"
        );

        let at = args
            .iter()
            .position(|arg| arg == "--model")
            .expect("a model flag");
        assert_eq!(args[at + 1], "opencode-go/deepseek-v4.1-flash");
    }

    /// A provider whose own model ids carry a slash is not joined twice.
    ///
    /// `commandcode` serves models named `deepseek/deepseek-v4.1-flash`, so the
    /// qualified spelling has three segments — and omp resolves it, which is the
    /// reason this is a join of `provider` and `arg` rather than a rewrite of
    /// `arg`.
    #[test]
    fn a_provider_that_namespaces_its_own_ids_is_not_joined_twice() {
        let args = launch_args(
            std::path::Path::new("/tmp/s.jsonl"),
            Some(&row("commandcode", "deepseek/deepseek-v4.1-flash")),
            None,
            ApprovalPolicy::Auto,
            None,
        );
        let at = args.iter().position(|a| a == "--model").expect("a model flag");

        assert_eq!(args[at + 1], "commandcode/deepseek/deepseek-v4.1-flash");
    }

    /// A model with no effort levels carries no `--thinking`, and one with them
    /// carries the level it was given.
    #[test]
    fn effort_rides_its_own_flag_and_only_when_there_is_one() {
        let none = launch_args(
            std::path::Path::new("/tmp/s.jsonl"),
            Some(&deepseek()),
            None,
            ApprovalPolicy::Auto,
            None,
        );
        assert!(!none.iter().any(|a| a == "--thinking"), "{none:?}");

        let high = launch_args(
            std::path::Path::new("/tmp/s.jsonl"),
            Some(&deepseek()),
            Some(Effort::High),
            ApprovalPolicy::Auto,
            None,
        );
        let at = high.iter().position(|a| a == "--thinking").expect("a level");
        assert_eq!(high[at + 1], "high");
    }

    /// A session with no model names none, so omp's own settings decide — the
    /// honest answer for a multi-provider CLI whose user has already configured
    /// one.
    #[test]
    fn no_model_means_no_model_flag() {
        let args = launch_args(
            std::path::Path::new("/tmp/s.jsonl"),
            None,
            None,
            ApprovalPolicy::Auto,
            None,
        );

        assert!(!args.iter().any(|a| a == "--model"), "{args:?}");
    }

    /// Plan's allowlist reaches the spawn, which is what makes it a real
    /// restriction rather than an instruction.
    #[test]
    fn plan_carries_its_allowlist_on_the_command_line() {
        let args = launch_args(
            std::path::Path::new("/tmp/s.jsonl"),
            None,
            None,
            ApprovalPolicy::Plan,
            None,
        );
        let at = args.iter().position(|a| a == "--tools").expect("a tool list");

        assert_eq!(args[at + 1], "read,grep,glob");
    }

    /// **The role reaches the spawn, joined onto what Dray already sends.**
    ///
    /// The cross-harness promise at the one place it can be checked without a
    /// CLI: every native instruction is still there, in full, and the role is
    /// after them rather than instead of them.
    #[test]
    fn a_role_is_appended_after_the_native_instructions() {
        let args = launch_args(
            std::path::Path::new("/tmp/s.jsonl"),
            None,
            None,
            ApprovalPolicy::Auto,
            Some(&crate::roles::section("You orchestrate.")),
        );
        let at = args
            .iter()
            .position(|arg| arg == "--append-system-prompt")
            .expect("the instructions flag");
        let sent = &args[at + 1];

        assert!(sent.starts_with(APPEND_SYSTEM_PROMPT), "nothing is replaced");
        assert!(sent.contains(APPEND_SYSTEM_PROMPT), "…and nothing is cut");
        assert!(sent.ends_with("You orchestrate."), "{sent}");
        assert!(sent.contains("\n\n## Role\n\n"), "{sent}");
    }

    /// And a session with no role sends exactly what it sent before roles
    /// existed — the compatibility promise, on the one flag it could break.
    #[test]
    fn a_session_with_no_role_sends_the_instructions_unchanged() {
        let args = launch_args(
            std::path::Path::new("/tmp/s.jsonl"),
            None,
            None,
            ApprovalPolicy::Auto,
            None,
        );
        let at = args
            .iter()
            .position(|arg| arg == "--append-system-prompt")
            .expect("the instructions flag");

        assert_eq!(args[at + 1], APPEND_SYSTEM_PROMPT);
    }

    /// A model built the way `models.rs` builds one: `id` is the qualified
    /// spelling and `arg` the half the provider itself calls the model.
    fn row(provider: &str, model_id: &str) -> Model {
        Model {
            id: crate::models::ModelId::new(format!("{provider}/{model_id}")),
            label: model_id.to_string(),
            efforts: Vec::new(),
            default_effort: None,
            arg: model_id.to_string(),
            provider: provider.to_string(),
            accepts_images: true,
            secondary: false,
        }
    }

    /// The model the field report named: `opencode-go`'s `deepseek-v4.1-flash`,
    /// whose own id is bare while its provider's name is not.
    fn deepseek() -> Model {
        row("opencode-go", "deepseek-v4.1-flash")
    }

    /// `Plan` is the one stance omp can enforce here, and it enforces it with a
    /// flag fixed for the process.
    #[test]
    fn plan_spawns_a_read_only_omp_and_nothing_else_gates() {
        assert_eq!(tools_for(ApprovalPolicy::Plan), Some(vec!["read", "grep", "glob"]));

        for ungated in [
            ApprovalPolicy::BypassPermissions,
            ApprovalPolicy::Manual,
            ApprovalPolicy::Auto,
            ApprovalPolicy::DontAsk,
        ] {
            assert_eq!(
                tools_for(ungated),
                None,
                "{ungated:?} has no verified mapping onto omp's own gate, so it must \
                 not half-apply a restriction"
            );
        }
    }

    /// The allowlist holds no tool that writes.
    ///
    /// Read as a list it is obvious; the failure it guards is a later edit
    /// widening it to "the tools people usually want in plan mode", which is how
    /// `bash` gets in. `--tools` is what makes plan mode true rather than
    /// instructed, so every name here has to be one that cannot change the tree.
    #[test]
    fn the_plan_allowlist_admits_nothing_that_writes() {
        for mutating in ["bash", "eval", "write", "edit", "ast_edit", "lsp", "task", "computer"] {
            assert!(
                !PLAN_TOOLS.contains(&mutating),
                "{mutating} can change the tree (or spawn something that can), so plan \
                 mode cannot offer it"
            );
        }
    }

    /// An attached screenshot reaches the model.
    ///
    /// The field is optional, so its absence is not an error at either end —
    /// which is what makes it worth a test rather than a glance.
    #[test]
    fn an_attached_image_rides_the_prompt() {
        let image = crate::attachments::PreparedImage {
            stored_path: "/tmp/shot.png".to_string(),
            mime_type: "image/png".to_string(),
            data: "aGk=".to_string(),
        };

        assert_eq!(
            prompt_request("look", std::slice::from_ref(&image)),
            json!({
                "message": "look",
                "images": [{"type": "image", "data": "aGk=", "mimeType": "image/png"}],
            })
        );

        assert_eq!(
            prompt_request("go", &[]),
            json!({"message": "go"}),
            "an empty array states what omp already assumes"
        );
    }

    /// **Nothing on this path names a `streamingBehavior`.**
    ///
    /// omp *requires* one while a turn runs — omitting it there fails rather than
    /// queueing — so a prompt reaching `send_prompt` mid-turn would be refused.
    /// Dray never sends one there: this transport does not steer, so a mid-turn
    /// prompt waits in Dray's own queue for a boundary where the child is idle.
    ///
    /// Pinned because the two halves are in different files and only agree by
    /// intent: `session.rs` decides not to take the steer branch for
    /// `Transport::Omp`, and this function decides not to name the field. A later
    /// edit adding steering back here without adding the field would refuse every
    /// mid-turn prompt, and the refusal would read as omp being broken.
    #[test]
    fn the_prompt_never_names_a_streaming_behavior() {
        assert!(prompt_request("go", &[]).get("streamingBehavior").is_none());
    }

    /// The prompt names nothing omp lacks.
    ///
    /// It is kept in step with Claude's by hand, and Claude's names two things
    /// pi and omp both have their own answers for — an agent told to reach for
    /// `AskUserQuestion` waits on a tool that never arrives.
    #[test]
    fn the_prompt_names_nothing_omp_lacks() {
        assert!(!APPEND_SYSTEM_PROMPT.contains("AskUserQuestion"));
        assert!(!APPEND_SYSTEM_PROMPT.contains("Agent tool"));
        assert!(APPEND_SYSTEM_PROMPT.contains("~/.agents/skills/dray"));
    }

    /// The read loop names no dialog method of its own.
    ///
    /// Which methods block and which are announcements is stated once, in
    /// [`dialog`], and this is the half that drifts: a second list here would
    /// file ordinary UI messages as coverage gaps and answer requests nobody was
    /// waiting for. Neither direction produces an error — omp drops an unwanted
    /// reply in silence — so the guard has to be that the loop holds no opinion
    /// at all.
    #[test]
    fn the_read_loop_classifies_dialogs_only_through_the_lists() {
        let source = include_str!("omp.rs");
        let code = source
            .split("\n#[cfg(test)]")
            .next()
            .expect("there is always a first half");

        for method in dialog::BLOCKING.into_iter().chain(dialog::ANNOUNCEMENTS) {
            assert!(
                !code.contains(&format!("\"{method}\"")),
                "the read loop names {method} itself instead of asking `dialog`"
            );
        }
    }

    /// Nothing here kills an omp except the one function allowed to.
    ///
    /// Every teardown goes through [`shutdown`], which asks omp to leave before
    /// it kills — and that is a rule with nothing enforcing it, since a fourth
    /// teardown path reaching for `child.kill()` regresses in silence.
    #[test]
    fn only_shutdown_may_kill_an_omp() {
        let source = include_str!("omp.rs");
        let code = source
            .split_once("\n#[cfg(test)]")
            .map(|(code, _)| code)
            .expect("this file carries a test module");

        let kills = code.matches("child.kill()").count();

        assert_eq!(
            kills, 1,
            "every teardown goes through `shutdown`, which asks omp to exit first \
             — a kill anywhere else skips its teardown. Found {kills} \
             `child.kill()` calls in this file."
        );
    }

    /// **Nothing on this path sends `clear_queue` or names `steer`.**
    ///
    /// The whole of OMP-PLAN §7's workaround is one sentence: this transport does
    /// not steer, so the queue Dray could fill is empty when Stop runs. A later
    /// edit adding either would silently reinstate the bug the section was
    /// written to avoid — a steered prompt that keeps running after the reader
    /// pressed Stop.
    ///
    /// Read off the *code*, with comment lines dropped: this file's own header
    /// explains what steering is and names it, and a test that tripped on its own
    /// prose would be asserting about the documentation rather than the
    /// behaviour.
    #[test]
    fn nothing_here_steers() {
        let code = non_comment_lines(include_str!("omp.rs"));

        for banned in ["streamingBehavior", "\"steer\"", "\"clear_queue\""] {
            assert!(
                !code.contains(banned),
                "this transport must not steer — {banned} reached the code. See OMP-PLAN §7"
            );
        }
    }

    /// Everything above the test module with its comment lines removed.
    ///
    /// A crude filter — it drops a line whose trimmed form opens with `//`, which
    /// covers `//`, `///` and `//!` — and deliberately so: the alternative is a
    /// parser, and the thing being guarded is whether a word reaches *executable*
    /// code, not where a doc comment ends.
    fn non_comment_lines(source: &str) -> String {
        source
            .split_once("\n#[cfg(test)]")
            .map(|(code, _)| code)
            .expect("this file carries a test module")
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}
