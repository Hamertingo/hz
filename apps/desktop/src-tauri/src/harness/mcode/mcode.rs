//! MiniMax Code, spoken over `mcode acp`.
//!
//! **One child per project, carrying every conversation of it**, and a JSON-RPC
//! peer, like every ACP harness: the framing is [`rpc`](self::rpc), the
//! vocabulary is [`parser`](self::parser), and what the model says becomes hz
//! events through [`mapper`](self::mapper). The sharing is [`Agent`]'s: a boot is
//! ~6.5s and ~400MB, while `session/new` on a child already up is 0.02s, so a
//! second session in a project opens a conversation instead of a process. Four
//! things are this CLI's own:
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
pub mod goal;
pub mod mapper;
pub mod mcp;
pub mod models;
pub mod parser;
pub mod permissions;
pub mod providers;
pub mod rpc;
pub mod skills;

use crate::events::{AgentEvent, AgentEventPayload, ApprovalPolicy, BlockRef, DeltaEvent};
use crate::harness::{read_stderr, record_failure, Harness::Mcode};
use crate::models::{Effort, Model, ModelId};
use crate::session::{Session, SessionHandles, StatusTracker, Transport};
use crate::store::{self, next_seq_by_session_id};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
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
    /// The status of the last goal push this session saw, so the next one reads
    /// as a *change* rather than as a state. `None` covers "no goal yet" and
    /// "the goal was cleared" alike, which are the same thing to the transition.
    goal_status: Arc<Mutex<Option<String>>>,
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

    /// Records the goal a push carried, and answers the one that just finished.
    ///
    /// **The transition is the whole of it**, which is what [`goal::completion_of`]
    /// holds: the runtime re-pushes a goal whenever anything in it moves, so the
    /// status alone would write a receipt on every push. Called on every push, so
    /// the memory is the last status and not the last receipt.
    pub fn note_goal(&self, next: Option<&goal::Goal>) -> Option<goal::Goal> {
        let mut last = self.goal_status.lock().expect("mcode goal poisoned");
        let finished = goal::completion_of(last.as_deref(), next).cloned();
        *last = next.map(|goal| goal.status.clone());
        finished
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
    // Nothing to park where the project already has a child: the boot this exists
    // to hide has been paid, and the send that follows would open its conversation
    // on that one anyway.
    if agent_for(cwd).await.is_some() {
        return Ok(());
    }

    let handles = SessionHandles {
        session_id: session_id.to_string(),
        session_cwd: cwd.to_string(),
        events: Arc::new(AsyncMutex::new(Vec::new())),
        seq: Arc::new(AtomicU64::new(0)),
        status: Arc::new(AsyncMutex::new(StatusTracker::default())),
        queued: Arc::new(AsyncMutex::new(Vec::new())),
        pending: Default::default(),
        pending_questions: Default::default(),
    };

    let session = spawn_agent(
        Opening {
            project: cwd,
            session_id,
            session_cwd: cwd,
            handles,
            model,
            effort,
            permission_mode,
            is_new_session: true,
            fork_from: None,
            agent_name,
            record_thread: false,
        },
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
    if let Some(mut previous) = previous {
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
        if let Some(mut expired) = expired {
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
async fn spawn_child(cwd: &str) -> Result<Child> {
    child_command(cwd)
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
///
/// **No session is named in its environment**, and that is the sharing step's
/// consequence: one child carries several conversations, so there is no single
/// session a `HZ_SESSION_ID` could name — and a wrong one is worse than none,
/// since the `hz` CLI defaults to it. The agent names the session per turn
/// instead, in the environment of each tool child it spawns, which is the only
/// place that knows which conversation is running.
async fn child_command(cwd: &str) -> Command {
    let bin = crate::binpath::mcode().await;
    let mut command = Command::new(&bin).hide_console();

    if let Some(endpoint) = crate::orchestration::child_endpoint() {
        command.env("HZ_ENDPOINT", endpoint);
    }

    command.arg("acp");

    crate::harness::agent_env(&mut command, &bin).await;

    command.current_dir(cwd);
    command
}

/// Opens a session's conversation — on the project's child where one is up, on a
/// child of its own where none is — or adopts the one [`prepare`] already opened.
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

    // Everything about the session and nothing about the child: which child this
    // conversation lands on is the registry's answer, and both paths below open
    // the same conversation.
    //
    // Ahead of the spawn, and infallible from here on: everything between the
    // spawn and the kill-wrapped `open_session` has to be, or a `?` returns
    // leaving a child nothing can reach.
    let seq_start = if is_new_session {
        0
    } else {
        next_seq_by_session_id(session_id).await?
    };

    let handles = SessionHandles {
        session_id: session_id.to_string(),
        session_cwd: session_cwd.to_string(),
        events: Arc::new(AsyncMutex::new(Vec::new())),
        seq: Arc::new(AtomicU64::new(seq_start)),
        status: Arc::new(AsyncMutex::new(StatusTracker::default())),
        queued: Arc::new(AsyncMutex::new(Vec::new())),
        pending: Default::default(),
        pending_questions: Default::default(),
    };

    let opening = Opening {
        project: cwd,
        session_id,
        session_cwd,
        handles,
        model,
        effort,
        permission_mode,
        is_new_session,
        fork_from,
        agent_name,
        record_thread: true,
    };

    // **The project's child, if it has one.** This is the whole of the sharing
    // step: a second session in a project opens a conversation on the child that
    // is already up — measured at 0.02s, against a boot of ~6.5s and ~400MB for a
    // child of its own.
    match agent_for(cwd).await {
        Some(agent) => open_conversation(&agent, opening, None, app).await,
        None => spawn_agent(opening, app).await,
    }
}

/// Records the agent's own session id on the index entry, for the two paths that
/// mint a new one. A resume answers with the id it was given, so there is
/// nothing to write.
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

/// What opening one conversation needs: everything about the session, and
/// nothing about the child it lands on.
struct Opening<'a> {
    /// The directory the child runs in — the registry's key — and the cwd a
    /// *new* conversation is opened with. A worktree session's own tree is
    /// `session_cwd`.
    project: &'a str,
    session_id: &'a str,
    session_cwd: &'a str,
    handles: SessionHandles,
    model: Option<&'a Model>,
    effort: Option<Effort>,
    permission_mode: ApprovalPolicy,
    is_new_session: bool,
    fork_from: Option<&'a str>,
    agent_name: Option<&'a str>,
    /// Whether the agent's id is written onto the index entry. A send has an entry
    /// to write onto and a park does not: its session may never be sent, so the
    /// write would either fail or leave an entry pointing at a conversation nobody
    /// started.
    record_thread: bool,
}

/// Spawns a child for a project and opens its first conversation on it.
async fn spawn_agent(opening: Opening<'_>, app: &AppHandle) -> Result<Session> {
    let boot = Instant::now();
    let mut child = spawn_child(opening.project).await?;
    let spawned = boot.elapsed();

    let stdin = child.stdin.take().context("failed to take stdin")?;
    let stdout = child.stdout.take().context("failed to take stdout")?;
    let stderr = child.stderr.take().context("failed to take stderr")?;

    let client = RpcClient::new(stdin);
    let stderr_tail: StderrTail = Default::default();

    let ours = Arc::new(Agent {
        project: opening.project.to_string(),
        process: AsyncMutex::new(Some(child)),
        client,
        live: AsyncMutex::new(HashMap::new()),
    });

    // **The read loop first, and that ordering is load-bearing**: the handshake
    // below is a request whose reply only this loop can settle, so a handshake
    // awaited before it starts is a handshake that times out with the answer
    // sitting in the pipe. One loop per child, outliving every conversation it
    // will carry, and it is handed the first conversation's handles — what a line
    // naming no session at all is filed against.
    tokio::spawn({
        let reader = ReaderHandles {
            agent: ours.clone(),
            own: opening.handles.clone(),
            stderr_tail: stderr_tail.clone(),
            app: app.clone(),
        };
        async move {
            if let Err(error) = read_stdout(stdout, reader).await {
                eprintln!("Failed to read mcode stdout: {error}");
            }
        }
    });

    tokio::spawn(async move {
        if let Err(error) = read_mcode_stderr(stderr, stderr_tail).await {
            eprintln!("Failed to read mcode stderr: {error}");
        }
    });

    // **On the table, unless somebody else got there first.** Two sends racing a
    // cold project are both told there is no child and both spawn one; the table
    // keeps the first, and a conversation on the other would be unroutable —
    // every line is filed by the id the table holds it under. So the loser's
    // child goes and this opening uses the winner's.
    let agent = register(opening.project, ours.clone()).await;
    if !Arc::ptr_eq(&agent, &ours) {
        // Another send won the race, so this child has nothing to serve: it is
        // not the table's, and a conversation on it could never be routed.
        if let Some(mut child) = ours.process.lock().await.take() {
            let _ = child.kill().await;
        }
    }

    // The handshake, once per child and before any conversation exists: it is the
    // connection every conversation on it will be spoken over.
    let handshaking = Instant::now();
    if let Err(error) = handshake(&agent.client).await {
        // Post-spawn, so the child is running with nobody left to talk to it. A
        // `Child` is not reaped on drop, and nothing is registered as a
        // conversation yet, so this is the one path that ends the child itself.
        if let Some(mut child) = retract(&agent.project, &agent).await {
            let _ = child.kill().await;
        }
        return Err(error);
    }
    let handshaken = handshaking.elapsed();

    open_conversation(&agent, opening, Some((spawned, handshaken)), app).await
}

/// Opens one conversation on a child that is already up, and hands back the
/// session carrying it.
///
/// **No spawn and no handshake**, which is the whole of what the registry buys:
/// `session/new` measured at 0.02s on a warm child, against ~1.7s for a child's
/// first one and ~3s for the `initialize` in front of it.
///
/// A failure here gives up the conversation and **not** the child, unless this was
/// its only one — see [`abandon`]: the other sessions on a shared child are
/// nobody's to lose because one opening went wrong.
async fn open_conversation(
    agent: &Arc<Agent>,
    opening: Opening<'_>,
    boot: Option<(Duration, Duration)>,
    app: &AppHandle,
) -> Result<Session> {
    let Opening {
        session_id,
        session_cwd,
        handles,
        model,
        effort,
        permission_mode,
        is_new_session,
        fork_from,
        record_thread,
        agent_name,
        ..
    } = opening;

    let opening_at = Instant::now();
    let (mcode_id, config) = match open_session(
        &agent.client,
        session_id,
        session_cwd,
        is_new_session,
        fork_from,
        agent_name,
    )
    .await
    {
        Ok(opened) => opened,
        Err(error) => return Err(abandon(agent, error).await),
    };
    let opened = opening_at.elapsed();

    // Written before the first prompt, so a child dying mid-turn still leaves a
    // session to resume rather than one that silently starts over.
    if record_thread && (is_new_session || fork_from.is_some()) {
        if let Err(error) = store::set_session_thread_id(session_id, &mcode_id).await {
            return Err(abandon(agent, error).await);
        }
    }

    let session = McodeSession {
        client: agent.client.clone(),
        id: mcode_id,
        prompt_id: Arc::new(Mutex::new(None)),
        efforts: Arc::new(Mutex::new(None)),
        model: Arc::new(Mutex::new(None)),
        mode: Arc::new(Mutex::new(None)),
        goal_status: Arc::new(Mutex::new(None)),
        probe: Arc::new(Mutex::new(None)),
    };

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
    // incidental**: a ladder is per model, so an effort sent first is asked of the
    // model mcode opened on rather than the one the reader picked, and a rung the
    // new model does not have is refused for the old one's sake. The reply to the
    // model call is also what teaches the session the new model's ladder, which is
    // what the effort below is judged against.
    if let Some(model) = model {
        if let Err(error) = set_model(&session, model, app).await {
            return Err(abandon(agent, error).await);
        }
    }

    // A refused effort is **not** fatal, where a refused stance is. mcode declines
    // one on a model that does no reasoning, and killing the child over that means
    // a session whose recorded level its model has since stopped taking cannot be
    // resumed at all. So the level is dropped, the session runs on mcode's own
    // default, and the transcript says so — the same answer the in-place path in
    // [`crate::session`] gives, by design, since the reader cannot tell the two
    // moments apart.
    if let Some(effort) = effort {
        if let Err(error) = set_effort(&session, effort).await {
            note_effort(effort, &error.to_string());
        }
    }

    // The stance last, since a plan mode and a permission mode are the same
    // setting reached two ways, and `default` is where the plan branch has to
    // start from.
    if let Err(error) = set_mode(&session, permission_mode).await {
        return Err(abandon(agent, error).await);
    }

    // **One line per conversation start, and the outlier is what it is for.**
    // `session/new` has been measured at 1.07s, 1.76s, 3.65s and **12.71s** on the
    // same kind of child, and nothing in the app could say which phase the twelve
    // seconds were in — the transcript just looked slow. A conversation opened on
    // a child that is already up prints its own line instead, which is the sharing
    // step's win stated as a number.
    match boot {
        Some((spawned, handshaken)) => eprintln!(
            "[mcode timings] spawn {:.2}s handshake {:.2}s open {:.2}s settings {:.2}s",
            spawned.as_secs_f64(),
            handshaken.as_secs_f64(),
            opened.as_secs_f64(),
            settings.elapsed().as_secs_f64(),
        ),
        None => eprintln!(
            "[mcode timings] on a live child: open {:.2}s settings {:.2}s",
            opened.as_secs_f64(),
            settings.elapsed().as_secs_f64(),
        ),
    }

    // **On the table before the session is handed over**, so the first line the
    // loop has to file lands on an entry. What goes in is the read loop's own
    // per-conversation state: the mapper that numbers this conversation's events
    // and remembers its subagents, and the coalescer that holds one of its blocks.
    agent.live.lock().await.insert(
        session.id.clone(),
        Live {
            handles: handles.clone(),
            session: session.clone(),
            mapper: mapper::Mapper::new(handles.session_id.clone(), handles.seq.clone()),
            coalescer: Coalescer::new(),
        },
    );

    Ok(Session {
        handles,
        agent: agent.clone(),
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
    })
}

/// Gives up a conversation that could not be opened, taking the child with it
/// where nothing else is on it.
///
/// The child is what makes this more than bookkeeping: a private one that failed
/// its first conversation has nothing left to serve and a `Child` is not reaped on
/// drop — while a shared one has other sessions on it, which this must not take
/// down over a model that was refused.
async fn abandon(agent: &Arc<Agent>, error: anyhow::Error) -> anyhow::Error {
    let alone = agent.live.lock().await.is_empty();
    if alone {
        if let Some(mut child) = retract(&agent.project, agent).await {
            let _ = child.kill().await;
        }
    }

    error
}

/// Ends one conversation, and the child with it where nothing else is on it.
///
/// `session/close` first, so the agent runs its own teardown for that
/// conversation, and the process is then given the grace every other child here is
/// given and killed if it is still there. Killing it is the one thing that takes
/// the other conversations with it, which is why it happens exactly where the
/// count reaches zero.
pub async fn close(agent: &Arc<Agent>, session: &McodeSession) {
    let last = {
        let mut live = agent.live.lock().await;
        live.remove(&session.id);
        live.is_empty()
    };

    if !last {
        // Best effort: a refusal here is the agent's own record of a conversation
        // this app has already stopped routing to.
        let _ = session
            .client
            .request("session/close", json!({"sessionId": session.id}))
            .await;
        return;
    }

    if let Some(mut child) = retract(&agent.project, agent).await {
        shutdown(&mut child, session).await;
    }
}

/// The child's side of the handshake, once per process rather than once per
/// conversation: what it answers is the *connection's* capabilities, and every
/// conversation on this child is spoken over the same one.
async fn handshake(client: &RpcClient) -> Result<()> {
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
                    // Stated with `notifications: true` because two of these
                    // pushes have a screen behind them: the delegation roster and
                    // the goal. The queue, plan and current-session pushes that
                    // ride the same flag arrive as methods `parse_notification`
                    // does not model and are dropped, which is the ordinary path
                    // for a method we have no use for.
                    "_meta": {
                        "minimax-code/extensions": {"version": 1, "notifications": true}
                    },
                },
                "clientInfo": {"name": "hz", "version": env!("CARGO_PKG_VERSION")},
            }),
        )
        .await?;
    parser::InitializeResult::of(&init);

    Ok(())
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

    // No id, for the reason a shared child has none either: this one carries a
    // single scratch conversation that no `hz` call could be about, and the agent
    // names the session per turn for anything it spawns.
    let control_id = format!("hz-control-{}", std::process::id());

    // `kill_on_drop` where a session's child has it not: this one is owned by no
    // session and outlives no app, so a quit that dropped it must take the
    // process with it rather than leave an agent nobody can see or reach.
    let mut child = child_command(&scratch_cwd)
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
            goal_status: Arc::new(Mutex::new(None)),
            probe: Arc::new(Mutex::new(None)),
        },
        asked_at: Instant::now(),
        child,
        reader,
    })
}

/// A live child, and every conversation open on it.
///
/// **One child per project, and that is where this app's cost is.** A cold child
/// is ~6.5s to its first token and ~400MB resident — V8 parsing the bundle,
/// measured — while every `session/new` after the first on that same child is
/// **0.02s warm**. So a child is held for a *project* rather than for a session,
/// and the consequence is that no session owns it: this table does, a session
/// holds a reference so it can open and close its own conversation, and the child
/// dies with whichever close leaves it carrying none.
///
/// Nothing about a session stops being per-session because of it. A model, an
/// effort and a stance are ACP *session* settings — `session/set_config_option`
/// takes an id — so one child carries conversations on different models, which is
/// also why moving any of them never respawned anything.
pub struct Agent {
    /// The directory the child was spawned in, which is the table's key. The
    /// sessions it carries may each be in another one: `session/new` names the
    /// cwd per conversation, and a worktree session names its own tree.
    pub project: String,
    /// The process, taken out by whoever tears it down. `None` afterwards, so a
    /// second teardown finds nothing rather than signalling a pid the OS has since
    /// handed to something else.
    process: AsyncMutex<Option<Child>>,
    /// The pipe every conversation writes on: a line is addressed to the session
    /// id it names, and this end is shared. The read loop holds the other.
    client: RpcClient,
    /// The conversations open on it, by the id the agent minted for each.
    live: AsyncMutex<HashMap<String, Live>>,
}

impl std::fmt::Debug for Agent {
    /// Only what identifies it. A child is a process and a set of conversations,
    /// and neither belongs in a log line: this exists because the session that
    /// holds one derives `Debug`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Agent")
            .field("project", &self.project)
            .finish_non_exhaustive()
    }
}

impl Agent {
    /// The process's pid, or `None` once it has been torn down.
    ///
    /// **`None` while the child carries more than one conversation**, which is
    /// the one thing a shared child breaks about it: its descendants are every
    /// session's, so a caller asking "what did *this* session start" would be
    /// handed another session's dev server and told it was theirs. Callers that
    /// need an answer per session use the checkout instead — see
    /// [`crate::local_servers`], where the tree test is the signal that survives
    /// sharing and this one is the tie-breaker.
    pub async fn pid(&self) -> Option<u32> {
        let mut process = self.process.lock().await;
        let child = process.as_mut()?;

        (self.live.lock().await.len() < 2).then(|| child.id()).flatten()
    }

    /// Whether the shared process can still accept a conversation.
    async fn running(&self) -> bool {
        let mut process = self.process.lock().await;
        match process.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => true,
        }
    }
}

/// One conversation, as the read loop reaches it.
///
/// Per conversation rather than per child, and these four are exactly what cannot
/// be shared between two of them: the mapper numbers *these* events and remembers
/// *this* conversation's subagents, the coalescer holds one block's text, the
/// handles are this session's own log, queue and status, and the `McodeSession`
/// is what says which turn is running.
struct Live {
    handles: SessionHandles,
    session: McodeSession,
    mapper: mapper::Mapper,
    coalescer: Coalescer,
}

/// Every child this process is running, by project.
static AGENTS: LazyLock<AsyncMutex<HashMap<String, Arc<Agent>>>> =
    LazyLock::new(|| AsyncMutex::new(HashMap::new()));

/// The child a project is already running, if one is.
///
/// This is what makes a second session in a project cost two hundredths of a
/// second rather than a boot: the caller opens a conversation on the child it
/// finds here instead of spawning one.
pub async fn agent_for(project: &str) -> Option<Arc<Agent>> {
    AGENTS.lock().await.get(project).cloned()
}

/// The child a project can still send to, dropping a process that exited before
/// the read loop got around to retracting it.
pub async fn live_agent_for(project: &str) -> Option<Arc<Agent>> {
    let agent = agent_for(project).await?;
    if agent.running().await {
        Some(agent)
    } else {
        retract(project, &agent).await;
        None
    }
}

/// Puts a child on the table under the project it serves, unless one is there,
/// and answers with the child the table holds.
///
/// **The first one wins**, because two children under one key would leave the
/// loser's conversations unroutable — every line is filed by the id the table
/// holds it under — and two sends racing a cold project is exactly how that
/// happens. So a caller that finds somebody else's entry adopts it and drops its
/// own.
pub async fn register(project: &str, agent: Arc<Agent>) -> Arc<Agent> {
    let mut agents = AGENTS.lock().await;
    let held = agents.entry(project.to_string()).or_insert(agent);

    held.clone()
}

/// Takes a child off the table and hands back its process, for the one caller
/// that closed the last conversation on it.
///
/// **Identity-checked**, and for the reason the per-session registry was: a
/// project can have two children in flight for a moment — a replaced one still
/// draining its stdout while its replacement is already registered — and removing
/// by key alone would take the live child's entry with the dead one's, after which
/// every line of that project is dropped in silence.
async fn retract(project: &str, agent: &Arc<Agent>) -> Option<Child> {
    let mut agents = AGENTS.lock().await;
    if !agents.get(project).is_some_and(|held| Arc::ptr_eq(held, agent)) {
        return None;
    }
    agents.remove(project);
    drop(agents);

    agent.process.lock().await.take()
}

/// What one read loop owns.
///
/// The child, and the conversation the loop was started for. `own` is not the
/// conversation the loop *is* — a child carries several — it is the one that was
/// open first, which is what a line naming no session at all can still be
/// attributed to.
struct ReaderHandles {
    agent: Arc<Agent>,
    own: SessionHandles,
    /// The child's most recent stderr, for a turn that dies. See
    /// [`stderr_tail_note`].
    stderr_tail: StderrTail,
    app: AppHandle,
}

/// How long a line this child carries no conversation for is given before the
/// loop gives up on it.
///
/// **The window is a registration in flight, and it is microseconds wide.** The
/// agent pushes a session's settings and command list on the heels of
/// `session/new`, so the loop can read one before the app has the id to file it
/// under — the race the composer's command menu was lost to once already. Nothing
/// re-orders those two, so the loop waits a beat for the entry rather than
/// dropping the one push the menu lives on.
const CLAIM_GRACE: Duration = Duration::from_millis(200);

/// How often it looks while waiting.
const CLAIM_BEAT: Duration = Duration::from_millis(10);

/// Whether a line the loop cannot file yet is worth waiting for.
///
/// **The only thing worth waiting for is a registration in flight**, and the only
/// sign of one is that the child carries nothing at all yet: the first session on
/// a child is opened by the handshake that is already running. A line naming an
/// id while the child carries conversations is therefore a stranger — a session
/// from an hz that has since quit, or one deleted while its turn ran — and waiting
/// for it costs the loop a beat per line for nothing.
///
/// Free so the judgement is testable on three facts rather than through a child.
fn wait_for_registration(named: Option<&str>, carried: bool, any_live: bool) -> bool {
    named.is_some() && !carried && !any_live
}

/// The session a payload names, where it names one.
///
/// `params.sessionId` is the field ACP puts it on, for every session-scoped
/// notification and for both of the agent's requests — measured: 261 of the 262
/// inbound lines of one small turn carry it, and so do the goal and delegation
/// pushes, which is what leaves the routing rule one field wide.
fn line_session(params: &Value) -> Option<&str> {
    params.get("sessionId").and_then(Value::as_str)
}

impl ReaderHandles {
    /// Where a line goes: the id of a conversation this child carries, or `None`
    /// when nothing here can be it.
    async fn route(&self, params: &Value) -> Option<String> {
        let named = line_session(params).map(str::to_string);
        let give_up = tokio::time::Instant::now() + CLAIM_GRACE;

        loop {
            let (carried, any_live) = {
                let live = self.agent.live.lock().await;

                // A line that names no session can only be attributed by a child
                // carrying one conversation, and the loop's own is the first.
                if named.is_none() {
                    return live
                        .iter()
                        .find(|(_, entry)| Arc::ptr_eq(&entry.handles.seq, &self.own.seq))
                        .map(|(id, _)| id.clone());
                }

                let id = named.as_deref().expect("checked just above");
                if live.contains_key(id) {
                    return Some(id.to_string());
                }

                (false, !live.is_empty())
            };

            if !wait_for_registration(named.as_deref(), carried, any_live)
                || tokio::time::Instant::now() >= give_up
            {
                eprintln!(
                    "[mcode route] dropped a line for {}, which this child does not carry",
                    named.as_deref().unwrap_or("no session at all")
                );
                return None;
            }

            tokio::time::sleep(CLAIM_BEAT).await;
        }
    }
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

/// Hands a mapped event to the conversation it belongs to.
///
/// One place rather than three, because a frame boundary can fall in three of
/// them — behind the line just read, on the timer with no line behind it, and at
/// stdout's end — and a second copy of what it takes is a second thing to keep in
/// step. The conversation is an argument rather than a field because it is the
/// half that moves: a line is filed against the id it carries, so which
/// conversation this is changes from one line to the next.
async fn send(handles: &SessionHandles, session: &McodeSession, app: &AppHandle, event: AgentEvent) {
    // The transport a queued prompt is flushed over, which is this conversation's
    // own: two conversations on one child take turns independently.
    let transport = Transport::Acp(session.clone());
    let ingest = crate::session::Ingest {
        handles,
        harness: Mcode,
        transport: &transport,
    };
    crate::session::ingest(&ingest, event, app).await;
}

/// One conversation's handles and session, cloned out of the registry.
///
/// Cloned rather than borrowed because everything a line does with them awaits —
/// the log write, the status publish, a queued flush — and holding the registry
/// across that would stop a second conversation from opening for the length of
/// this one's turn.
async fn conversation(
    reader: &ReaderHandles,
    agent_id: &str,
) -> Option<(SessionHandles, McodeSession)> {
    let live = reader.agent.live.lock().await;
    let entry = live.get(agent_id)?;

    Some((entry.handles.clone(), entry.session.clone()))
}

/// The next moment the loop has something to do with no line behind it: the
/// earliest coalescer frame, per conversation.
async fn next_wakeup(agent: &Agent) -> Option<tokio::time::Instant> {
    let live = agent.live.lock().await;

    live.values().filter_map(|entry| entry.coalescer.deadline()).min()
}

/// Hands back what the coalescers are holding, for every conversation whose hold
/// has had its frame.
async fn flush_due(reader: &ReaderHandles) {
    let ready = {
        let mut live = reader.agent.live.lock().await;
        let mut ready = Vec::new();

        for entry in live.values_mut() {
            if !entry.coalescer.due() {
                continue;
            }
            let handles = entry.handles.clone();
            let session = entry.session.clone();
            for event in entry.coalescer.flush() {
                ready.push((handles.clone(), session.clone(), event));
            }
        }

        ready
    };

    for (handles, session, event) in ready {
        send(&handles, &session, &reader.app, event).await;
    }
}

/// Maps one event into its conversation, or collects it instead when that
/// conversation is probing.
///
/// The lock is taken and released around synchronous work only: mapping and
/// coalescing never await, and what does — `send` — happens after it.
async fn fold(
    reader: &ReaderHandles,
    agent_id: &str,
    handles: &SessionHandles,
    session: &McodeSession,
    event: parser::McodeEvent,
) {
    let ready = {
        let mut live = reader.agent.live.lock().await;
        let Some(entry) = live.get_mut(agent_id) else {
            return;
        };

        // **A probe's turn is read, not lived.** The agent answers `/context`
        // itself, so its turn costs no model time and must cost nothing on screen
        // either: every mapped event is dropped while a probe is set, and the text
        // deltas are what the caller gets back.
        let mut probe = session.probe.lock().expect("mcode probe poisoned");
        if probe.is_some() {
            for agent_event in entry.mapper.map(event) {
                if let AgentEventPayload::Delta(DeltaEvent::TextDelta { text, .. }) =
                    &agent_event.payload
                {
                    if let Some(held) = probe.as_mut() {
                        held.text.push_str(text.as_str());
                    }
                }
            }
            return;
        }
        drop(probe);

        // Whatever the coalescer hands back is ready to go out now — either the
        // event itself, or a held delta flushed ahead of a boundary.
        let mut ready = Vec::new();
        for mapped in entry.mapper.map(event) {
            ready.extend(entry.coalescer.push(mapped));
        }
        ready
    };

    for event in ready {
        send(handles, session, &reader.app, event).await;
    }
}

/// Empties the registry, handing back every conversation it was carrying — for
/// the child whose stdout has just ended.
///
/// What each coalescer was still holding goes out first: the reader watched that
/// text arrive, and it must not vanish because the child died a frame later.
async fn close_everything(reader: &ReaderHandles) -> Vec<(SessionHandles, McodeSession)> {
    let (orphaned, flushed) = {
        let mut live = reader.agent.live.lock().await;
        let mut orphaned = Vec::new();
        let mut flushed = Vec::new();

        for (_, entry) in live.drain() {
            let handles = entry.handles.clone();
            let session = entry.session.clone();
            let mut coalescer = entry.coalescer;

            for event in coalescer.flush() {
                flushed.push((handles.clone(), session.clone(), event));
            }
            orphaned.push((handles, session));
        }

        (orphaned, flushed)
    };

    for (handles, session, event) in flushed {
        send(&handles, &session, &reader.app, event).await;
    }

    orphaned
}

/// Reads the child's stdout for as long as it lives, filing every line against
/// the conversation it belongs to.
///
/// **The routing is the whole of what one child serving several sessions costs.**
/// A line names its session (`params.sessionId`), the registry holds a
/// conversation per session, and everything a line implies — the mapper numbering
/// it, the coalescer holding its text, the log it is appended to, the status it
/// moves, the queue it flushes — is looked up from that id rather than assumed.
/// Nothing about the loop is per-session: it reads one pipe.
async fn read_stdout(stdout: ChildStdout, reader: ReaderHandles) -> Result<()> {
    let mut lines = BufReader::new(stdout).lines();

    loop {
        // A frame boundary with **no line behind it**: what is held goes out now,
        // or the preview freezes for as long as the model keeps streaming — the
        // whole point of holding is that the next line may be a merge rather than
        // a boundary, and a burst of chunks carries no boundary at all.
        //
        // **Gated on `due`, and that gate is the whole mechanism.** Flushing on
        // every pass looked equivalent and was not: the hold is taken here and the
        // next push happens *after* it, so an unconditional flush emitted every
        // chunk one pass late and merged nothing at all.
        flush_due(&reader).await;

        let line = match next_wakeup(&reader.agent).await {
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

        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                record_failure(
                    Mcode,
                    &reader.own.session_id,
                    "parse",
                    "not a JSON-RPC message",
                    &line,
                )
                .await;
                continue;
            }
        };

        take_value(&line, value, &reader).await;
    }

    // Every conversation this child was carrying, each one's last held text
    // already flushed. The registry entry goes **before** the closing turns, so
    // nothing routes into it again — the child is gone.
    let orphans = close_everything(&reader).await;
    retract(&reader.agent.project, &reader.agent).await;

    // A prompt still in flight will never be answered, so its turn is closed as a
    // failure — without which the session hangs `in_progress` forever, its queue
    // with no boundary to drain at. The queue is stranded *first* (reported and
    // cleared), so the closing turn's boundary flush finds nothing to hand the
    // dead child.
    for (handles, session) in orphans {
        let outstanding = session
            .prompt_id
            .lock()
            .expect("mcode prompt id poisoned")
            .is_some();
        if !outstanding {
            continue;
        }

        crate::session::strand_queue_on_exit(&handles, Mcode, &reader.app).await;
        // The reason, carried where the failure is. A bundled app has no terminal
        // to read the child's stack from, so without this the row says only that
        // the agent exited — see [`stderr_tail_note`].
        let detail = stderr_tail_note(&reader.stderr_tail);
        let mapper = mapper::Mapper::new(handles.session_id.clone(), handles.seq.clone());
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
        send(&handles, &session, &reader.app, closed).await;
    }

    Ok(())
}

/// Files one parsed line against the conversation it belongs to.
///
/// `line` is the raw bytes beside the parsed value, and it is not redundant: a
/// form's steps are only in order in the bytes — see
/// [`parser::ElicitationEnvelope`] — and a `Value`'s object has already sorted
/// them.
async fn take_value(line: &str, value: Value, reader: &ReaderHandles) {
    // The prompt's own answer, read ahead of the demux: nothing waits on it, so
    // `accept` would file it as a stray. **Every conversation on the child is
    // asked**, because the turn in flight may belong to any of them — and the one
    // that matches is the one whose id is cleared, so the answer arrives exactly
    // once.
    if let Some(rpc_id) = value.get("id").and_then(Value::as_i64) {
        let settled = {
            let live = reader.agent.live.lock().await;
            live.iter()
                .find(|(_, entry)| settles(&entry.session, rpc_id))
                .map(|(id, entry)| (id.clone(), entry.handles.clone(), entry.session.clone()))
        };

        if let Some((id, handles, session)) = settled {
            fold(reader, &id, &handles, &session, prompt_event(&value)).await;
            return;
        }
    }

    match reader.agent.client.accept_value(value).await {
        Incoming::Notification { method, params } => {
            let Some(agent_id) = reader.route(&params).await else {
                return;
            };
            let Some((handles, session)) = conversation(reader, &agent_id).await else {
                return;
            };

            // **One of the agent's own extensions, sorted before the parser is
            // asked anything.** These ride beside ACP's as top-level methods rather
            // than as `session/update` payloads, so `parse_notification` would
            // answer `Ok(None)` and a roster the reader is watching would be
            // dropped in silence. Emitted, never logged: a snapshot names children
            // no child survives a restart.
            if method == delegation::NOTIFICATION {
                let roster = delegation::event_of(&params, &handles.session_id);
                if let Err(err) = reader.app.emit(delegation::EVENT, &roster) {
                    eprintln!("[delegation emit err] {err}");
                }
                return;
            }
            // The goal rides the same flag and is emitted for the same reason —
            // and here the push is not a convenience but the only account: the
            // runtime pauses and completes goals on its own, so a client that had
            // to ask would draw an objective the agent had already moved past.
            if method == goal::NOTIFICATION {
                let event = goal::event_of(&params, &handles.session_id);
                // **The moment a goal finishes becomes a line in the
                // conversation**, because nothing else about its work ever reaches
                // this wire: the runtime runs those turns inside itself and
                // publishes only status. Minted here, through the same sink every
                // mapped event takes, so it is numbered, emitted and persisted like
                // one of them.
                if let Some(finished) = session.note_goal(event.goal.as_ref()) {
                    let receipt = AgentEvent::mint(
                        handles.session_id.clone(),
                        Mcode,
                        handles.seq.fetch_add(1, Ordering::Relaxed),
                        None,
                        None,
                        crate::events::AgentEventPayload::GoalReceipt {
                            objective: finished.objective,
                            tokens_used: finished.tokens_used,
                            turns_used: finished.turns_used,
                            time_used_seconds: finished.time_used_seconds,
                        },
                    );
                    send(&handles, &session, &reader.app, receipt).await;
                }
                if let Err(err) = reader.app.emit(goal::EVENT, &event) {
                    eprintln!("[goal emit err] {err}");
                }
                return;
            }

            match parser::parse_notification(&method, params) {
                // A method this build does not model is not a failure: mcode's own
                // extensions ride in camel case beside ACP's, and dropping one
                // costs nothing on screen.
                Ok(None) => {}
                Ok(Some(update)) => {
                    note_update(&session, &update);
                    // **Outside any routing guard, and that is the point.** The
                    // list arrives on the heels of `session/new`, and this loop can
                    // see it before `init` has handed the session over — the copy
                    // this used to keep on the session was read by nothing, so in
                    // that race the commands were simply lost and the composer's
                    // menu stayed empty for the session's whole life.
                    if let parser::SessionUpdate::AvailableCommandsUpdate {
                        available_commands,
                    } = &update
                    {
                        let event = commands::SlashCommandsEvent {
                            session_id: handles.session_id.clone(),
                            commands: commands::from_commands(available_commands),
                        };
                        if let Err(err) = reader.app.emit("slash_commands", &event) {
                            eprintln!("[slash commands emit err] {err}");
                        }
                    }
                    fold(
                        reader,
                        &agent_id,
                        &handles,
                        &session,
                        parser::McodeEvent::Update(Box::new(update)),
                    )
                    .await;
                }
                Err(err) => {
                    record_failure(Mcode, &handles.session_id, "map", &err, line).await;
                }
            }
        }

        // Every agent request blocks the turn until it is answered, so silence
        // stalls the session exactly as an unanswered `can_use_tool` does.
        Incoming::Request { id, method, params } => {
            let carried = reader.route(&params).await;
            let conversation = match carried.as_deref() {
                Some(agent_id) => conversation(reader, agent_id).await,
                None => None,
            };

            let Some((handles, session)) = conversation else {
                // **Refused rather than dropped**, because a request is the one
                // line that must be answered either way: silence stalls the asking
                // session's turn exactly as an unanswered permission stalls ours.
                let _ = reader.agent.client.respond_err(
                    id,
                    -32601,
                    "This client cannot answer that request yet.",
                );
                return;
            };

            if method == "session/request_permission" {
                if let Err(err) = raise_permission(&handles, &reader.app, id, params).await {
                    record_failure(
                        Mcode,
                        &handles.session_id,
                        "unsupported_request",
                        &err.to_string(),
                        line,
                    )
                    .await;
                    let _ = session
                        .client
                        .respond(id, json!({"outcome": {"outcome": "cancelled"}}));
                }
            } else if method == "elicitation/create" {
                if let Err(err) = raise_question(&handles, &reader.app, id, line).await {
                    record_failure(
                        Mcode,
                        &handles.session_id,
                        "unsupported_request",
                        &err.to_string(),
                        line,
                    )
                    .await;
                    // Declined rather than left hanging: the agent reads that as
                    // "no answer", where silence blocks the turn exactly as an
                    // unanswered permission does.
                    let _ = session.client.respond(id, json!({"action": "decline"}));
                }
            } else {
                // `fs/*` and `terminal/*` were declined at the handshake, so one
                // arriving is mcode asking past the capabilities it was given.
                record_failure(Mcode, &handles.session_id, "unsupported_request", &method, line)
                    .await;
                let _ = session.client.respond_err(
                    id,
                    -32601,
                    "This client cannot answer that request yet.",
                );
            }
        }

        Incoming::Response { id, matched: false } => {
            let detail = format!("no caller waiting on id {id}");
            record_failure(Mcode, &reader.own.session_id, "stray_response", &detail, line).await;
        }
        Incoming::Response { .. } => {}

        Incoming::Malformed => {
            record_failure(Mcode, &reader.own.session_id, "parse", "not a JSON-RPC message", line)
                .await;
        }
    }
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

/// Whether this conversation is the one a line settles.
///
/// **Asked of every conversation on the child**, because the turn in flight may
/// belong to any of them: `session/prompt` blocks for the whole turn, so its
/// answer arrives as a response rather than a notification, and the request id
/// alone says whose it is. Clearing the id here is what makes the match
/// single-shot — a second conversation asked about the same line finds nothing.
fn settles(session: &McodeSession, rpc_id: i64) -> bool {
    let mut held = session.prompt_id.lock().expect("mcode prompt id poisoned");
    if *held != Some(rpc_id) {
        return false;
    }
    *held = None;

    true
}

/// The turn's end, or the reason it failed, out of the response's own fields.
fn prompt_event(value: &Value) -> parser::McodeEvent {
    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("mcode refused the prompt")
            .to_string();
        return parser::McodeEvent::PromptFailed { message };
    }

    let response = serde_json::from_value(value.get("result").cloned().unwrap_or(Value::Null))
        .unwrap_or_default();
    parser::McodeEvent::PromptDone(response)
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
    handles: &SessionHandles,
    app: &AppHandle,
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

    // Minted from the conversation's own counter rather than through a mapper:
    // the loop holds one mapper per child, and this card belongs to one
    // conversation of it.
    let event = AgentEvent::mint(
        handles.session_id.clone(),
        Mcode,
        handles.seq.fetch_add(1, Ordering::Relaxed),
        None,
        None,
        AgentEventPayload::PermissionRequested {
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
        },
    );

    app.emit("agent_event", &event)?;
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
    handles: &SessionHandles,
    app: &AppHandle,
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

    let event = AgentEvent::mint(
        handles.session_id.clone(),
        Mcode,
        handles.seq.fetch_add(1, Ordering::Relaxed),
        None,
        None,
        AgentEventPayload::QuestionsAsked {
            request_id,
            // No tool call behind it: mcode asks through its own extension rather
            // than through a tool the transcript drew, so there is no row for the
            // answers to be filed beside.
            tool_use_id: String::new(),
            questions,
        },
    );

    app.emit("agent_event", &event)?;
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

#[cfg(test)]
mod route_tests {
    use super::*;

    // **Every test here names a project of its own, and that is not tidiness.**
    // `AGENTS` is one table for the process, the harness runs tests in parallel,
    // and a shared key would let one test's child answer another's lookup — which
    // is exactly what happened: four of these were written against `/repo`, and
    // `the_first_child_under_a_project_keeps_the_key` failed on every full-suite
    // run because a sibling had got there first. The paths below are the keys, so
    // a test that reuses one is a test that races.

    /// A child with no process of its own: everything the registry does with one
    /// — the key, the lookup, the identity check — needs only the client, and
    /// `cat` is the cheapest honest way to have a pipe.
    ///
    /// The child is left running: `kill_on_drop` is not what this is testing, and
    /// the test process ends with it.
    async fn agent(project: &str) -> Arc<Agent> {
        let mut child = tokio::process::Command::new("cat")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("a child to hold the pipe");
        let stdin = child.stdin.take().expect("stdin");

        Arc::new(Agent {
            project: project.to_string(),
            process: AsyncMutex::new(None),
            client: RpcClient::new(stdin),
            live: AsyncMutex::new(HashMap::new()),
        })
    }

    fn named(id: &str) -> Value {
        json!({ "sessionId": id, "update": {} })
    }

    /// The field the id is read off, pinned: ACP puts it on `params.sessionId`,
    /// for every session-scoped line — including the goal and delegation pushes,
    /// which is what makes the routing rule one field wide.
    #[test]
    fn a_line_names_its_session_on_the_wire_s_own_field() {
        assert_eq!(line_session(&named("mvs_1")), Some("mvs_1"));
        assert_eq!(line_session(&json!({ "update": {} })), None);
    }

    /// **The one judgement in routing**, and it is a judgement rather than a
    /// lookup: a line this child carries nothing for is waited on exactly while a
    /// registration could be in flight, and dropped otherwise.
    ///
    /// The second half is the half that matters: a line naming an id while the
    /// child already carries conversations is a stranger — a session from an hz
    /// that has quit, one deleted while its turn ran — and waiting for it would
    /// cost the loop a beat per line for nothing.
    #[test]
    fn a_line_is_waited_for_only_while_a_registration_could_be_in_flight() {
        // Nothing registered yet, and the line names a session: the handshake that
        // is opening the first conversation may have it a beat from now.
        assert!(wait_for_registration(Some("mvs_1"), false, false));

        // The child carries something already, so nothing is in flight.
        assert!(!wait_for_registration(Some("mvs_1"), false, true));

        // Carried: nothing to wait for.
        assert!(!wait_for_registration(Some("mvs_1"), true, true));

        // A line naming no session never waits: it is either the loop's own
        // conversation or one nothing can be.
        assert!(!wait_for_registration(None, false, false));
    }

    /// The table is keyed by the project, and that is the whole of what makes a
    /// second session in one cost `session/new` instead of a boot.
    #[tokio::test]
    async fn the_registry_answers_for_the_project_it_holds() {
        let held = agent("/registry-answers").await;
        register("/registry-answers", held.clone()).await;

        assert!(agent_for("/registry-answers").await.is_some());
        assert!(agent_for("/other").await.is_none());
    }

    /// **The first child under a key keeps it.** Two sends racing a cold project
    /// are both told there is none and both spawn one, and the table cannot hold
    /// two: a conversation on the loser would be unroutable, since every line is
    /// filed by the id the table holds it under.
    #[tokio::test]
    async fn the_first_child_under_a_project_keeps_the_key() {
        let first = agent("/first-child-wins").await;
        let second = agent("/first-child-wins").await;

        assert!(Arc::ptr_eq(
            &register("/first-child-wins", first.clone()).await,
            &first
        ));
        assert!(Arc::ptr_eq(
            &register("/first-child-wins", second.clone()).await,
            &first
        ));

        let held = agent_for("/first-child-wins").await.expect("the entry stands");
        assert!(Arc::ptr_eq(&held, &first));

        // And the loser cannot take it, which is what the identity is for.
        assert!(retract("/first-child-wins", &second).await.is_none());
        assert!(agent_for("/first-child-wins").await.is_some());

        retract("/first-child-wins", &first).await;
        assert!(agent_for("/first-child-wins").await.is_none());
    }

    /// **A child's own teardown must not take a newer child's entry.** A child
    /// that dies is retracted by its own read loop, and that loop can arrive after
    /// a replacement has registered — so the removal is checked against the entry,
    /// not against the key.
    #[tokio::test]
    async fn a_stale_childs_teardown_leaves_a_newer_entry_standing() {
        let stale = agent("/stale-teardown").await;
        let live = agent("/stale-teardown").await;
        register("/stale-teardown", live.clone()).await;

        assert!(retract("/stale-teardown", &stale).await.is_none());

        let held = agent_for("/stale-teardown").await.expect("the newer child stands");
        assert!(Arc::ptr_eq(&held, &live));

        retract("/stale-teardown", &live).await;
    }

    /// Retracting a child takes its process with it, which is what makes closing
    /// the last conversation on one the end of the child.
    ///
    /// A pid is all this can honestly assert: the process is `cat`'s, and what
    /// matters is that the entry stops answering *and* that the process is handed
    /// to the caller rather than dropped — a `Child` that is dropped without
    /// being waited for leaves a zombie behind.
    #[tokio::test]
    async fn retracting_a_child_hands_back_its_process() {
        let mut cat = tokio::process::Command::new("cat")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("a child");
        let stdin = cat.stdin.take().expect("stdin");

        let held = Arc::new(Agent {
            project: "/retract-hands-back".to_string(),
            process: AsyncMutex::new(Some(cat)),
            client: RpcClient::new(stdin),
            live: AsyncMutex::new(HashMap::new()),
        });
        register("/retract-hands-back", held.clone()).await;

        let process = retract("/retract-hands-back", &held).await.expect("the process comes back");
        assert!(process.id().is_some());
        assert!(agent_for("/retract-hands-back").await.is_none());

        let mut process = process;
        let _ = process.kill().await;
    }
}
