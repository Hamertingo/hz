//! MiniMax Code, spoken over `mcode acp`.
//!
//! One child per session and a JSON-RPC peer, like every ACP harness: the
//! framing is [`rpc`](self::rpc), the vocabulary is [`parser`](self::parser),
//! and what the model says becomes hz events through [`mapper`](self::mapper).
//! Four things are this CLI's own:
//!
//! - **A prompt is a request that blocks for the whole turn.** `session/prompt`
//!   answers with a stop reason once the model is done, so the turn's end
//!   arrives as a *response* rather than a notification. The read loop watches
//!   for that id itself instead of registering a waiter, whose timeout is for
//!   acknowledgements and a turn runs for minutes.
//! - **The session id is the CLI's.** There is no `--session-id`: `session/new`
//!   mints an `mvs_…` and hz records it, where Claude Code adopted the UUID hz
//!   handed it. So nothing about a session can be known before its spawn.
//! - **The model is a session setting, not a flag.** `mcode acp` takes no
//!   `--model`, so a chosen model is applied with
//!   `session/set_config_option` after the session exists — on a creation as
//!   well as a resume, since a creation has nothing else to name one.
//! - **Effort is `thinkingEffort`**, and it exists only on a model that
//!   reasons.
//!
//! Verified against `mcode acp` 0.4.12; the captures are in `fixtures/`.
//!
//! Rejected: `mcode exec --output-format stream-json` is one JSON object per
//! run, with no stream, no permission channel and no cancel.

pub mod agents;
pub mod commands;
pub mod context;
pub mod delegation;
pub mod elicitation;
pub mod mapper;
pub mod mcp;
pub mod models;
pub mod parser;
pub mod permissions;
pub mod providers;
pub mod rpc;
pub mod skills;

use crate::events::{AgentEvent, AgentEventPayload, ApprovalPolicy, BlockRef, DeltaEvent};
use crate::harness::permissions::PendingPermissions;
use crate::harness::questions::PendingQuestions;
use crate::harness::{read_stderr, record_failure, Harness::Mcode};
use crate::models::{Effort, Model, ModelId};
use crate::session::{QueuedMessages, Session, StatusTracker, Transport};
use crate::store::{self, next_seq_by_session_id};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, ChildStdout, Command},
    // The session-wide locks are async ones: the read loop takes them from its
    // own task while a send takes them from the caller's. The session's own
    // fields use the synchronous lock — see [`McodeSession`].
    sync::Mutex as AsyncMutex,
    time::Duration,
};

use rpc::{Incoming, RpcClient};
use crate::proc::HideConsole as _;

/// ACP protocol version. mcode answers `1` to `initialize`, measured.
const PROTOCOL_VERSION: u64 = 1;

/// How long a child is given to leave after `session/close` and EOF before it
/// is killed.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

/// What a resumed session is asked to be. `default` is ACP's own name for the
/// mode and the one mcode opens every session in.
const DEFAULT_MODE: &str = "default";

/// The connection every write is addressed to.
///
/// Cloneable, and the read loop holds a clone: both halves have to agree about
/// which prompt is running, since the reader is what sees it answered.
#[derive(Clone, Debug)]
pub struct McodeSession {
    pub client: RpcClient,
    /// Minted by mcode, not chosen by us. Recorded on the index entry's
    /// `thread_id` — the slot every peer harness's minted id lives in.
    pub id: String,
    /// The JSON-RPC id of the `session/prompt` now running, or `None` between
    /// turns. The read loop settles the turn on that id's response.
    prompt_id: Arc<Mutex<Option<i64>>>,
    /// What the **active model** takes, as the session's own `configOptions`
    /// state it. `None` for a reply this build could not read, which means
    /// "unknown, send it and let the agent judge" and must never collapse into
    /// the empty list — or an unfamiliar shape silently turns effort off.
    efforts: Arc<Mutex<Option<Vec<Effort>>>>,
    /// The model mcode says it is running, off those same replies. Not the model
    /// that was *asked* for: a refusal leaves the session on whatever it had,
    /// and [`landed_model`] is how a caller records what it really is.
    model: Arc<Mutex<Option<String>>>,
    /// The mode the session is in — ACP's `default` or `plan`.
    mode: Arc<Mutex<Option<String>>>,
    /// A `/context` probe in flight, if one is.
    ///
    /// The agent answers that command **locally** — the turn ends in about a
    /// second with `end_turn` and no model is called — so what it must not do is
    /// reach the transcript: the reader asked the panel for a reading, not the
    /// conversation for a message. Everything the child says while this is set is
    /// collected instead of ingested, and the collected text is what
    /// [`probe_context`] answers with.
    probe: Arc<Mutex<Option<Probe>>>,
}

/// A probe's turn in flight. See [`McodeSession::probe`].
#[derive(Default, Debug)]
struct Probe {
    /// The text collected from the turn's deltas.
    text: String,
}

impl McodeSession {
    /// The active model's ladder, or `None` where mcode has not said.
    pub fn efforts(&self) -> Option<Vec<Effort>> {
        self.efforts.lock().expect("mcode efforts poisoned").clone()
    }

    /// The model mcode last reported, as an id.
    pub fn model(&self) -> Option<String> {
        self.model.lock().expect("mcode model poisoned").clone()
    }

    /// The mode the session is in, as ACP spells it.
    pub fn mode(&self) -> Option<String> {
        self.mode.lock().expect("mcode mode poisoned").clone()
    }

    fn configs(&self, configs: &parser::ConfigOptions) {
        *self.model.lock().expect("mcode model poisoned") = configs.model().map(str::to_string);
        *self.efforts.lock().expect("mcode efforts poisoned") = models::effort_levels(configs);
        // Every `set_config_option` reply restates the whole list, so this is a
        // free reading for the picker — and it is the one that keeps a session's
        // provider change visible without a probe.
        models::remember_configs(configs);
    }
}

/// The model mcode last reported for a session, for a caller reconciling after
/// a refusal. `None` before any reply this build could read, which is "nothing
/// better than what you already have".
pub fn landed_model(session: &McodeSession) -> Option<ModelId> {
    session.model().map(ModelId::new)
}

/// The mode ACP should be in for a stance, where the stance is one of the two
/// modes rather than one of the permission modes.
pub fn acp_mode_for(policy: ApprovalPolicy) -> Option<&'static str> {
    match policy {
        ApprovalPolicy::Plan => Some("plan"),
        _ => None,
    }
}

/// The `permissionMode` value a stance names, for the three mcode offers.
///
/// mcode's own list is `default` ("Ask"), `auto` and `bypassPermissions` ("Full
/// access") — captured. A stance outside those three is *refused* rather than
/// rounded: `acceptEdits` and `dontAsk` are Claude Code's words and mean things
/// this CLI has no equivalent of, and silently running a session more
/// permissive than the reader asked for is the failure worth a refusal.
pub fn permission_value_for(policy: ApprovalPolicy) -> Result<&'static str> {
    match policy {
        // mcode's own names, captured: `default` is what its picker calls
        // "Ask". The app's word for the same stance is `Manual`.
        ApprovalPolicy::Manual | ApprovalPolicy::Plan => Ok("default"),
        ApprovalPolicy::Auto => Ok("auto"),
        ApprovalPolicy::BypassPermissions => Ok("bypassPermissions"),
        // `acceptEdits` and `dontAsk` are Claude Code's, and mcode has nothing
        // between Ask and Auto to put them on. Refused rather than rounded:
        // silently running a session wider than the reader asked for is the
        // failure worth a refusal, and the picker offers what this list names.
        other => bail!("mcode has no {other:?} stance — pick Ask, Auto or Full access"),
    }
}

/// A child that is already booting, for a session nobody has sent yet.
///
/// **The boot is the entire cost of `initialize`** — measured at 2.87s cold
/// against 0.01s on a child left alone for four seconds. The process comes up
/// on its own after `spawn`; nothing has to be written to it. So one can be
/// started while the reader is still typing and adopted when they send.
///
/// What makes that legal is `HZ_SESSION_ID`, which is fixed at spawn — the hz
/// CLI reads it as the default session for `hz issue link`, so a child parked
/// without one would quietly lose that for its whole life. Hence the caller
/// naming the session before it exists, rather than this inventing one.
struct Parked {
    /// **A whole session, not a bare process.** The handshake happens here, so
    /// the agent's own answers are on the wire before the reader's first prompt:
    /// the command list the composer's `/` menu draws arrives when the session
    /// opens, and `session/new` — measured at 1.07–3.65s, once 12.71s — is paid
    /// while the reader is still typing rather than after they press Enter.
    session: Session,
    session_id: String,
    cwd: String,
    /// The Agent the parked session was opened *as*, so a park made for one is
    /// never adopted for another.
    ///
    /// **Not a setting that can be corrected afterwards, unlike the model or the
    /// stance.** The Agent is composed into the session at `session/new` — its
    /// prompt, its tools, its model — so a park for a different one is a session
    /// that would run as the wrong thing, and the answer is a fresh spawn rather
    /// than a `set_config_option`.
    agent_name: Option<String>,
    /// Identity as well as age: a reaper compares it so that a newer park is
    /// never killed by an older park's clock.
    at: Instant,
}

/// How long an unclaimed child is left running — long enough to cover typing a
/// prompt, short enough that an abandoned one does not hold 400MB for the life
/// of the app.
const PARKED_FOR: Duration = Duration::from_secs(120);

static PARKED: LazyLock<AsyncMutex<Option<Parked>>> = LazyLock::new(|| AsyncMutex::new(None));

/// Starts the session a reader is about to need, so their first prompt does not
/// pay for its boot **or** for its handshake.
///
/// Best effort by contract: a caller that fails here has cost the reader
/// nothing, because [`init`] starts its own when nothing is parked.
///
/// The settings are the composer's current picks, applied here exactly as a
/// send would apply them — so a park whose picks are never contradicted costs
/// the first prompt nothing but the prompt itself. A send that *does* ask for
/// something else applies the difference in [`init`], which is three round trips
/// at worst and none in the ordinary case.
///
/// **A parked session writes no log.** Its read loop is running from the moment
/// the handshake completes, so every line between `session/new` and the first
/// prompt is mapped as usual — and everything the agent says in that window is
/// something [`crate::session::ingest`] drops from the retained copies
/// (`available_commands_update`, `session_info_update`, the settings replies), so
/// a reader who parks and never sends leaves no `.jsonl` behind.
#[allow(clippy::too_many_arguments)]
pub async fn prepare(
    session_id: &str,
    cwd: &str,
    model: Option<&Model>,
    effort: Option<Effort>,
    permission_mode: ApprovalPolicy,
    agent_name: Option<&str>,
    app: &AppHandle,
) -> Result<()> {
    // `false` for the thread id: there is no index entry yet — the manager
    // writes one at the send, and this session may never be sent at all. The id
    // the agent minted is carried on the session itself and recorded by
    // whichever send adopts it.
    let session = start_session(
        session_id,
        model,
        effort,
        permission_mode,
        cwd,
        cwd,
        true,
        None,
        false,
        agent_name,
        app,
    )
    .await?;
    let at = Instant::now();

    // Anything already parked belonged to a prompt that was never sent. Taken
    // out of the slot before it is killed, so the lock is not held across the
    // wait — `kill` reaps as well as signals, and a `Child` dropped without
    // that leaves a zombie behind.
    let previous = {
        let mut slot = PARKED.lock().await;
        slot.replace(Parked {
            session,
            session_id: session_id.to_string(),
            cwd: cwd.to_string(),
            agent_name: agent_name.map(str::to_string),
            at,
        })
    };
    if let Some(previous) = previous {
        let _ = previous.session.kill().await;
    }

    tokio::spawn(async move {
        tokio::time::sleep(PARKED_FOR).await;

        let expired = {
            let mut slot = PARKED.lock().await;
            // The stamp, so a newer park is never killed by an older park's
            // clock — this task outlives the slot it was made for.
            if slot.as_ref().is_some_and(|parked| parked.at == at) {
                slot.take()
            } else {
                None
            }
        };
        if let Some(expired) = expired {
            let _ = expired.session.kill().await;
        }
    });

    Ok(())
}

/// Takes the parked session if it belongs to this one, so [`init`] can skip the
/// spawn, the handshake and the settings alike.
async fn adopt(session_id: &str, cwd: &str, agent_name: Option<&str>) -> Option<Session> {
    let mut slot = PARKED.lock().await;
    if !slot
        .as_ref()
        .is_some_and(|parked| parked.belongs_to(session_id, cwd, agent_name))
    {
        return None;
    }
    slot.take().map(|parked| parked.session)
}

impl Parked {
    /// Whether this park is the child `session_id` is about to want.
    ///
    /// **Both halves, and the cwd is not decoration.** A child is spawned with
    /// `current_dir`, and a worktree session's tree does not exist until the CLI
    /// makes it — so that case parks for the project root and the send asks for
    /// the worktree. Refusing the mismatch falls back to a plain spawn, which is
    /// the right answer for one prompt and a wasted process for the other; what
    /// it must never be is a session running in a tree nobody named.
    fn belongs_to(&self, session_id: &str, cwd: &str, agent_name: Option<&str>) -> bool {
        park_matches(
            &self.session_id,
            &self.cwd,
            self.agent_name.as_deref(),
            session_id,
            cwd,
            agent_name,
        )
    }
}

/// Whether a park is the one `(session_id, cwd, agent)` is about to want.
///
/// Free rather than a method so the rule is testable on its own two strings: a
/// parked session is a live child, a reader loop and a handshake, and a test
/// that had to build one to compare two names would be a network away from
/// useless.
///
/// **The Agent is part of the identity, not a difference to reconcile.** The
/// model and the stance can be moved on a live child, so a park that disagrees
/// about those is adopted and corrected; the Agent cannot, because it is
/// composed into the session when the session is made. A mismatch here therefore
/// refuses the park and pays a spawn — which is the honest price of changing the
/// pick after parking.
fn park_matches(
    parked_id: &str,
    parked_cwd: &str,
    parked_agent: Option<&str>,
    session_id: &str,
    cwd: &str,
    agent_name: Option<&str>,
) -> bool {
    parked_id == session_id && parked_cwd == cwd && parked_agent == agent_name
}

/// The child a session runs on, spawned and not yet spoken to.
///
/// One place rather than two, because [`prepare`] has to build the same process
/// [`init`] would: an env or an argument that differs between them is a parked
/// child that behaves differently from a spawned one, which is the kind of
/// difference nobody would find until it mattered.
async fn spawn_child(session_id: &str, cwd: &str) -> Result<Child> {
    child_command(session_id, cwd)
        .await
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("couldn't start mcode")
}

/// The command every child of this harness is started from.
///
/// Split out so the one caller that wants a different *lifecycle* — the control
/// child [`open_control`] keeps, which must die with this app rather than outlive
/// it — still launches exactly what a session launches. Two spawn sites drifting
/// apart is how a child that behaves differently from a spawned one happens,
/// which is the kind of difference nobody would find until it mattered.
async fn child_command(session_id: &str, cwd: &str) -> Command {
    let bin = crate::binpath::mcode().await;
    let mut command = Command::new(&bin).hide_console();

    if let Some(endpoint) = crate::orchestration::child_endpoint() {
        command.env("HZ_ENDPOINT", endpoint);
    }

    command.arg("acp");

    crate::harness::agent_env(&mut command, &bin).await;

    command.current_dir(cwd).env("HZ_SESSION_ID", session_id);
    command
}

/// Spawns a session's `mcode acp`, handshakes it and opens or resumes its
/// session — or adopts the one [`prepare`] already did all of that for.
#[allow(clippy::too_many_arguments)]
pub async fn init(
    session_id: &str,
    model: Option<&Model>,
    effort: Option<Effort>,
    permission_mode: ApprovalPolicy,
    cwd: &str,
    session_cwd: &str,
    is_new_session: bool,
    fork_from: Option<&str>,
    agent_name: Option<&str>,
    app: &AppHandle,
) -> Result<Session> {
    // **Adopted where the reader typed long enough to cover the boot**, which is
    // the `initialize` and the first `session/new` measured at 2.7–3.7s together.
    // Nothing parked for this session — a worktree send, a resume, a prompt sent
    // before the frontend prepared one — falls through to the spawn.
    //
    // The parked session was configured with the picks the composer held when it
    // was made, so only a pick the reader changed *since* costs anything here.
    if let Some(mut session) = adopt(session_id, cwd, agent_name).await {
        // The child is borrowed for the three calls and the session's own
        // record is written afterwards, so the pick a send carries is what the
        // next comparison reads — not what the CLI happened to answer.
        {
            // mcode's own transport is always ACP, so this is a destructure and
            // not a check — it is written as a `let` rather than a `match`
            // because everything below needs the borrowed session.
            let Transport::Acp(opened) = &session.stdin;

            // A model is what the ladder is per, so it goes first for the same
            // reason it does on a fresh session — see `start_session`.
            if let Some(model) = model.filter(|m| session.model != m.id) {
                if let Err(error) = set_model(opened, model, app).await {
                    let _ = session.kill().await;
                    return Err(error);
                }
            }

            // A refused effort is a notice, never fatal — `start_session` says
            // why, and the two paths have to agree or a level that a model
            // stopped taking would park forever.
            if session.effort != effort {
                if let Some(effort) = effort {
                    if let Err(error) = set_effort(opened, effort).await {
                        note_effort(effort, &error.to_string());
                    }
                }
            }

            if session.permission_mode != permission_mode {
                if let Err(error) = set_mode(opened, permission_mode).await {
                    let _ = session.kill().await;
                    return Err(error);
                }
            }
        };

        session.model = model
            .map(|m| m.id.clone())
            .unwrap_or_else(|| session.model.clone());
        // Recorded whatever was asked: a park with no level and a send with none
        // are the same session, and mcode's own default is what is running.
        session.effort = effort;
        session.permission_mode = permission_mode;

        // The agent's id was minted while the reader typed, so the index learns
        // it *now* — the entry exists from the send, and a resume before this
        // write would have had nothing to name.
        record_thread_id(session_id, &session, is_new_session, fork_from).await?;

        eprintln!("[mcode timings] adopted a parked session (no spawn, no handshake)");
        return Ok(session);
    }

    start_session(
        session_id,
        model,
        effort,
        permission_mode,
        cwd,
        session_cwd,
        is_new_session,
        fork_from,
        true,
        agent_name,
        app,
    )
    .await
}

/// Records the agent's own session id on the index entry, for the two paths that
/// mint a new one. A resume answers with the id it was given, so there is
/// nothing to write.
async fn record_thread_id(
    session_id: &str,
    session: &Session,
    is_new_session: bool,
    fork_from: Option<&str>,
) -> Result<()> {
    if !is_new_session && fork_from.is_none() {
        return Ok(());
    }

    let Transport::Acp(opened) = &session.stdin;
    store::set_session_thread_id(session_id, &opened.id).await
}

/// Spawns, handshakes and configures one session.
///
/// `record_thread` is the whole difference between the two callers: a send has
/// an index entry to write the agent's id onto, and a park does not — its
/// session may never be sent, so the write would either fail or leave an entry
/// pointing at a conversation nobody started.
#[allow(clippy::too_many_arguments)]
async fn start_session(
    session_id: &str,
    model: Option<&Model>,
    effort: Option<Effort>,
    permission_mode: ApprovalPolicy,
    cwd: &str,
    session_cwd: &str,
    is_new_session: bool,
    fork_from: Option<&str>,
    record_thread: bool,
    agent_name: Option<&str>,
    app: &AppHandle,
) -> Result<Session> {
    // Ahead of the spawn: everything between the spawn and the kill-wrapped
    // `open_session` below has to be infallible, or a `?` returns leaving a
    // child nothing can reach.
    let seq_start = if is_new_session {
        0
    } else {
        next_seq_by_session_id(session_id).await?
    };

    let boot = Instant::now();
    let mut child = spawn_child(session_id, cwd).await?;
    let spawned = boot.elapsed();

    let stdin = child.stdin.take().context("failed to take stdin")?;
    let stdout = child.stdout.take().context("failed to take stdout")?;
    let stderr = child.stderr.take().context("failed to take stderr")?;

    let client = RpcClient::new(stdin);
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let pending: PendingPermissions = Default::default();
    // The question side of the same arrangement: the read loop registers from
    // its own task, the session answers from the caller's.
    let pending_questions: PendingQuestions = Default::default();
    let stderr_tail: StderrTail = Default::default();

    let reader = ReaderHandles {
        client: client.clone(),
        session_id: session_id.to_string(),
        session_cwd: session_cwd.to_string(),
        pending: pending.clone(),
        pending_questions: pending_questions.clone(),
        stderr_tail: stderr_tail.clone(),
        app: app.clone(),
    };

    let seq = Arc::new(AtomicU64::new(seq_start));
    // The async lock, for the three the whole session shares: the read loop
    // takes them from its own task while a send takes them from the caller's.
    // The session's own fields use the synchronous one — see [`McodeSession`].
    let events: Arc<AsyncMutex<Vec<AgentEvent>>> = Arc::new(AsyncMutex::new(Vec::new()));
    let status: Arc<AsyncMutex<StatusTracker>> = Arc::new(AsyncMutex::new(StatusTracker::default()));
    let queued: QueuedMessages = Arc::new(AsyncMutex::new(Vec::new()));

    tokio::spawn({
        let events = events.clone();
        let status = status.clone();
        let queued = queued.clone();
        let seq = seq.clone();
        async move {
            if let Err(error) =
                read_stdout(stdout, reader, ready_rx, events, status, queued, seq).await
            {
                eprintln!("Failed to read mcode stdout: {error}");
            }
        }
    });

    tokio::spawn(async move {
        if let Err(error) = read_mcode_stderr(stderr, stderr_tail).await {
            eprintln!("Failed to read mcode stderr: {error}");
        }
    });

    let opening = Instant::now();
    let (mcode_id, config) = match open_session(
        &client,
        session_id,
        session_cwd,
        is_new_session,
        fork_from,
        agent_name,
    )
    .await
    {
        Ok(opened) => opened,
        Err(error) => {
            // Post-spawn, so the child is running with nobody left to talk
            // to it. A `Child` is not reaped on drop.
            let _ = child.kill().await;
            return Err(error);
        }
    };
    let opened = opening.elapsed();

    // Written before the first prompt, so a child dying mid-turn still leaves a
    // session to resume rather than one that silently starts over.
    if record_thread && (is_new_session || fork_from.is_some()) {
        store::set_session_thread_id(session_id, &mcode_id).await?;
    }

    let session = McodeSession {
        client,
        id: mcode_id,
        prompt_id: Arc::new(Mutex::new(None)),
        efforts: Arc::new(Mutex::new(None)),
        model: Arc::new(Mutex::new(None)),
        mode: Arc::new(Mutex::new(None)),
        probe: Arc::new(Mutex::new(None)),
    };
    let _ = config;

    // **Taken, though the settings around it are not.** This is the composer's
    // park as often as it is a send — the handshake runs the moment a project is
    // acquired — so the list the picker needs is on the wire here before the
    // reader has opened anything, and taking it is what keeps the picker from
    // booting a child of its own beside this one.
    models::remember_configs(&config);

    let settings = Instant::now();

    // The session settings, applied in place on a session that now exists — the
    // only moment any of them can be, since none rides the spawn.
    //
    // **The model first, and that ordering is load-bearing rather than
    // incidental**: a ladder is per model, so an effort sent first is asked of
    // the model mcode opened on rather than the one the reader picked, and a
    // rung the new model does not have is refused for the old one's sake. The
    // reply to the model call is also what teaches the session the new model's
    // ladder, which is what the effort below is judged against.
    if let Some(model) = model {
        if let Err(error) = set_model(&session, model, app).await {
            let _ = child.kill().await;
            return Err(error);
        }
    }

    // A refused effort is **not** fatal, where a refused stance is. mcode
    // declines one on a model that does no reasoning, and killing the child over
    // that means a session whose recorded level its model has since stopped
    // taking cannot be resumed at all. So the level is dropped, the session runs
    // on mcode's own default, and the transcript says so — the same answer the
    // in-place path in [`crate::session`] gives, by design, since the reader
    // cannot tell the two moments apart.
    if let Some(effort) = effort {
        if let Err(error) = set_effort(&session, effort).await {
            note_effort(effort, &error.to_string());
        }
    }

    // The stance last, since a plan mode and a permission mode are the same
    // setting reached two ways, and `default` is where the plan branch has to
    // start from.
    if let Err(error) = set_mode(&session, permission_mode).await {
        let _ = child.kill().await;
        return Err(error);
    }

    // **One line per session start, and the outlier is what it is for.**
    // `session/new` has been measured at 1.07s, 1.76s, 3.65s and **12.71s** on
    // the same kind of child, and nothing in the app could say which phase the
    // twelve seconds were in — the transcript just looked slow. A park prints its
    // own line instead, so an adopted send is visibly free.
    eprintln!(
        "[mcode timings] spawn {:.2}s open {:.2}s settings {:.2}s{}",
        spawned.as_secs_f64(),
        opened.as_secs_f64(),
        settings.elapsed().as_secs_f64(),
        if record_thread { "" } else { " (parked)" },
    );

    let _ = ready_tx.send(session.clone());

    Ok(Session {
        id: session_id.to_string(),
        child,
        stdin: Transport::Acp(session),
        harness: Mcode,
        model: model
            .map(|m| m.id.clone())
            .unwrap_or_else(|| ModelId::new("")),
        effort,
        permission_mode,
        // mcode has no fast mode at all, so there is nothing to have told the
        // child and nothing that can drift.
        fast: false,
        events,
        seq,
        status,
        pending_permissions: pending,
        pending_questions,
        queued,
    })
}

/// Handshakes the child and opens, resumes or forks its session.
///
/// Returns mcode's own session id — which for a resume is the recorded one,
/// since that reply carries none — and the settings that came back with it.
async fn open_session(
    client: &RpcClient,
    session_id: &str,
    session_cwd: &str,
    is_new_session: bool,
    fork_from: Option<&str>,
    agent_name: Option<&str>,
) -> Result<(String, parser::ConfigOptions)> {
    let init = client
        .request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                // `fs` and `terminal` are both declined. mcode reads and writes
                // through its own tools, and advertising either would invite
                // requests this build cannot serve — which, unanswered, block
                // the agent's turn.
                "clientCapabilities": {
                    "fs": {"readTextFile": false, "writeTextFile": false},
                    "terminal": false,
                    // **Form elicitation, which is how the agent asks a
                    // question.** Without it the agent degrades `ask_user` into a
                    // permission card — `handleQuestionnaire`'s own fallback —
                    // which draws a question's options as allow/deny buttons.
                    // `{}` is the value that means yes: the field is
                    // `form?: … | null`, and only absent or `null` reads as
                    // unsupported.
                    "elicitation": {"form": {}},
                    // **What turns the agent's own extension notifications on.**
                    // It gates pushes, not requests: `mcode/session/delegation/get`
                    // and its siblings answer whether or not this is here, but
                    // `mcode/session/delegation_update` is only sent to a client
                    // that says it speaks them — see `supportsTuiAcpExtensionNotifications`.
                    // Stated with `notifications: true` because the delegation
                    // snapshot is the one this build consumes; the goal, queue and
                    // current-session pushes that ride the same flag arrive as
                    // methods `parser::parse_notification` does not model and are
                    // dropped, which is the ordinary path for a method we have no
                    // use for.
                    "_meta": {
                        "minimax-code/extensions": {"version": 1, "notifications": true}
                    },
                },
                "clientInfo": {"name": "hz", "version": env!("CARGO_PKG_VERSION")},
            }),
        )
        .await?;
    parser::InitializeResult::of(&init);

    // mcode keeps its own MCP configuration and manages it from its own TUI
    // (`mcode mcp`), so this list is empty on every path: the servers a session
    // reaches are the reader's, configured once where they already are.
    let servers = json!([]);

    if let Some(parent) = fork_from {
        let answer = client
            .request(
                "session/fork",
                json!({"sessionId": parent, "cwd": session_cwd, "mcpServers": servers}),
            )
            .await
            .context("mcode refused to fork this session")?;

        let started = parser::NewSessionResult::of(&answer);
        if started.session_id.is_empty() {
            bail!("session/fork answered with no session id");
        }
        // A fork is a new session of its own from here on: the index row keeps
        // what it was forked from, and this is where the CLI's id lands.
        let minted = started.session_id.clone();
        store::set_session_thread_id(session_id, &minted).await?;
        return Ok((minted, started.configs()));
    }

    if is_new_session {
        let mut params = json!({"cwd": session_cwd, "mcpServers": servers});
        // **The Agent rides `_meta`, and it has to.** ACP's `NewSessionRequest`
        // declares `cwd`, `additionalDirectories`, `mcpServers` and `_meta`, and
        // the agent validates it with a stripping object — so a top-level
        // `agentName` would be dropped before the handler ever saw it. `_meta` is
        // the one slot the schema leaves open, and the same place this build's own
        // extension capabilities travel.
        //
        // Absent means the runtime's own default agent, which is what every send
        // that names nothing gets.
        if let Some(name) = agent_name.map(str::trim).filter(|name| !name.is_empty()) {
            params["_meta"] = json!({"minimax-code/agent": name});
        }

        let answer = client
            .request("session/new", params)
            .await
            .context("mcode refused to open a session")?;

        let started = parser::NewSessionResult::of(&answer);
        if started.session_id.is_empty() {
            bail!("session/new answered with no session id");
        }
        // Before the first prompt, so a child dying mid-turn still leaves a
        // session to resume rather than one that silently starts over.
        let minted = started.session_id.clone();
        store::set_session_thread_id(session_id, &minted).await?;
        return Ok((minted, started.configs()));
    }

    let recorded = store::get_session_index_item(session_id)
        .await?
        .and_then(|item| item.thread_id)
        .context("this session has no mcode session to resume")?;

    let answer = client
        .request(
            "session/resume",
            json!({"sessionId": recorded, "cwd": session_cwd, "mcpServers": servers}),
        )
        .await
        .context("mcode refused to resume this session")?;

    Ok((recorded, parser::ConfigOptions::of(&answer)))
}

/// Asks the child for its own context report, and answers with what it said.
///
/// **`/context` is the agent's own command, and ACP carries it.** Sent as a
/// prompt it is intercepted by the agent's command layer rather than by a model —
/// the turn ends in about a second with `end_turn` and no tokens are spent — and
/// its answer is the block [`context::parse`](super::context::parse) reads. That
/// is where the six categories the reader wants come from: they are computed
/// inside the agent from state no client is sent, so the command is the only door
/// to them.
///
/// Nothing about this turn is allowed to be visible. The prompt is not logged,
/// the answer is not a message, and the status machine is not touched: see
/// [`McodeSession::probe`]. What it *is* is refused while the child is mid-turn —
/// the agent answers "A prompt is already active for this session", and that
/// sentence reaches the caller rather than a hang.
pub async fn probe_context(session: &McodeSession) -> Result<String> {
    {
        let mut probe = session.probe.lock().expect("mcode probe poisoned");
        if probe.is_some() {
            bail!("a context reading is already in flight for this session");
        }
        *probe = Some(Probe::default());
    }

    let answer = session
        .client
        .request(
            "session/prompt",
            json!({
                "sessionId": session.id,
                "prompt": [{"type": "text", "text": "/context"}],
            }),
        )
        .await;

    // Taken whatever the request answered: a refusal leaves a flag set that would
    // swallow the next real turn, which is a far worse failure than a missing
    // reading.
    let text = session
        .probe
        .lock()
        .expect("mcode probe poisoned")
        .take()
        .map(|probe| probe.text)
        .unwrap_or_default();

    match answer {
        Ok(_) => Ok(text),
        Err(err) => Err(err).context("the agent refused to report its context"),
    }
}

/// Moves a running session onto another model, and re-reads what that model
/// takes.
pub async fn set_model(session: &McodeSession, model: &Model, app: &AppHandle) -> Result<()> {
    let answer = set_config(session, "model", &model.arg).await?;
    let configs = parser::ConfigOptions::of(&answer);
    session.configs(&configs);
    announce_ladder(app);
    Ok(())
}

/// Moves a running session onto another thinking effort.
///
/// Refused by mcode on a model that does no reasoning, which is why the caller
/// treats the error as a notice rather than as fatal.
pub async fn set_effort(session: &McodeSession, effort: Effort) -> Result<()> {
    let answer = set_config(session, "thinkingEffort", effort.as_arg()).await?;
    let configs = parser::ConfigOptions::of(&answer);
    session.configs(&configs);
    Ok(())
}

/// Moves a running session onto another stance: ACP's mode for the two that are
/// modes, and the `permissionMode` setting for the rest.
pub async fn set_mode(session: &McodeSession, policy: ApprovalPolicy) -> Result<()> {
    if let Some(mode) = acp_mode_for(policy) {
        session
            .client
            .request(
                "session/set_mode",
                json!({"sessionId": session.id, "modeId": mode}),
            )
            .await
            .context("mcode refused that mode")?;
        *session.mode.lock().expect("mcode mode poisoned") = Some(mode.to_string());
        return Ok(());
    }

    let value = permission_value_for(policy)?;
    let answer = set_config(session, "permissionMode", value).await?;
    let configs = parser::ConfigOptions::of(&answer);
    session.configs(&configs);

    // Leaving plan mode is a mode change, not a permission one: a session
    // sitting in `plan` stays there however `permissionMode` is set.
    if session.mode().as_deref() == Some("plan") {
        session
            .client
            .request(
                "session/set_mode",
                json!({"sessionId": session.id, "modeId": DEFAULT_MODE}),
            )
            .await
            .context("mcode refused to leave plan mode")?;
        *session.mode.lock().expect("mcode mode poisoned") = Some(DEFAULT_MODE.to_string());
    }

    Ok(())
}

/// Tells the frontend to re-read the model list.
///
/// An in-place switch restates the active model's ladder, and that ladder is
/// what the composer's effort menu is drawn from — so a switch made here has to
/// reach the picker, and `models_changed` is the channel every build of this app
/// already listens on for exactly that. Nothing is learned into a catalog: the
/// list *is* the agent's answer, read live off the session.
fn announce_ladder(app: &AppHandle) {
    if let Err(err) = app.emit("models_changed", ()) {
        eprintln!("[mcode models_changed emit err] {err}");
    }
}

/// Records that an effort mcode refused was dropped rather than applied.
///
/// [stderr] and nothing else, deliberately: a level this build cannot send is
/// one the composer stops offering — the ladder the reply states is what its
/// menu is drawn from — so a row on screen saying so would repeat what the menu
/// already shows. It is logged because the *reason* is mcode's own sentence and
/// is worth having when a reader asks why their pick did not stick.
pub fn note_effort(asked: Effort, detail: &str) {
    eprintln!("[mcode effort] refused {}: {detail}", asked.as_arg());
}

/// One `session/set_config_option`, answering the setting's whole list back.
async fn set_config(session: &McodeSession, config_id: &str, value: &str) -> Result<Value> {
    session
        .client
        .request(
            "session/set_config_option",
            json!({"sessionId": session.id, "configId": config_id, "value": value}),
        )
        .await
        .with_context(|| format!("mcode refused {config_id} = {value}"))
}

/// Sends a prompt. Returns as soon as the request is written — the turn's end
/// arrives later, as that request's response.
pub async fn start_turn(session: &McodeSession, text: &str) -> Result<()> {
    let prompt = json!([{"type": "text", "text": text}]);
    let id = session.client.request_detached(
        "session/prompt",
        json!({"sessionId": session.id, "prompt": prompt}),
    )?;
    *session.prompt_id.lock().expect("mcode prompt id poisoned") = Some(id);
    Ok(())
}

/// Injects a message into the turn that is already running.
///
/// **The one way into a live turn.** A second `session/prompt` would take over
/// the single id the read loop settles the turn on, so a prompt typed mid-turn
/// has always been held until the turn ends — and the only way to release it
/// early was to stop the turn, which throws away the work in flight. mcode's own
/// extension takes a message *into* the running turn instead, and the agent reads
/// it as its next input rather than as a new turn.
///
/// It answers as soon as the message is admitted, so the ordinary request bound
/// applies; the extension refuses when there is no live turn, and that refusal is
/// the caller's signal to fall back to the queue.
pub async fn steer(session: &McodeSession, text: &str) -> Result<()> {
    session
        .client
        .request(
            "mcode/session/steer",
            json!({"sessionId": session.id, "text": text}),
        )
        .await
        .with_context(|| "mcode refused to steer the running turn")
        .map(|_| ())
}

/// Stops the turn in flight, which ACP asks for as a *notification* — nothing
/// answers it, and the prompt's own response reports `cancelled`.
pub fn cancel(session: &McodeSession) -> Result<()> {
    session
        .client
        .notify("session/cancel", json!({"sessionId": session.id}))
}

/// Closes the CLI's session and gives the child a moment to leave on its own.
pub async fn shutdown(child: &mut Child, session: &McodeSession) {
    let _ = session
        .client
        .request("session/close", json!({"sessionId": session.id}))
        .await;
    session.client.close();

    let _ = tokio::time::timeout(SHUTDOWN_GRACE, child.wait()).await;
    let _ = child.kill().await;
}

/// How long a control child is kept with nothing asked of it.
///
/// The Plugins screen asks in bursts — a list, then a switch, then a read — and
/// the gaps inside a burst are seconds. This is the gap that means the reader has
/// left the screen, and it is measured from the last question rather than from
/// the last answer so a slow one is not counted twice.
pub(crate) const CONTROL_IDLE: Duration = Duration::from_secs(300);

/// A child kept to answer the Plugins screen's questions, and nothing else.
///
/// **The screen is not a session and cannot borrow one.** What it asks — which
/// Skills exist, which of them the reader has switched off — are facts about the
/// *machine*, and every `mcode/session/*` method is per-session by construction,
/// so something has to hold a session open to ask them. A child per press would
/// pay the cold boot every time: 2.7–3.7s to `initialize` plus another 1.8–3.7s
/// to the first `session/new`, measured, which is a switch that moves six seconds
/// after it is pressed.
///
/// So one is kept — opened on the first question, reused for the rest. The same
/// bargain [`models::probe`](self::models) makes, with the child kept rather than
/// closed; the resident cost of that is stated where the slot is held, in
/// [`crate::plugins`], which is also what winds it down.
///
/// **Nothing here is a reader's session.** No index row, no event log, no status
/// machine and no `session_created`: the child is spawned, handshaken and opened,
/// and the only thing ever read back off it is the answer. That is why this is
/// not [`init`] — a control child runs no turn and writes nothing down.
pub struct Control {
    pub session: McodeSession,
    /// When a question was last put to it, so an idle one can be wound down.
    pub asked_at: Instant,
    child: Child,
    reader: tokio::task::JoinHandle<()>,
}

impl Control {
    /// Whether it has been left alone long enough to close.
    pub fn is_idle(&self) -> bool {
        self.asked_at.elapsed() > CONTROL_IDLE
    }

    /// Kills it without waiting, for a path that cannot await — the app quitting.
    ///
    /// The polite close is skipped deliberately: `RunEvent::Exit` runs without an
    /// executor and the process ends moments later, so `start_kill` is the whole
    /// of what can be sent. Killing one that has already gone is not an error.
    pub fn kill_now(&mut self) {
        self.reader.abort();
        let _ = self.child.start_kill();
    }

    /// Leaves nothing running: the reader task, then the process.
    ///
    /// Closed politely first — `session/close` and a moment to leave — the way
    /// every other child here is, so the agent drops its own record of a session
    /// that will never be asked about again.
    pub async fn close(mut self) {
        self.reader.abort();
        shutdown(&mut self.child, &self.session).await;
    }
}

/// Opens a bare ACP session and hands it back with the child still running.
pub async fn open_control() -> Result<Control> {
    // The scratch directory a model probe uses, for the same reason: a session is
    // bound to the `cwd` it is opened in, and management is not a project —
    // nothing here reads or writes anything the reader is working on.
    let scratch = std::env::temp_dir().join("hz-mcode-control");
    let _ = std::fs::create_dir_all(&scratch);
    let scratch_cwd = scratch.to_string_lossy().to_string();

    // The child's own name for `HZ_SESSION_ID`, which the hz CLI defaults to.
    // A control child runs no command that reads it, but it is named rather than
    // left empty: an empty one falls back to whatever the environment held last.
    let control_id = format!("hz-control-{}", std::process::id());

    // `kill_on_drop` where a session's child has it not: this one is owned by no
    // session and outlives no app, so a quit that dropped it must take the
    // process with it rather than leave an agent nobody can see or reach.
    let mut child = child_command(&control_id, &scratch_cwd)
        .await
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("couldn't start mcode to ask about the reader's plugins")?;

    let stdin = child.stdin.take().context("the control child has no stdin")?;
    let stdout = child.stdout.take().context("the control child has no stdout")?;
    let stderr = child.stderr.take().context("the control child has no stderr")?;

    let client = RpcClient::new(stdin);

    // **Something has to read it.** `accept` is what settles the waiters each
    // request below registers, so without this task every call sits out its own
    // timeout with the reply already written to a pipe nobody drains. A session's
    // read loop would ingest all of this into a transcript that does not exist;
    // this one keeps nothing but the answers.
    let reader = {
        let client = client.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                client.accept(&line).await;
            }
        })
    };

    tokio::spawn(async move {
        if let Err(error) = read_stderr(Mcode, stderr).await {
            eprintln!("Failed to read the control child's stderr: {error}");
        }
    });

    let opened = open_session(&client, &control_id, &scratch_cwd, true, None, None).await;
    let (id, configs) = match opened {
        Ok(opened) => opened,
        Err(error) => {
            // Post-spawn, so the child is running with nobody left to talk to it.
            reader.abort();
            let _ = child.kill().await;
            return Err(error);
        }
    };

    // The list, and nothing else about it. A management question is not a turn, so
    // the *settings* above are deliberately left unapplied — but the reply states
    // the model list the same way every session's does, and the machine's
    // configuration is what it describes rather than this scratch directory's.
    // Free, and it seeds the picker for a launch whose only session is this one.
    models::remember_configs(&configs);

    Ok(Control {
        // The settings are not applied: a control child is never asked to run a
        // turn, so a model is a hop of the boot it does not need — and picking one
        // would mean this app deciding what a management question runs on.
        session: McodeSession {
            client,
            id,
            prompt_id: Arc::new(Mutex::new(None)),
            efforts: Arc::new(Mutex::new(None)),
            model: Arc::new(Mutex::new(None)),
            mode: Arc::new(Mutex::new(None)),
            probe: Arc::new(Mutex::new(None)),
        },
        asked_at: Instant::now(),
        child,
        reader,
    })
}

struct ReaderHandles {
    client: RpcClient,
    session_id: String,
    session_cwd: String,
    pending: PendingPermissions,
    /// Questions the agent is waiting on an answer to. Cloned from the session
    /// like `pending` above, for the same reason: only the reader sees the
    /// request, and only the session can be told to answer it.
    pending_questions: PendingQuestions,
    /// The child's most recent stderr, for the turn it dies in. See
    /// [`stderr_tail_note`].
    stderr_tail: StderrTail,
    app: AppHandle,
}

/// How many of the child's last stderr lines are kept for a turn that fails.
///
/// A dying Node process prints its stack and nothing else, and that stack is the
/// only account of *why* it died. Twelve lines is one Node crash with its
/// message — enough to name the file and the reason, short enough that a loop
/// printing every frame cannot push the reason out.
const STDERR_TAIL_LINES: usize = 12;

/// The child's recent stderr, shared between the task that drains it and the
/// read loop that reports the turn it died in.
type StderrTail = Arc<Mutex<std::collections::VecDeque<String>>>;

/// The child's last words, as something a transcript row can carry.
///
/// **A bundle has no terminal.** The stderr drain prints to one for a dev run,
/// where the stack is right there to scroll to — but a reader running the built
/// app was told only that the agent exited, with the reason unreachable on their
/// machine. This puts it where the failure is.
fn stderr_tail_note(tail: &StderrTail) -> Option<String> {
    let held = tail.lock().expect("stderr tail mutex poisoned");
    if held.is_empty() {
        return None;
    }

    Some(format!(
        "Its last output:\n\n```\n{}\n```",
        held.iter().cloned().collect::<Vec<_>>().join("\n")
    ))
}

/// Drains the child's stderr, keeping the tail of it for a turn that dies.
///
/// The printing is [`read_stderr`](crate::harness::read_stderr)'s, unchanged —
/// and the buffer is the half a *bundle* needs, where the printed line goes
/// nowhere anybody can read.
async fn read_mcode_stderr(
    stderr: tokio::process::ChildStderr,
    tail: StderrTail,
) -> anyhow::Result<()> {
    use tokio::io::AsyncBufReadExt;

    let mut lines = tokio::io::BufReader::new(stderr).lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        eprintln!("[{} stderr] {line}", Mcode.wire_name());

        let mut held = tail.lock().expect("stderr tail mutex poisoned");
        if held.len() == STDERR_TAIL_LINES {
            held.pop_front();
        }
        held.push_back(line);
    }

    Ok(())
}

/// How long a held text delta waits for company before it goes out.
///
/// A frame at 60Hz, and the same number the agent's own TUI renders on. Shorter
/// buys nothing — nothing on screen changes faster than a frame — and longer
/// starts to read as the preview stuttering.
const COALESCE: Duration = Duration::from_millis(16);

/// Holds one block's text deltas for a frame, so a burst of them crosses to the
/// webview as one event.
///
/// **Measured, because the cost is the whole reason this exists**: one small turn
/// is 262 lines on the wire and **203 of them are text deltas** (133 thinking, 70
/// message). Each otherwise costs a serialize, an IPC message and a React render
/// of the transcript — 203 of them for one answer.
///
/// Only text deltas of the *same* block merge. Anything else — a `block_start`, a
/// `block_stop`, a tool call — flushes what is held first, so the preview never
/// arrives after the committed row it belongs to, and a merge never puts one
/// block's words under another's heading. The merged event keeps the first one's
/// `id` and `seq`, so the ordering key only ever moves forward, and takes the
/// newest `ts`.
///
/// A usage update is held rather than flushed: a turn carries dozens and only
/// the newest of a frame can ever be seen, so all but it are dropped here rather
/// than serialized across the bridge. It is a running counter, never a
/// persistence or ordering concern — [`crate::session::ingest`] drops it too.
///
/// Not persisted either way: [`crate::session::ingest`] drops deltas from the
/// retained copies, since the committed `assistant_text`/`reasoning` repeats the
/// whole block at its close.
struct Coalescer {
    held: Option<AgentEvent>,
    /// The newest usage update not yet sent. Held on the same frame the text
    /// hold runs on, and the anchor below is shared — usage arriving alone
    /// starts one, so a long tool call's periodic usage still draws on its own
    /// frame instead of waiting for the next non-usage event.
    usage: Option<AgentEvent>,
    /// When the current hold began. **The timer is anchored to the first delta of
    /// the run**, not to the read that just arrived: a model streaming steadily
    /// would otherwise push the deadline ahead of itself on every line and never
    /// draw at all.
    since: tokio::time::Instant,
}

impl Coalescer {
    fn new() -> Self {
        Self {
            held: None,
            usage: None,
            // Meaningless until a hold starts, which is the only moment it is
            // read.
            since: tokio::time::Instant::now(),
        }
    }

    /// Folds `event` in and hands back whatever is ready, oldest first.
    fn push(&mut self, event: AgentEvent) -> Vec<AgentEvent> {
        if matches!(event.payload, AgentEventPayload::UsageUpdate(_)) {
            if self.usage.is_none() && self.held.is_none() {
                self.since = tokio::time::Instant::now();
            }
            self.usage = Some(event);
            return Vec::new();
        }

        let Some((block, text)) = text_delta(&event.payload) else {
            return self.flush_before(event);
        };

        let extends = self
            .held
            .as_ref()
            .and_then(|held| text_delta(&held.payload))
            .is_some_and(|(open, _)| open == block);

        if extends {
            let held = self.held.as_mut().expect("`extends` implies one is held");
            if let Some((_, merged)) = text_delta_mut(&mut held.payload) {
                merged.push_str(text);
            }
            held.ts = event.ts;
            return Vec::new();
        }

        // Nothing held, or it belongs to another block: that one goes out now and
        // this becomes the new hold.
        let ready: Vec<AgentEvent> = self.held.take().into_iter().collect();
        self.held = Some(event);
        self.since = tokio::time::Instant::now();
        ready
    }

    /// Hands back anything held, then `event` — for an event that cannot merge.
    fn flush_before(&mut self, event: AgentEvent) -> Vec<AgentEvent> {
        let mut ready = self.flush();
        ready.push(event);
        ready
    }

    /// Everything held, in `seq` order — for the reader that has run out of
    /// lines, or whose frame boundary came due. `seq` order, because a usage
    /// update and a delta can be held at once and both consumers read the wire
    /// in sequence.
    fn flush(&mut self) -> Vec<AgentEvent> {
        let mut ready: Vec<AgentEvent> =
            self.held.take().into_iter().chain(self.usage.take()).collect();
        ready.sort_by_key(|event| event.seq);
        ready
    }

    /// When the oldest hold is due, or `None` while nothing is held — so the read
    /// loop only wakes on a timer when there is actually something to draw.
    fn deadline(&self) -> Option<tokio::time::Instant> {
        (self.held.is_some() || self.usage.is_some()).then(|| self.since + COALESCE)
    }

    /// Whether the hold has had its frame. The reader gates its flush on this:
    /// checking `held` alone would take the delta out on the very next pass,
    /// which is before the chunk that would have merged into it has arrived.
    fn due(&self) -> bool {
        self.deadline()
            .is_some_and(|at| tokio::time::Instant::now() >= at)
    }
}

/// The block and text of a text delta, or `None` for anything else.
fn text_delta(payload: &AgentEventPayload) -> Option<(&BlockRef, &str)> {
    match payload {
        AgentEventPayload::Delta(DeltaEvent::TextDelta { block, text }) => Some((block, text)),
        _ => None,
    }
}

fn text_delta_mut(payload: &mut AgentEventPayload) -> Option<(&BlockRef, &mut String)> {
    match payload {
        AgentEventPayload::Delta(DeltaEvent::TextDelta { block, text }) => Some((block, text)),
        _ => None,
    }
}

/// Hands a mapped event to the session.
///
/// One place rather than three, because a frame boundary can fall in three of
/// them — behind the line just read, on the timer with no line behind it, and at
/// stdout's end — and a second copy of these nine fields is a second thing to
/// keep in step.
struct Sink<'a> {
    session_id: &'a str,
    session_cwd: &'a str,
    events: &'a Arc<AsyncMutex<Vec<AgentEvent>>>,
    status: &'a Arc<AsyncMutex<StatusTracker>>,
    queued: &'a QueuedMessages,
    seq: &'a Arc<AtomicU64>,
    app: &'a AppHandle,
}

impl Sink<'_> {
    async fn send(&self, transport: &Transport, event: AgentEvent) {
        let ingest = crate::session::Ingest {
            session_id: self.session_id,
            harness: Mcode,
            session_cwd: self.session_cwd,
            events: self.events,
            status: self.status,
            queued: self.queued,
            flush_seq: self.seq,
            flush_events: self.events,
            flush_transport: transport,
        };
        crate::session::ingest(&ingest, event, self.app).await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn read_stdout(
    stdout: ChildStdout,
    handles: ReaderHandles,
    ready: tokio::sync::oneshot::Receiver<McodeSession>,
    events: Arc<AsyncMutex<Vec<AgentEvent>>>,
    status: Arc<AsyncMutex<StatusTracker>>,
    queued: QueuedMessages,
    seq: Arc<AtomicU64>,
) -> Result<()> {
    let mut lines = BufReader::new(stdout).lines();
    let mut mapper = mapper::Mapper::new(handles.session_id.clone(), seq.clone());

    // Held until the session exists. Lines before it are routed — the
    // handshake's answers have to reach their waiters — but mapped to nothing.
    let mut ready = Some(ready);
    let mut transport: Option<Transport> = None;
    let mut coalescer = Coalescer::new();
    let sink = Sink {
        session_id: &handles.session_id,
        session_cwd: &handles.session_cwd,
        events: &events,
        status: &status,
        queued: &queued,
        seq: &seq,
        app: &handles.app,
    };

    loop {
        if transport.is_none() {
            if let Some(rx) = &mut ready {
                match rx.try_recv() {
                    Ok(session) => {
                        transport = Some(Transport::Acp(session));
                        ready = None;
                    }
                    Err(tokio::sync::oneshot::error::TryRecvError::Closed) => ready = None,
                    Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
                }
            }
        }

        // A frame boundary with **no line behind it**: what is held goes out now,
        // or the preview freezes for as long as the model keeps streaming — the
        // whole point of holding is that the next line may be a merge rather than
        // a boundary, and a burst of chunks carries no boundary at all.
        //
        // **Gated on `due`, and that gate is the whole mechanism.** Flushing on
        // every pass looked equivalent and was not: the hold is taken here and
        // the next push happens *after* it, so an unconditional flush emitted
        // every chunk one pass late and merged nothing at all.
        if coalescer.due() {
            if let Some(transport) = transport.as_ref() {
                for event in coalescer.flush() {
                    sink.send(transport, event).await;
                }
            }
        }

        let line = match coalescer.deadline() {
            // Something is held, so the read is capped by the frame the hold
            // started on. `next_line` is cancellation safe, so the line that
            // arrives as the timer fires is not the one that gets lost.
            Some(at) => match tokio::time::timeout_at(at, lines.next_line()).await {
                Ok(line) => line,
                // The hold expired: round again, where the flush above runs and
                // clears the deadline with it.
                Err(_) => continue,
            },
            None => lines.next_line().await,
        };
        let line = match line {
            Ok(Some(line)) => line,
            // stdout closed (the child exited) or a read error — either way no
            // more of this turn is coming. Break to the cleanup below.
            Ok(None) => break,
            Err(err) => {
                eprintln!("[mcode stdout err] {err}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }

        // The prompt's own answer, read ahead of the demux: nothing waits on
        // it, so `accept` would file it as stray.
        //
        // **One demux for the line, never two.** Calling `accept` here as well
        // cost a second parse of every line and, worse, a second look at a
        // response the first call had already settled: `settle` removes the
        // waiter, so the second look finds none and files a legitimate reply as
        // a stray. The match below already takes a matched response and drops it.
        // The parse lives here for the same reason: while a prompt is open —
        // the whole turn — every line paid one full parse in `prompt_answer`
        // and a second in `accept`, so the parsed value is what both now take.
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                record_failure(Mcode, &handles.session_id, "parse", "not a JSON-RPC message", &line)
                    .await;
                continue;
            }
        };
        let mut event: Option<parser::McodeEvent> = None;
        if let Some(Transport::Acp(session)) = transport.as_ref() {
            event = prompt_answer(session, &value);
        }

        let event = match event {
            Some(event) => event,
            None => match handles.client.accept_value(value).await {
                Incoming::Notification { method, params } => {
                    // **One of the agent's own extensions, sorted before the
                    // parser is asked anything.** These ride beside ACP's as
                    // top-level methods rather than as `session/update`
                    // payloads, so `parse_notification` would answer `Ok(None)`
                    // and a roster the reader is watching would be dropped in
                    // silence. Emitted, never logged: a snapshot names children
                    // no child survives a restart.
                    if method == delegation::NOTIFICATION {
                        let roster = delegation::event_of(&params, &handles.session_id);
                        if let Err(err) = handles.app.emit(delegation::EVENT, &roster) {
                            eprintln!("[delegation emit err] {err}");
                        }
                        continue;
                    }
                    match parser::parse_notification(&method, params) {
                        // A method this build does not model is not a failure:
                        // mcode's own extensions ride in camel case beside
                        // ACP's, and dropping one costs nothing on screen.
                        Ok(None) => continue,
                        Ok(Some(update)) => {
                            if let Some(Transport::Acp(session)) = transport.as_ref() {
                                note_update(session, &update);
                            }
                            // **Outside that guard, and that is the point.** The
                            // list arrives on the heels of `session/new`, and
                            // this loop can see it before `init` has handed the
                            // session over — the copy this used to keep on the
                            // session was read by nothing, so in that race the
                            // commands were simply lost and the composer's menu
                            // stayed empty for the session's whole life.
                            if let parser::SessionUpdate::AvailableCommandsUpdate {
                                available_commands,
                            } = &update
                            {
                                let event = commands::SlashCommandsEvent {
                                    session_id: handles.session_id.clone(),
                                    commands: commands::from_commands(available_commands),
                                };
                                if let Err(err) = handles.app.emit("slash_commands", &event) {
                                    eprintln!("[slash commands emit err] {err}");
                                }
                            }
                            parser::McodeEvent::Update(Box::new(update))
                        }
                        Err(err) => {
                            record_failure(Mcode, &handles.session_id, "map", &err, &line).await;
                            continue;
                        }
                    }
                }

                // Every agent request blocks the turn until it is answered, so
                // silence stalls the session exactly as an unanswered
                // `can_use_tool` does.
                Incoming::Request { id, method, params } => {
                    if method == "session/request_permission" {
                        if let Err(err) = raise_permission(&handles, &mut mapper, id, params).await {
                            record_failure(
                                Mcode,
                                &handles.session_id,
                                "unsupported_request",
                                &err.to_string(),
                                &line,
                            )
                            .await;
                            let _ = handles
                                .client
                                .respond(id, json!({"outcome": {"outcome": "cancelled"}}));
                        }
                    } else if method == "elicitation/create" {
                        if let Err(err) = raise_question(&handles, &mut mapper, id, &line).await {
                            record_failure(
                                Mcode,
                                &handles.session_id,
                                "unsupported_request",
                                &err.to_string(),
                                &line,
                            )
                            .await;
                            // Declined rather than left hanging: the agent reads
                            // that as "no answer", where silence blocks the turn
                            // exactly as an unanswered permission does.
                            let _ = handles.client.respond(id, json!({"action": "decline"}));
                        }
                    } else {
                        // `fs/*` and `terminal/*` were declined at the
                        // handshake, so one arriving is mcode asking past the
                        // capabilities it was given.
                        record_failure(
                            Mcode,
                            &handles.session_id,
                            "unsupported_request",
                            &method,
                            &line,
                        )
                        .await;
                        let _ = handles.client.respond_err(
                            id,
                            -32601,
                            "This client cannot answer that request yet.",
                        );
                    }
                    continue;
                }

                Incoming::Response { id, matched: false } => {
                    let detail = format!("no caller waiting on id {id}");
                    record_failure(Mcode, &handles.session_id, "stray_response", &detail, &line)
                        .await;
                    continue;
                }
                Incoming::Response { .. } => continue,

                Incoming::Malformed => {
                    record_failure(Mcode, &handles.session_id, "parse", "not a JSON-RPC message", &line)
                        .await;
                    continue;
                }
            },
        };

        let Some(transport) = transport.as_ref() else {
            continue;
        };

        // **A probe's turn is read, not lived.** The agent answers `/context`
        // itself, so its turn costs no model time and must cost nothing on
        // screen either: the transcript is the conversation, and a reading the
        // reader asked the panel for is not a message in it. Every mapped event
        // is dropped while a probe is set, and the text deltas are what the
        // caller gets back.
        // mcode's own transport is always ACP, so this is a destructure rather
        // than a check.
        {
            let Transport::Acp(session) = transport;
            let mut probe = session.probe.lock().expect("mcode probe poisoned");
            if probe.is_some() {
                for agent_event in mapper.map(event) {
                    if let AgentEventPayload::Delta(DeltaEvent::TextDelta { text, .. }) =
                        &agent_event.payload
                    {
                        if let Some(held) = probe.as_mut() {
                            held.text.push_str(text);
                        }
                    }
                }
                continue;
            }
        }

        for agent_event in mapper.map(event) {
            // Whatever the coalescer hands back is ready to go out now — either
            // the event itself, or a held delta flushed ahead of a boundary.
            for ready in coalescer.push(agent_event) {
                sink.send(transport, ready).await;
            }
        }
    }

    // What the last frame was still holding. Emitted before the closing turn is
    // synthesized, for the same reason every other flush sits ahead of what
    // follows it: the reader watched that text arrive and it must not vanish
    // because the child died a frame later.
    if let Some(transport) = transport.as_ref() {
        for event in coalescer.flush() {
            sink.send(transport, event).await;
        }
    }

    // The child's stdout has ended. If a prompt was still in flight its answer
    // will never arrive, so close the turn as a failure — without which the
    // session hangs `in_progress` forever, its queue with no boundary to drain
    // at. The queue is stranded *first* (reported and cleared), so the closing
    // turn's boundary flush finds nothing to hand the dead child.
    if let Some(transport @ Transport::Acp(session)) = transport.as_ref() {
        let outstanding = session
            .prompt_id
            .lock()
            .expect("mcode prompt id poisoned")
            .is_some();

        if outstanding {
            crate::session::strand_queue_on_exit(
                &handles.session_id, Mcode, &queued, &seq, &events, &handles.app,
            )
            .await;
            // The reason, carried where the failure is. A bundled app has no
            // terminal to read the child's stack from, so without this the row
            // says only that the agent exited — see [`stderr_tail_note`].
            let detail = stderr_tail_note(&handles.stderr_tail);
            let closed = mapper.synthesize(AgentEventPayload::TurnCompleted {
                status: crate::events::TurnStatus::Error,
                stop_reason: Some("mcode exited".to_string()),
                auth_failed: false,
                final_text: Some(match detail {
                    Some(detail) => format!("mcode exited before the turn finished.\n\n{detail}"),
                    None => "mcode exited before the turn finished.".to_string(),
                }),
                usage: None,
                duration_ms: None,
                head: None,
            });
            sink.send(transport, closed).await;
        }
    }

    Ok(())
}

/// Folds a control-only update into the session — the mode is a control state
/// rather than a row in the transcript.
///
/// The command list is *not* here: it belongs to the frontend's menu and is
/// emitted the moment it arrives, which is before this loop necessarily holds
/// the session at all.
fn note_update(session: &McodeSession, update: &parser::SessionUpdate) {
    // One arm, so `if let`: the fold took the command list too until the picker
    // started reading the push directly, and a `match` with one variant and an
    // empty `_` claimed a shape this no longer has.
    if let parser::SessionUpdate::CurrentModeUpdate { current_mode_id } = update {
        *session.mode.lock().expect("mcode mode poisoned") = current_mode_id.clone();
    }
}

/// The prompt's own response, picked off the line by the id it was sent under.
///
/// Takes the already-parsed line — the read loop parsed it once for this demux
/// and `accept` reuses the same value, so no line is parsed twice.
fn prompt_answer(session: &McodeSession, value: &Value) -> Option<parser::McodeEvent> {
    let prompt_id = {
        let guard = session.prompt_id.lock().expect("mcode prompt id poisoned");
        (*guard)?
    };
    if value.get("id").and_then(Value::as_i64) != Some(prompt_id) {
        return None;
    }

    *session.prompt_id.lock().expect("mcode prompt id poisoned") = None;

    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("mcode refused the prompt")
            .to_string();
        return Some(parser::McodeEvent::PromptFailed { message });
    }

    let response = serde_json::from_value(value.get("result").cloned().unwrap_or(Value::Null))
        .unwrap_or_default();
    Some(parser::McodeEvent::PromptDone(response))
}

/// Turns one permission request into the card that answers it.
///
/// Registered before it is emitted, so a button pressed the instant the card
/// draws finds the entry waiting. The reply goes out from
/// [`Session::respond_permission`](crate::session::Session::respond_permission)
/// when the reader picks; until then the agent is blocked.
///
/// **Emitted and never logged.** Only the child that asked can answer, no child
/// survives a restart, and a replayed card is one whose buttons cannot work —
/// which is why this goes straight to the frontend rather than through
/// [`crate::session::ingest`].
async fn raise_permission(
    handles: &ReaderHandles,
    mapper: &mut mapper::Mapper,
    rpc_id: i64,
    params: Value,
) -> Result<()> {
    let request: parser::PermissionRequest =
        serde_json::from_value(params).context("unreadable permission request")?;
    let (pending, options) = permissions::pending_for(&request, rpc_id);

    let request_id = rpc_id.to_string();
    handles
        .pending
        .lock()
        .expect("pending permissions mutex poisoned")
        .insert(request_id.clone(), pending);

    let input = request.tool_call.raw_input.clone().unwrap_or(json!({}));
    let command = input.get("command").and_then(Value::as_str);
    let path = input
        .get("path")
        .or_else(|| input.get("file_path"))
        .and_then(Value::as_str)
        .map(str::to_string);

    let event = mapper.synthesize(AgentEventPayload::PermissionRequested {
        request_id,
        tool_use_id: request.tool_call.tool_call_id.clone(),
        tool_name: request
            .tool_call
            .name
            .clone()
            .unwrap_or_else(|| "tool".to_string()),
        display_name: None,
        // The command or the path, which is what the card draws as the subject.
        // mcode's own `title` is the tool name repeated, which the row above
        // already says.
        title: command.map(str::to_string).or_else(|| path.clone()),
        description: None,
        input,
        blocked_path: path,
        decision_reason: None,
        decision_reason_type: None,
        // Main-thread only: mcode files a subagent's request through the same
        // channel with no field saying so, and a card that claimed to be a
        // child's would be the one thing worse than saying nothing.
        agent_id: None,
        options,
    });

    handles.app.emit("agent_event", &event)?;
    Ok(())
}

/// Turns `elicitation/create` into the question card, holding the request until
/// the reader answers it.
///
/// The sibling of [`raise_permission`], and the same bargain: the form is kept
/// whole in Rust so the reply is composed from what the agent asked rather than
/// from anything the frontend invented. What goes back is the reader's own text,
/// filed under the field the question came from — see
/// [`elicitation::accepted`].
///
/// Read from the raw line rather than the `params` the demux made, because a
/// form's steps are only in order in the bytes — see
/// [`parser::ElicitationEnvelope`].
async fn raise_question(
    handles: &ReaderHandles,
    mapper: &mut mapper::Mapper,
    rpc_id: i64,
    line: &str,
) -> Result<()> {
    let request: parser::ElicitationRequest =
        serde_json::from_str::<parser::ElicitationEnvelope>(line)
            .context("unreadable question request")?
            .params;
    let (pending, questions) = elicitation::pending_for(&request, rpc_id);

    // A form whose properties all failed to name themselves has nothing the
    // reader could answer, and a card of no questions would block the turn on a
    // click that cannot exist.
    if questions.is_empty() {
        bail!("a question form with nothing to answer");
    }

    let request_id = rpc_id.to_string();
    handles
        .pending_questions
        .lock()
        .expect("pending questions mutex poisoned")
        .insert(request_id.clone(), pending);

    let event = mapper.synthesize(AgentEventPayload::QuestionsAsked {
        request_id,
        // No tool call behind it: mcode asks through its own extension rather
        // than through a tool the transcript drew, so there is no row for the
        // answers to be filed beside.
        tool_use_id: String::new(),
        questions,
    });

    handles.app.emit("agent_event", &event)?;
    Ok(())
}

#[cfg(test)]
mod coalesce_tests {
    use super::*;
    use crate::events::{BlockType, DeltaEvent, Usage};

    fn event(seq: u64, payload: AgentEventPayload) -> AgentEvent {
        AgentEvent {
            id: format!("e{seq}"),
            session_id: "s".into(),
            harness: Mcode,
            seq,
            ts: format!("t{seq}"),
            turn_id: None,
            subagent: None,
            payload,
            raw: None,
        }
    }

    fn block(index: u32) -> BlockRef {
        BlockRef {
            message_id: "m1".into(),
            index,
        }
    }

    fn start(index: u32) -> AgentEventPayload {
        AgentEventPayload::Delta(DeltaEvent::BlockStart {
            block: block(index),
            block_type: BlockType::Text,
        })
    }

    fn text(index: u32, text: &str) -> AgentEventPayload {
        AgentEventPayload::Delta(DeltaEvent::TextDelta {
            block: block(index),
            text: text.into(),
        })
    }

    fn stop(index: u32) -> AgentEventPayload {
        AgentEventPayload::Delta(DeltaEvent::BlockStop {
            block: block(index),
        })
    }

    fn usage(seq: u64) -> AgentEvent {
        event(seq, AgentEventPayload::UsageUpdate(Usage::default()))
    }

    fn text_of(event: &AgentEvent) -> &str {
        text_delta(&event.payload).expect("a text delta").1
    }

    /// The whole point: a burst of chunks becomes one event, carrying the first
    /// one's identity (so `seq` still only moves forward) and all of the text.
    #[test]
    fn chunks_of_one_block_leave_as_a_single_event() {
        let mut c = Coalescer::new();

        assert_eq!(c.push(event(1, start(0))).len(), 1, "a start never waits");
        assert!(c.push(event(2, text(0, "Hel"))).is_empty());
        assert!(c.push(event(3, text(0, "lo"))).is_empty());

        let held = &c.flush()[0];
        assert_eq!(held.seq, 2, "the first delta's own");
        assert_eq!(held.id, "e2");
        assert_eq!(held.ts, "t3", "the newest stamp, which is when it went out");
        assert_eq!(text_of(held), "Hello");
    }

    /// A boundary cannot overtake the text it closes: it goes out behind it, in
    /// order, or the committed row would draw above the preview it replaced.
    #[test]
    fn a_boundary_flushes_the_held_text_ahead_of_itself() {
        let mut c = Coalescer::new();
        c.push(event(1, text(0, "hello")));

        let ready = c.push(event(2, stop(0)));
        assert_eq!(ready.len(), 2);
        assert_eq!((ready[0].seq, ready[1].seq), (1, 2));
        assert_eq!(text_of(&ready[0]), "hello");
    }

    /// Two blocks never blend, however adjacent they are, and the one that was
    /// open goes out first.
    #[test]
    fn another_blocks_chunk_does_not_merge() {
        let mut c = Coalescer::new();
        c.push(event(1, text(0, "thinking")));

        let ready = c.push(event(2, text(1, "answer")));
        assert_eq!(ready.len(), 1);
        assert_eq!(text_of(&ready[0]), "thinking");
        assert_eq!(text_of(&c.flush()[0]), "answer");
    }

    /// The deadline is anchored to the first chunk of the run, not to the read
    /// that just arrived — a model streaming steadily would otherwise push it
    /// ahead of itself on every line and never draw at all.
    #[test]
    fn the_frame_is_measured_from_the_first_chunk_of_the_run() {
        let mut c = Coalescer::new();
        assert!(c.deadline().is_none(), "nothing held, no timer");

        c.push(event(1, text(0, "a")));
        let first = c.deadline().expect("held");

        std::thread::sleep(Duration::from_millis(5));
        c.push(event(2, text(0, "b")));
        assert_eq!(c.deadline().expect("still held"), first);

        c.flush();
        assert!(c.deadline().is_none(), "and it goes back off with the hold");
    }

    /// The reader flushes on `due`, not on `held` — a hold taken out on the next
    /// pass would leave before the chunk that merges into it could arrive, which
    /// is every chunk of a burst.
    #[test]
    fn a_hold_is_not_due_until_its_frame_has_passed() {
        let mut c = Coalescer::new();
        assert!(!c.due(), "nothing held is never due");

        c.push(event(1, text(0, "a")));
        assert!(!c.due(), "just held");

        std::thread::sleep(COALESCE + Duration::from_millis(5));
        assert!(c.due(), "and it has had its frame by now");
    }

    /// A turn carries dozens of usage updates and only the newest of a frame
    /// can be seen, so the earlier ones are dropped here rather than serialized
    /// across the bridge one IPC message each.
    #[test]
    fn usage_updates_of_a_frame_leave_as_the_newest_one() {
        let mut c = Coalescer::new();

        assert!(c.push(usage(1)).is_empty());
        assert!(c.push(usage(2)).is_empty());
        assert!(c.push(usage(3)).is_empty(), "still holding, none sent");

        let ready = c.flush();
        assert_eq!(ready.len(), 1, "the two older ones were dropped");
        assert_eq!(ready[0].seq, 3);
    }

    /// Usage arriving alone still draws: a long tool call streams usage with
    /// nothing else on the wire, so the hold must carry its own frame deadline
    /// instead of waiting for the next non-usage event.
    #[test]
    fn a_usage_hold_is_due_on_its_own_frame() {
        let mut c = Coalescer::new();
        assert!(c.deadline().is_none(), "nothing held, no timer");

        c.push(usage(1));
        assert!(c.deadline().is_some(), "the hold runs its own timer");

        std::thread::sleep(COALESCE + Duration::from_millis(5));
        assert!(c.due());
    }

    /// A boundary cannot be overtaken by usage, and text and usage held
    /// together leave in `seq` order — the transcript sorts on it.
    #[test]
    fn a_boundary_flushes_held_usage_and_text_in_seq_order() {
        let mut c = Coalescer::new();
        c.push(event(1, text(0, "hello")));
        c.push(usage(2));

        let ready = c.push(event(3, stop(0)));
        assert_eq!(ready.len(), 3);
        assert_eq!(
            (ready[0].seq, ready[1].seq, ready[2].seq),
            (1, 2, 3),
            "text, then the usage held beside it, then the boundary"
        );
    }
}

#[cfg(test)]
mod parked_tests {
    use super::*;

    /// The match is on all three fields, and the cwd half is the one that can be
    /// wrong: a worktree session asks for a tree the park was not made for, and
    /// adopting it would put the session somewhere nobody named.
    #[test]
    fn a_park_answers_only_for_its_own_session_and_tree() {
        assert!(park_matches("s1", "/repo", None, "s1", "/repo", None));
        assert!(!park_matches("s1", "/repo", None, "s1", "/repo/.claude/worktrees/one", None));
        assert!(!park_matches("s1", "/repo", None, "s2", "/repo", None));
        assert!(!park_matches("s1", "/repo", None, "s2", "/other", None));
    }

    /// **A different Agent refuses the park**, and that is the one mismatch that
    /// cannot be reconciled afterwards.
    ///
    /// The model and the stance move on a live child, so `init` applies the
    /// difference to an adopted session; the Agent is composed into the session at
    /// `session/new`, so a park opened as one Agent and adopted for another would
    /// run as the wrong thing with nothing on screen saying so. The cost is a
    /// spawn, which is the honest price of changing the pick after parking.
    #[test]
    fn a_park_answers_only_for_the_agent_it_was_opened_as() {
        assert!(park_matches("s1", "/repo", Some("explore"), "s1", "/repo", Some("explore")));

        assert!(!park_matches("s1", "/repo", Some("explore"), "s1", "/repo", None));
        assert!(!park_matches("s1", "/repo", None, "s1", "/repo", Some("explore")));
        assert!(!park_matches("s1", "/repo", Some("explore"), "s1", "/repo", Some("worker")));
    }
}
