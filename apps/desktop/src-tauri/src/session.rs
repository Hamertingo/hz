use crate::{
    attachments,
    context::ContextSnapshot,
    events::{
        now_rfc3339, prompt_ts, AgentEvent, AgentEventPayload, ApprovalPolicy, ErrorSource, ImageRef,
        MessageSender, PermissionBehavior,
    },
    git,
    harness::{
        mcode::{self, McodeSession},
        permissions::{PendingPermissions, Reply},
        questions::PendingQuestions,
        FastMode,
    },
    issues::{self, IssueRef},
    models::{resolve_effort, runs_on, Effort, Model, ModelId},
    store::{
        append_session_event, append_session_index_item, clear_fork_from, copy_session_log,
        delete_session, get_session_index_item, link_session_issue, list_session_events,
        record_context_reading, relocate_session_to_project, resolve_unclaimed_worktree_name,
        set_session_status, touch_session_index_item, worktree_path, SessionIndexItem, SessionSnapshot,
        SessionStatus,
    },
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

// `Harness` is defined in `crate::harness`; re-exported so existing
// `crate::session::Harness` imports keep working.
pub use crate::harness::Harness;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering::Relaxed},
        Arc,
    },
};
use tauri::{AppHandle, Emitter};
use tokio::{
    process::Child,
    sync::Mutex,
};

/// Emitted as `session_status` when a session's status changes, so the sidebar
/// and composer update without a refetch. Like `SessionTitleEvent`, this is not
/// an `AgentEvent`: it's derived state, and must never reach the `.jsonl` log.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SessionStatusEvent {
    pub session_id: String,
    pub status: SessionStatus,
    /// The entry's `modified` as the status write left it — completion bumps it,
    /// and the sidebar orders by it, so a session finishing has to move to the
    /// top without a refetch. `None` only when the id is no longer indexed.
    pub modified: Option<String>,
}

/// A prompt typed while a turn was running, held here until the turn reaches a
/// point where handing it to the CLI costs nothing.
///
/// It is *not* persisted while it waits, and that is what makes cancelling it
/// clean: the log is append-only, so a queued message written on arrival could
/// only be retracted with a tombstone event. Held here instead, a cancel leaves
/// no trace at all. Nothing is lost by waiting — the flush persists it, and the
/// only window where it exists solely in memory is one the user is still
/// allowed to take it back from.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct QueuedMessage {
    pub id: String,
    pub session_id: String,
    /// The raw prompt. Attachments are resolved at flush rather than now, so
    /// what the composer gets back on a cancel is what the user typed.
    pub text: String,
    pub attachment_paths: Vec<String>,
    /// Held with the prompt rather than looked up at flush: a relayed message
    /// can wait out a long turn, and the sending session may be renamed or
    /// deleted before the boundary that delivers it.
    #[serde(default)]
    pub from: Option<MessageSender>,
    /// Resolved when the prompt was typed, not at flush, for `from`'s reason:
    /// a held prompt can wait out a long turn, and re-reading the tracker at
    /// the boundary would put a network call — and its failure — inside the
    /// flush.
    #[serde(default)]
    pub issues: Vec<IssueRef>,
    /// The reader's clock at the press, carried through the wait rather than
    /// read at the flush. A held prompt can wait out a whole turn, and the one
    /// it opens is timed from the press — the boundary that released it is not
    /// something the reader did.
    #[serde(default)]
    pub sent_at: Option<String>,
}

/// Held prompts, oldest first. Shared with the stdout task, which is where the
/// boundary that flushes them is seen.
pub type QueuedMessages = Arc<Mutex<Vec<QueuedMessage>>>;

/// What a send did. The two fields are mutually exclusive in practice — a
/// session being created cannot already be running a turn — but they answer
/// different questions and the frontend acts on each separately.
#[derive(Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SendOutcome {
    /// `Some` only when this send created the session.
    pub snapshot: Option<SessionSnapshot>,
    /// `Some` when a turn was already running, so the prompt is held rather
    /// than sent. The frontend draws it as pending and can still take it back.
    pub queued: Option<QueuedMessage>,
    /// Every issue the session is linked to now, as written.
    ///
    /// Answered on **every** path — created, live, queued and resumed — because
    /// a `#DRA-53` is expanded and recorded on every one of them, and the
    /// frontend has no other way to learn what a prompt just linked. Without it
    /// a tag typed into an existing session persisted in Rust and reached the
    /// panel only on a reselect or a restart: the Issue tab went on drawing the
    /// session's old links while the index on disk held the new ones.
    ///
    /// The whole list rather than what this send added, for [`store::
    /// link_session_issue`]'s reason — re-tagging *replaces* an entry, so what
    /// changed is not a set the caller can apply on its own.
    pub issues: Vec<IssueRef>,
}

/// Whether a send has to replace the child rather than write to it.
///
/// A **setting change** waits for everything to be idle, background tasks
/// included: the kill takes a dev server or a Monitor with it, and the index
/// records the pick either way, so the next idle send is what applies it.
///
/// A **login that ran out** does not wait, and that asymmetry is the whole
/// reason this is a function. A deferred setting costs a pick that lands late;
/// a deferred login costs the session, because a logged-out child refuses every
/// prompt from its own memory and a `local_bash` task never ends on its own —
/// so "wait for idle" there means wait forever. The reader's only other cure
/// was restarting the app, which kills those tasks too, so the trade is a dev
/// server against a session and it was already being made.
///
/// A **turn in flight** refuses both. There is nothing to recover into while
/// the child is mid-call, and a prompt arriving then is queued below instead.
fn respawn_needed(
    auth_failed: bool,
    turn_in_flight: bool,
    busy: bool,
    settings_changed: bool,
) -> bool {
    if turn_in_flight {
        return false;
    }
    auth_failed || (!busy && settings_changed)
}

/// Drives [`SessionStatus`] from the mapped event stream plus the user's own
/// sends.
///
/// Two axes, deliberately kept apart. The status follows the *turn*: a `result`
/// completes it, whatever background tasks are outstanding. The task set is
/// recorded beside it and answers one question only — whether the child can be
/// replaced — because a subagent that reports back later opens its own turn
/// (a promptless `init`) to do so, while a `local_bash` task may never end.
#[derive(Debug, Default)]
pub struct StatusTracker {
    status: SessionStatus,
    /// An `init` opened a model call that no `result` has closed yet.
    model_call_open: bool,
    /// The outstanding background tasks. Only whether the set is empty is read
    /// in anger — by `has_outstanding_work` and by the stranded-task sweep a
    /// dying child runs — and the ids are kept rather than a count because the
    /// set arrives whole on every `background_tasks_changed` and the tests pin
    /// that it is recorded as sent. The panel's per-task stop names an id off
    /// those same events, not off here.
    background_tasks: Vec<String>,
    /// Main-thread tool calls started and not yet finished. Not a status input —
    /// it decides whether an arriving prompt is written now or held.
    open_tool_calls: usize,
    /// The newest turn died for want of a login.
    auth_failed: bool,
}

impl StatusTracker {
    /// The user sent a prompt; work is starting regardless of what stdout says.
    pub fn on_send(&mut self) -> Option<SessionStatus> {
        self.model_call_open = true;
        self.set(SessionStatus::InProgress)
    }

    /// Advances on one mapped event. `Some` when the status changed — the
    /// caller persists and emits only then.
    pub fn on_event(&mut self, payload: &AgentEventPayload) -> Option<SessionStatus> {
        match payload {
            // Fires per model call, not per prompt — including the call the
            // agent opens for itself to report a finished background task. That
            // one arrives with no send in front of it, so a completed session
            // must be able to go straight back to in-progress here.
            AgentEventPayload::TurnStarted(_) => {
                self.model_call_open = true;
                self.set(SessionStatus::InProgress)
            }
            // A `result` ends the turn whatever tasks are outstanding. Holding
            // the session open on them was built for a subagent that reports
            // back later — but that report opens its own turn (`TurnStarted`
            // above), so the hold bought nothing there and cost everything for
            // a `local_bash` task that never ends: a dev server, a Monitor, a
            // poll loop kept the Stop button, the indicator and the completion
            // notice hanging until the reader clicked Stop.
            AgentEventPayload::TurnCompleted { auth_failed, .. } => {
                self.model_call_open = false;
                self.auth_failed = *auth_failed;
                self.set(SessionStatus::Completed)
            }
            // Recorded, never a status input. The set has its own indicator
            // and its own per-task Stop.
            AgentEventPayload::BackgroundTasksChanged { tasks } => {
                self.background_tasks = tasks.iter().map(|t| t.task_id.clone()).collect();
                None
            }
            _ => None,
        }
    }

    /// Whether anything at all is still working, background tasks included.
    ///
    /// The safe-to-replace-the-child question, and nothing else. Wider than the
    /// status: a session whose turn ended reads `Completed` while a background
    /// task still runs, and killing that child would take the task with it.
    pub fn has_outstanding_work(&self) -> bool {
        self.model_call_open || !self.background_tasks.is_empty()
    }

    /// Whether a model call is open right now. Two readers: it decides that an
    /// arriving prompt is queued rather than sent — read *before* `on_send`,
    /// which opens one unconditionally and would answer for itself — and it is
    /// what [`SessionManager::fork`] refuses on.
    ///
    /// Also exactly what [`SessionStatus::InProgress`] reports, which is the
    /// reading the sidebar's own fork guard takes. Neither side can call the
    /// other, so that equivalence is pinned by test rather than assumed.
    ///
    /// Deliberately narrower than [`has_outstanding_work`](Self::has_outstanding_work). A background task
    /// keeps that one true long after its turn ended, but the CLI's main thread
    /// is idle and answers a prompt straight away — verified
    /// against v2.1.232, where a prompt written with a background `sleep 300`
    /// outstanding was answered in 1.8s. Queueing on status instead held that
    /// prompt until the task drained, and since a `local_bash` task emits none
    /// of the boundaries `read_stdout` flushes at, "until it drained" was the
    /// whole wait.
    pub fn turn_in_flight(&self) -> bool {
        self.model_call_open
    }

    /// Whether the newest turn failed on authentication.
    ///
    /// The child caches the answer to "am I logged in": once a CLI has decided
    /// it is not, every later prompt is refused from its own memory — measured
    /// at ~200ms with no network call — so a reader who logs in next door is
    /// still refused by the process that was already running. Restarting the
    /// app was the only cure, because that is the only thing that dropped the
    /// child. Read by [`SessionManager::send_msg`] as one more reason to
    /// replace it.
    ///
    /// Cleared by the next turn to complete, since that one says so by
    /// completing — the same rule the composer's notice reads.
    pub fn auth_failed(&self) -> bool {
        self.auth_failed
    }

    /// The status the sidebar draws from, so a guard here can be checked
    /// against the word the frontend reads.
    pub fn status(&self) -> SessionStatus {
        self.status
    }

    /// Counts main-thread tool calls in and out. Fed separately from
    /// [`Self::on_event`] because only the caller holds the event envelope, and
    /// a *subagent's* tool call must not count: it runs on its own thread and
    /// its result is not a point where the CLI injects a queued prompt.
    pub fn note_tool_call(&mut self, payload: &AgentEventPayload) {
        match payload {
            AgentEventPayload::ToolCallStarted { .. } => self.open_tool_calls += 1,
            AgentEventPayload::ToolCallCompleted { .. } => {
                self.open_tool_calls = self.open_tool_calls.saturating_sub(1)
            }
            // A turn cannot end with a call still running, and an interrupt ends
            // one without completing its calls — so the count is reset here
            // rather than left to drift up over a session.
            AgentEventPayload::TurnCompleted { .. } => self.open_tool_calls = 0,
            _ => {}
        }
    }

    /// Whether a main-thread tool call is running right now.
    ///
    /// This is what decides that a prompt goes out immediately instead of being
    /// held: the CLI injects a buffered prompt at the next tool *result*, and
    /// while a tool runs that result is still ahead — so writing now catches it,
    /// where waiting for the boundary this app can see would miss it by the few
    /// milliseconds between the result line and the model call that follows it.
    pub fn tool_in_flight(&self) -> bool {
        self.open_tool_calls > 0
    }

    /// Gives back a turn reserved by [`Self::on_send`] that never reached the
    /// child — an fx flush whose whole queue failed to send, or was emptied by
    /// a cancel between the reservation and the flush. Back to `Completed`, the
    /// state the ending turn would have left had nothing been queued behind it.
    pub fn release_reserved_turn(&mut self) -> Option<SessionStatus> {
        self.model_call_open = false;
        self.set(SessionStatus::Completed)
    }

    /// The user read the finished session. Only `Completed` clears — selecting
    /// a running session must not stop it reading as busy.
    pub fn mark_seen(&mut self) -> Option<SessionStatus> {
        (self.status == SessionStatus::Completed)
            .then(|| self.set(SessionStatus::Idle))
            .flatten()
    }

    fn set(&mut self, next: SessionStatus) -> Option<SessionStatus> {
        (self.status != next).then(|| {
            self.status = next;
            next
        })
    }
}

/// Deletes the worktree an index entry names, if it names one.
///
/// A session that never had a worktree is a no-op rather than an error: this
/// sits on the delete path too, where most sessions have no tree to remove.
///
/// The path is rebuilt from `project_path` and the name rather than read off
/// `cwd`. The two agree today, but `cwd` is a field the agent can move —
/// `EnterWorktree` relocates a live session — and the one argument this must
/// never get wrong is which directory to delete.
/// Answers whether a tree was actually **there** to remove.
///
/// Not the same question as whether this succeeded, which is why it is reported
/// separately: [`git::remove_worktree`] skips the removal outright for a path
/// that does not exist and treats a stale registration as the outcome it wanted,
/// so its `Ok` means "the tree is gone" and not "a tree was deleted". The
/// difference is the whole of it for anything counting the action — tidying up
/// after a tree somebody already removed by hand is not somebody deleting one.
async fn remove_session_worktree(item: &SessionIndexItem) -> Result<bool> {
    let Some(name) = item.worktree_name.as_deref() else {
        return Ok(false);
    };

    let path = worktree_path(&item.project_path, name);
    // Claude Code's own naming, minted at creation and never written to the
    // index — the same rebuild `sessionBranch` does on the frontend.
    let branch = git::worktree_branch(name);

    let existed = std::path::Path::new(&path).exists();

    git::remove_worktree(&item.project_path, &path, Some(&branch)).await?;

    Ok(existed)
}

/// Persists a status change and tells the frontend. Failures are logged, not
/// propagated: status is derived state, and losing one update must not take
/// down the stdout loop that noticed it.
pub async fn publish_status(session_id: &str, status: SessionStatus, app: &AppHandle) {
    // Read back off the write rather than recomputed here: which statuses bump
    // `modified` is `set_session_status`'s rule, and stating it twice is how the
    // sidebar and the disk drift apart.
    let modified = match set_session_status(session_id, status).await {
        Ok(item) => item.map(|i| i.modified),
        Err(e) => {
            eprintln!("[status write err] {e}");
            None
        }
    };

    let event = SessionStatusEvent {
        session_id: session_id.to_string(),
        status,
        modified,
    };
    if let Err(e) = app.emit("session_status", &event) {
        eprintln!("[status emit err] {e}");
    }
}

#[derive(Debug)]
pub struct SessionManager {
    pub sessions: Mutex<HashMap<String, Session>>,
    /// Sends that have begun and not yet handed their session over, and whether
    /// the reader asked to stop one while it ran.
    ///
    /// **A session is not in `sessions` until its child is up and its prompt is
    /// written.** The spawn, the handshake and the first `session/new` all sit
    /// inside `send_msg`, and measured together they are the better part of ten
    /// seconds on a cold child — while the frontend marks the turn `in_progress`
    /// the moment Enter is pressed. So Stop is offered for that whole window and
    /// used to answer "no running session <id>": an internal sentence, for the
    /// one control a reader reaches for when a start is slow.
    ///
    /// A plain `std::sync` lock, unlike the map above, because the guard's `Drop`
    /// is what takes an id back out and `Drop` cannot await. Nothing is held
    /// across an await — the map is read, written and released.
    starts: std::sync::Mutex<HashMap<String, bool>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            starts: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

/// A send that has begun and has not yet handed its session over.
///
/// **Drop is the whole of it.** `send_msg` leaves by a dozen doors — a refused
/// model, a checkout that will not land, a child that will not start — and every
/// one of them has to take the id back out, or a later Stop lands on a start
/// that is not running. The borrow is what ties the guard to the call.
struct Starting<'a> {
    manager: &'a SessionManager,
    session_id: String,
}

impl Drop for Starting<'_> {
    fn drop(&mut self) {
        self.manager
            .starts
            .lock()
            .expect("start map poisoned")
            .remove(&self.session_id);
    }
}

impl SessionManager {
    /// Records a send in flight, taking the id back out when it ends.
    fn starting(&self, session_id: &str) -> Starting<'_> {
        self.starts
            .lock()
            .expect("start map poisoned")
            .insert(session_id.to_string(), false);
        Starting {
            manager: self,
            session_id: session_id.to_string(),
        }
    }

    /// Whether the reader asked to stop this start while it was running.
    fn start_cancelled(&self, session_id: &str) -> bool {
        self.starts
            .lock()
            .expect("start map poisoned")
            .get(session_id)
            .copied()
            .unwrap_or(false)
    }

    /// Marks a start to be abandoned at the next seam, answering whether there
    /// was one to mark. `false` is "nothing of mine", and the caller says so.
    fn cancel_start(&self, session_id: &str) -> bool {
        match self
            .starts
            .lock()
            .expect("start map poisoned")
            .get_mut(session_id)
        {
            Some(cancelled) => {
                *cancelled = true;
                true
            }
            None => false,
        }
    }
}

/// One send: the prompt, what it carries, and the settings a new session starts
/// under.
///
/// **A struct rather than twenty-two arguments**, and the count is the point —
/// every field is genuinely one send's, they travelled together through the
/// manager, and a bare list of them meant a reader counting positions to know
/// which `Option<&str>` was the branch and which was the base ref. Clippy says
/// the same thing at seven arguments; this one was three times over.
pub struct SendRequest<'a> {
    pub session_id: &'a str,
    pub prompt: &'a str,
    /// Absolute paths of what the composer had attached. Re-read by the send
    /// rather than uploaded: the frontend holds a thumbnail, not the bytes.
    pub attachment_paths: &'a [String],
    /// Issues named outright rather than tagged in the text. `hz new --issue`
    /// is the only caller: the app sends none, since nothing in it starts a
    /// session against a row. Merged with the prompt's own `#` tags — and
    /// naming one here is what *links* it, where a tag in the text only
    /// mentions.
    pub issue_ids: &'a [String],
    pub harness: Harness,
    pub model: ModelId,
    pub effort: Option<Effort>,
    pub permission_mode: ApprovalPolicy,
    /// The composer's fast-mode pick. Clamped to what this harness and model
    /// have a route to before it is recorded — see `fast` in [`SessionManager::send_msg`].
    pub fast: bool,
    pub cwd: &'a str,
    /// Recorded, not acted on: the picker checks the branch out when the user
    /// picks it, so by here the tree is already on it.
    pub branch: Option<&'a str>,
    pub use_worktree: bool,
    pub worktree_name: Option<&'a str>,
    /// Where the worktree starts from, already resolved to a git ref by the
    /// caller — the orchestration socket turns a session id into one, and
    /// nothing below here knows sessions.
    pub base_ref: Option<&'a str>,
    /// A snapshot of *another* checkout's working tree, to start this session's
    /// worktree from — the second opinion's whole subject.
    ///
    /// A ref cannot carry it: `--from` holds committed work only, so a reviewer
    /// seeded from one sees the repository before the turn it was asked to
    /// review. Outranks [`Self::base_ref`], since a caller that named both meant
    /// the work. See `git::commit_tree`.
    pub seed_tree: Option<&'a str>,
    /// The Agent a new session runs *as*, or `None` for the runtime's own default.
    ///
    /// **Creation-time only, and that is the runtime's rule rather than this
    /// app's**: an Agent is composed into a Session when it is made, so a session
    /// that already exists keeps the one it was created with. Ignored for an
    /// existing session, which is why the composer hides the picker once a
    /// conversation has started.
    pub agent_name: Option<&'a str>,
    pub is_new_session: bool,
    /// Set only for a session created over the orchestration socket. Recorded
    /// rather than acted on — the depth cap reads it off the index on the
    /// *next* create.
    pub parent_session_id: Option<&'a str>,
    /// The session that relayed this prompt, for a message arriving over the
    /// orchestration socket. `None` everywhere else: the composer's prompts are
    /// the user's own, and a `user_message` with a sender is drawn differently.
    pub from: Option<MessageSender>,
    /// The reader's clock at the press, from the webview that saw it — the
    /// composer's own `new Date()`, since only it knows when Enter landed.
    /// `None` for every caller that is not a person: `hz send` relaying, and
    /// `hz new` starting a session an agent asked for.
    pub sent_at: Option<&'a str>,
}

impl SessionManager {
    /// Routes a prompt to a session: spawns a new child, reuses a live one, or
    /// respawns it from its own agent session when the process is gone.
    pub async fn send_msg(
        &self,
        request: SendRequest<'_>,
        app: &AppHandle,
    ) -> Result<SendOutcome> {
        // Unpacked here once, so the body below reads exactly as it did when
        // these were twenty-two parameters — the struct is about the call site
        // and the signature, not about renaming everything inside it.
        let SendRequest {
            session_id,
            prompt,
            attachment_paths,
            issue_ids,
            harness,
            model,
            effort,
            permission_mode,
            fast,
            cwd,
            branch,
            use_worktree,
            worktree_name,
            base_ref,
            seed_tree,
            agent_name,
            is_new_session,
            parent_session_id,
            from,
            sent_at,
        } = request;

        // For the whole of this call, and taken back out however it leaves. The
        // live path below holds its session in `sessions` already, so this
        // covers exactly the window where Stop has nothing else to land on.
        let _starting = self.starting(session_id);

        // The machine's answer, not a table: the agent states what it will take
        // on this account and these providers, so a model shipped after this
        // build still spawns. `None` is legal and means "let mcode decide" — its
        // own settings already name one, and hz naming a model the reader has no
        // key for is the worst possible first run.
        let model_spec = crate::harness::mcode::models::find(&model).await;

        // A model belongs to exactly one harness, and the pair reaches here from
        // two places that each know only half of it — the composer's stored
        // defaults and the `hz` CLI's own flags — so nothing upstream makes
        // them agree. Refused rather than quietly repaired: a session running on
        // a model nobody picked is the failure that looks like success.
        //
        // The unset sentinel is exempt: it names no model, so there is nothing
        // to be wrong about, and refusing it would refuse pi's own default.
        // Codex answers the wider question itself: the lookup above
        // searched what Codex reported *and* the table, where `runs_on`
        // knows only the table and would refuse a model newer than this
        // build.
        // The live list answers the wider question: it holds what the agent
        // reported, where `runs_on` knows only the table and would refuse a
        // model newer than this build.
        let runnable = model_spec.is_some() || runs_on(&model, harness);

        if !model.is_unset() && !runnable {
            let named = model_spec
                .as_ref()
                .map(|m| m.label.clone())
                .unwrap_or_else(|| model.to_string());
            bail!("{named} is not a {} model", harness.label());
        }

        let effort = model_spec
            .as_ref()
            .and_then(|spec| resolve_effort(spec, effort));

        // Clamped to what this harness *and this model* have a route to, and
        // clamped **here** so the index records what the child was told rather
        // than what was asked for. A `true` sitting on an entry that cannot
        // honour it is not a cosmetic lie: it draws a lit switch over a session
        // running at ordinary speed, and `hz new` hands it down to every
        // same-harness child the session spawns.
        //
        // Both halves are needed and the composer is not one of them. It runs
        // the same narrowing in `fastFor`, but `hz new --fast --model haiku`
        // never goes near it — the orchestration socket reaches this function
        // directly, which is the whole reason the rule is restated on this side.
        //
        // `None` means no model was named at all, since a model that *is* named
        // and cannot run here already bailed above. fx is the one harness where
        // that is ordinary and still fast: it applies fast mode per model itself
        // and publishes no list of which, so "let fx decide" is as able to run
        // fast as any named model. `standsWithNoModel` in `fastMode.ts` is the
        // same reading, stated there because neither side can call the other.
        let fast = fast
            && harness.caps().fast_mode.offered()
            && model_spec.as_ref().map_or(
                harness.caps().fast_mode == FastMode::AtCreation,
                |spec| spec.supports_fast,
            );

        // Resolved once for every path below — created, live, queued and
        // resumed alike — so a `#DRA-53` means the same thing whichever one the
        // prompt takes. The prompt comes back with any *named* issue appended as
        // a tag, so from here `prompt` is what the model will actually be given
        // and the transcript will actually draw. Best effort by design: an
        // unreachable tracker leaves the text as it was and costs nothing else.
        //
        // Two lists, and the split is the point: `mentioned` rides the prompt
        // event so the tag draws as a button, `linked` is written onto the
        // session and holds only what a caller named outright. See
        // [`issues::expand_tags`].
        let expanded = issues::expand_tags(prompt, issue_ids).await;
        let prompt = expanded.prompt.as_str();
        let issues = &expanded.mentioned;
        let linked_issues = &expanded.linked;

        if is_new_session {
            // Refused before anything is written, and that ordering is the
            // whole of it. The index entry lands before spawn on purpose, so a
            // session failing for a reason we could not predict is still
            // visible in the sidebar — but a missing CLI is predictable, and
            // taken through that path it leaves an empty row pointing at an
            // agent that can never start, which every retry fails against
            // identically.
            //
            // Refusing here instead means there is nothing to delete and
            // nothing to select: the composer never unmounts, `useDraft` still
            // holds the text under the new-task key, and retry is pressing send
            // again once the CLI is installed.
            if !crate::binpath::agent_available(harness).await {
                bail!(
                    "{} isn't installed. Install it with `{}`, then send again.",
                    harness.label(),
                    harness.install_command(),
                );
            }

            // Only Claude Code's `-w` makes its own tree. For everything else
            // the tree has to be one hz makes — the same route `--from`
            // already takes, started where the CLI would have started it.
            // Without this the tree is never created, and the session bails
            // inside `Session::init` with its row already in the index: a
            // sidebar row pointing at a directory that never existed and can
            // never start. `HEAD` where there is no remote, matching what the
            // CLI itself falls back to when the fetch fails.
            let resolved_base = match (harness.caps().creates_own_worktree, use_worktree, base_ref) {
                // A seed is a base of its own, so the default is not fetched for
                // it: `default_base` reaches the remote, and the answer would be
                // thrown away.
                (false, true, None) if seed_tree.is_none() => {
                    Some(git::default_base(cwd).await.unwrap_or_else(|| "HEAD".into()))
                }
                _ => None,
            };

            // **The work, not the last commit.** A snapshot of another checkout
            // is pinned to a commit so `worktree add` can check it out at all —
            // see `git::commit_tree` for why a ref will not carry it. It leads
            // the base, because a caller that named both meant the work.
            let seeded = match seed_tree {
                Some(tree) => {
                    let head = git::resolve_commit(cwd, "HEAD").await;
                    Some(git::commit_tree(cwd, tree, head.as_deref()).await?)
                }
                None => None,
            };
            let base_ref = seeded.as_deref().or(base_ref).or(resolved_base.as_deref());

            let worktree_name = if use_worktree {
                Some(resolve_unclaimed_worktree_name(cwd, worktree_name).await?)
            } else {
                None
            };

            let session_cwd = match &worktree_name {
                Some(name) => worktree_path(cwd, name),
                None => cwd.to_string(),
            };

            // Read back rather than taken from the caller: the picker sends
            // `None` when the user didn't touch it, and the repo is still on
            // some branch worth recording. Non-repos report `None` and stay that
            // way.
            //
            // Ahead of the worktree below, though it reads the project root and
            // `worktree add` never moves that HEAD: it is one more fallible step
            // that would otherwise sit inside the window the rollback has to
            // cover, and the shortest window is the one least able to go wrong.
            let branch = match branch {
                Some(b) => Some(b.to_string()),
                None => git::list_branches(cwd).await?.current,
            };

            // A base ref is the one case hz makes the tree itself. The harness
            // cannot be told where to fork from — `-w` resolves the default
            // branch and fetches `origin/<it>`, and its flag surface exposes no
            // base at all — so the tree is created here and the child is spawned
            // *into* it with no `-w`. Refused for a session with no worktree,
            // which would mean checking a ref out over whatever the reader has
            // in the project root.
            //
            // Ahead of the index write, unlike the spawn below: a base git
            // cannot resolve has left nothing behind at all and the caller is
            // getting the error.
            let owned_worktree = match (base_ref, &worktree_name) {
                (Some(base), Some(name)) => {
                    git::create_worktree(cwd, name, base).await?;
                    true
                }
                (Some(_), None) => bail!("a base ref needs a worktree to check it out into"),
                (None, _) => false,
            };

            // Indexed before the process spawns, so a session that fails to
            // start is still visible rather than vanishing without a trace.
            let mut item = SessionIndexItem::new(
                session_id,
                harness,
                &session_cwd,
                cwd,
                worktree_name.as_deref(),
                branch.as_deref(),
                prompt,
                model,
                effort,
                permission_mode,
                fast,
                parent_session_id,
            );
            // Written with the entry rather than linked after it: the row
            // appears before the child spawns, and a tab that arrived a beat
            // later would be one more thing moving while the first turn starts.
            item.issues = linked_issues.clone();

            // The one failure that has to undo the tree, and the row that just
            // failed to be written is exactly why: removal is offered from a
            // session's own row, so an orphan here is one nothing in the app can
            // ever reach and `git worktree remove` by hand is the only recovery.
            // The spawn below is deliberately *not* covered — by then the row
            // exists, and deleting the session already takes the tree with it.
            //
            // Only a tree hz made. A `-w` one does not exist yet, and the
            // failed create above left nothing to undo.
            if let Err(e) = append_session_index_item(item.clone()).await {
                if owned_worktree {
                    // Logged, not propagated: the caller has to see what
                    // actually failed, not how the tidy-up went.
                    if let Err(undo) =
                        git::remove_worktree(cwd, &session_cwd, item.branch.as_deref()).await
                    {
                        eprintln!("could not roll back {session_cwd}: {undo}");
                    }
                }
                return Err(e);
            }

            // Reported here rather than at the top of this block, where the
            // harness is already known: everything between the two can still
            // fail, and a session counted before its row exists is a start that
            // never happened. Which harness and model people actually reach for
            // is the question this answers — nothing about the prompt, which is
            // the reader's own text and never leaves the machine.
            // Read off the index entry rather than the arguments, which the
            // build above has already consumed — and which is the better source
            // anyway: this reports what was actually written down.
            crate::analytics::track(
                "session_started",
                serde_json::json!({
                    "harness": item.harness,
                    "model": item.model.as_str(),
                    "effort": item.effort,
                    "permission_mode": item.permission_mode,
                    "fast": item.fast,
                    "worktree": item.worktree_name.is_some(),
                    "spawned": item.parent_session_id.is_some(),
                }),
            );

            // Taken before the child exists, so nothing it does can end up
            // inside its own baseline. A worktree the CLI has yet to create has
            // no directory to snapshot, so that case resolves the fork point the
            // tree will start from instead — slightly approximate, since the CLI
            // fetches `origin/<default>` first and an upstream commit landing in
            // between would read as this turn's work. A tree created above has
            // none of that: it is on disk and clean, so its snapshot is exact.
            let baseline = match (owned_worktree, worktree_name.is_some()) {
                (false, true) => git::base_ref_tree(cwd).await,
                _ => git::snapshot_tree(&session_cwd).await,
            };

            // A tree we made is a directory that already exists and a checkout
            // already on the right commit, so the child starts in it and is told
            // nothing about worktrees at all. Every other creation spawns at the
            // project root, because the directory `-w` is about to make cannot
            // be `chdir`ed into before it exists.
            let (spawn_cwd, spawn_worktree) = if owned_worktree {
                (session_cwd.as_str(), None)
            } else {
                (cwd, worktree_name.as_deref())
            };

            let mut session = Session::init(
                session_id,
                harness,
                model_spec.as_ref(),
                effort,
                permission_mode,
                spawn_cwd,
                &session_cwd,
                spawn_worktree,
                is_new_session,
                None,
                agent_name,
                app,
            )
            .await?;

            // **After the child is up, not before it.** This was spawned a few
            // lines above, while `Session::init` — the whole handshake, measured
            // at 5.3s — was still to come, so two copies of the same 28MB
            // runtime booted at once and the reader's own session waited behind
            // both. Nothing waits on the title, so it has no business in that
            // queue.
            //
            // Detached: generation takes ~16s, and it is an upgrade to the
            // prompt-derived title written above, never a prerequisite for it.
            // Spawned at the project root rather than `session_cwd` for the same
            // reason the harness child is: a worktree's directory does not exist
            // until the CLI creates it, and `current_dir` on a missing path
            // fails the spawn outright — which took every worktree session's
            // title with it, in silence.
            crate::title::spawn_title_generation(session_id, harness, prompt, cwd, app);

            // **The one seam a Stop can be honoured at.** The child is up, so it
            // can be killed; the prompt has not gone out, so there is nothing
            // half-delivered to explain. Everything earlier is a spawn that
            // cannot be aborted without dropping a half-built child, and
            // everything later is a turn the ordinary `session/cancel` already
            // stops.
            //
            // The reader's words are not lost: this fails the send, and the
            // composer puts the text back where they typed it.
            if self.start_cancelled(session_id) {
                let _ = session.kill().await;
                bail!("Stopped before the turn started.");
            }

            if let Err(error) = session
                .send_msg(prompt, attachment_paths, issues, baseline, from, sent_at, app)
                .await
            {
                // Nothing has this session yet — it is inserted below — so
                // returning here is the last anything can reach that child, and
                // a `Child` is not reaped on drop. Reachable with the child
                // alive and well on Codex, where the send is a request the
                // server can refuse or leave unanswered.
                let _ = session.kill().await;
                return Err(error);
            }
            // The prompt event is synthesized by `send_msg`, so read the log
            // back rather than returning empty — otherwise the frontend's first
            // render drops the user's own message.
            let events = list_session_events(session_id).await?;
            self.sessions
                .lock()
                .await
                .insert(session_id.to_string(), session);

            // Returned so the frontend learns the resolved worktree name and
            // the backend-truncated title rather than guessing either.
            return Ok(SendOutcome {
                issues: item.issues.clone(),
                snapshot: Some(SessionSnapshot {
                    index_item: item,
                    events,
                }),
                queued: None,
            });
        }

        let mut sessions_guard = self.sessions.lock().await;

        // Decided here rather than by the caller: the frontend's own `busy` is
        // optimistic, and this is the only reading taken on the same lock the
        // write goes out under.
        // Three readings, not one, because the questions below differ: whether
        // anything is working at all decides that the child must not be
        // replaced, while only an open model call means this prompt has a turn
        // to be folded into.
        let (busy, turn_in_flight, tool_in_flight, auth_failed) =
            match sessions_guard.get(session_id) {
                Some(s) => {
                    let tracker = s.status.lock().await;
                    (
                        tracker.has_outstanding_work(),
                        tracker.turn_in_flight(),
                        tracker.tool_in_flight(),
                        tracker.auth_failed(),
                    )
                }
                None => (false, false, false, false),
            };

        // Effort is fixed at spawn — the CLI has no `set_effort` control request
        // — so changing it means replacing the child. Resuming by id keeps the
        // conversation, and the log continues from the persisted seq.
        //
        // Never while anything runs, which is the *wider* reading on purpose:
        // the kill would destroy not just a turn in flight but every background
        // task the child is still carrying. The index still records the pick
        // below, so the next idle send is what respawns.
        // Codex respawns for its model and its stance as well. Not for want of
        // a per-turn override — `turn/start` carries model, effort and approval
        // policy, and this restates all three on every turn — but because a
        // stance is *two* settings and only one of them has a turn-level form.
        // `sandbox` is thread-level only, so applying a stance change in place
        // would move the approval policy and leave the sandbox where it was:
        // exactly the half-applied setting that makes a session more or less
        // free than the reader asked for. Respawning settles both at once, and
        // `thread/resume` carries the conversation across it.
        //
        //
        // A login that ran out is the other reason, and it is not a setting at
        // all — see [`respawn_needed`], which is where the two part company.
        let settings_changed = sessions_guard.get(session_id).is_some_and(|s| {
            let caps = s.harness.caps();

            (s.effort != effort && !caps.applies_effort_in_place)
                || (s.model != model && !caps.applies_model_in_place)
                || (s.permission_mode != permission_mode && !caps.applies_permission_in_place)
                // Only the harness whose fast mode rides the spawn. `InPlace`
                // is applied below without replacing anything, and `AtCreation`
                // is fx — where a respawn would *not* move it, since a resumed
                // fx session carries the stamp it was created with, so killing
                // the child would cost the reader a running conversation and
                // change nothing at all.
                || (s.fast != fast && caps.fast_mode == FastMode::OnSpawn)
        });

        if respawn_needed(auth_failed, turn_in_flight, busy, settings_changed) {
            if let Some(s) = sessions_guard.remove(session_id) {
                s.kill().await?;
            }
        }

        // The caller's `cwd` is a hint for a new session only. From here on the
        // recorded one wins: with a project picker the two can disagree, and
        // resuming in the wrong directory is both silent and destructive. It is
        // also where the baseline gets snapshotted, so a stale value would
        // diff the wrong tree.
        let indexed = get_session_index_item(session_id).await?;
        let session_cwd = match &indexed {
            Some(item) => item.cwd.clone(),
            None => cwd.to_string(),
        };

        // Recorded before the prompt goes out, and before the queue branch
        // below returns: a tag on a prompt held behind a running turn still
        // says what the session is about, and the panel's tab should not wait
        // on a boundary to appear. Failures are logged and dropped — the link
        // is a record, and losing one must not cost the send.
        //
        // What each write answered with is kept, because that is what goes back
        // to the frontend: re-tagging *replaces* an entry rather than appending
        // one, so the list as written is not something the caller could work out
        // from `issues` alone. A session nothing was tagged on answers with the
        // links it already had, so every path can report the same fact.
        let mut linked = indexed
            .as_ref()
            .map(|item| item.issues.clone())
            .unwrap_or_default();
        for issue in linked_issues {
            match link_session_issue(session_id, issue.clone()).await {
                Ok(next) => linked = next,
                Err(e) => eprintln!("[issue link err] {e:#}"),
            }
        }

        if let Some(s) = sessions_guard.get_mut(session_id) {
            // Before the send, so the index reflects intent even if writing to
            // the child fails — the prompt event is persisted ahead of stdin too.
            touch_session_index_item(session_id, model.clone(), effort, permission_mode, fast).await?;

            // A model call is open, so this prompt is held rather than sent, and
            // none of the live controls below fire with it — `set_model`,
            // `set_permission_mode` and `set_fast` alike. The first two were
            // verified switching an *idle* child; what any of them do to a turn
            // mid-flight is unknown, and a queued prompt is not worth finding
            // out on. The index above has the user's pick either way, so the
            // next idle send applies it.
            //
            // The cost is stated under _Known issues_ and is the same for all
            // three: the pick is on screen and in the index from here, while the
            // prompt this queue delivers still runs under the old one.
            //
            // Gated on the turn, not on `busy`: a session holding a background
            // task reads busy with its main thread idle, and queueing there left
            // the prompt waiting on a boundary that task would never produce.
            if turn_in_flight {
                // A tool is running, so the CLI's next injection point — that
                // tool's result — is still ahead, and writing now is what lands
                // the prompt on it. Holding for the `tool_call_completed` this
                // app can see would miss it: the CLI dispatches the next model
                // call within a few milliseconds of emitting the result line, so
                // the prompt would sit in its buffer through another whole tool
                // call before being read. Measured, and the reason this branch
                // exists rather than one uniform hold.
                //
                // The cost is that there is no window to cancel in — which the
                // UI states by itself, since a prompt written straight through
                // draws no pending row and so offers no Esc.
                // ACP has no injection point: `session/prompt` blocks for the
                // turn and a second one written meanwhile takes over the one id
                // the read loop settles the turn on, so the first is never
                // closed. A prompt typed mid-turn queues to the turn's end — and
                // the decision is atomic with the turn-end reservation, so a
                // completion cannot slip between the check and the enqueue.
                // `None` means the turn ended under this read: fall through and
                // start a new one.
                if matches!(s.stdin, Transport::Acp(_)) {
                    if let Some(queued) = s
                        .acp_queue_if_in_flight(
                            prompt,
                            attachment_paths,
                            issues,
                            from.clone(),
                            sent_at,
                        )
                        .await
                    {
                        return Ok(SendOutcome {
                            snapshot: None,
                            queued: Some(queued),
                            issues: linked,
                        });
                    }
                } else {
                    if tool_in_flight {
                        s.queue_and_flush(prompt, attachment_paths, issues, from, sent_at, app)
                            .await;
                        return Ok(SendOutcome {
                            issues: linked,
                            ..Default::default()
                        });
                    }

                    let queued = s
                        .queue_msg(prompt, attachment_paths, issues, from, sent_at)
                        .await;
                    return Ok(SendOutcome {
                        snapshot: None,
                        queued: Some(queued),
                        issues: linked,
                    });
                }
            }

            // The other side of the respawn rule above, and read off the same
            // table so the two cannot disagree. They were two equality tests
            // against two different harnesses, which is one edit away from a
            // pick that neither respawns for nor applies — recorded in the
            // index and never reaching the child.
            //
            // Reaching here with a changed pick at all means the respawn was
            // skipped because work was outstanding. The index still records it,
            // so the next idle send applies it.
            let caps = s.harness.caps();

            if caps.applies_model_in_place && s.model != model {
                // Claude Code names a default, so the spec is there by
                // construction. fx does not — a pick falling to "let fx
                // decide" has nothing to switch to, and the session stays on
                // whatever it is running, which is what the unset pick means.
                match model_spec.as_ref() {
                    Some(spec) => {
                        if let Err(err) = s.set_model(spec, app).await {
                            // The send still fails — the reader asked for a
                            // model they are not getting, and their prompt is
                            // better kept in the composer than run on another
                            // one. What must not survive it is the optimistic
                            // touch above: fx moves the provider ahead of a
                            // cross-provider model, so a refusal here can leave
                            // the child on a model neither side picked, and an
                            // index still naming the asked-for one sends every
                            // later prompt back into the same refusal.
                            // `set_model` has already adopted what fx answered.
                            //
                            // **Every field is the session's own here, which is
                            // what makes this different from the effort arm
                            // below.** That one records `s.effort` beside the
                            // *requested* mode and fast, because the blocks
                            // applying those still run after it. This returns,
                            // so none of them do — the child is on none of what
                            // was asked for, and an index naming any of it
                            // would be describing a session that does not
                            // exist.
                            touch_session_index_item(
                                session_id,
                                s.model.clone(),
                                s.effort,
                                s.permission_mode,
                                s.fast,
                            )
                            .await?;
                            return Err(err);
                        }
                    }
                    None if model.is_unset() => {}
                    None => bail!("no model to switch the session to"),
                }
            }
            if caps.applies_effort_in_place && s.effort != effort {
                // A declined effort must not take the prompt down with it. fx
                // refuses one on a model that does no reasoning, and losing the
                // message over a level is a far worse answer than running the
                // turn on fx's own default and saying so — which is the whole
                // of DRA-221: the refusal used to reach the reader as a raw
                // `-32602` where it reached them at all, with the index and the
                // picker both left naming a level the session was not on.
                if let Err(err) = s.set_effort(effort, app).await {
                    report_session_error(
                        session_id,
                        s.harness,
                        &format!("{err:#}"),
                        &s.seq,
                        &s.events,
                        app,
                    )
                    .await;
                    // Written back over the optimistic touch above, so the row
                    // and `hz ls` name the effort that is running rather than
                    // the one that was asked for. Every other field is still
                    // the pick: fast mode is applied below this block, so
                    // recording the child's current value here would drop it.
                    touch_session_index_item(
                        session_id,
                        model.clone(),
                        s.effort,
                        permission_mode,
                        fast,
                    )
                    .await?;
                }
            }
            if caps.applies_permission_in_place && s.permission_mode != permission_mode {
                s.set_permission_mode(permission_mode).await?;
            }

            // Last thing before the prompt goes down the pipe: the child is idle
            // but alive, so the narrower the gap the less of the user's own
            // editing lands on the turn's side of the diff.
            let baseline = git::snapshot_tree(&session_cwd).await;
            s.send_msg(prompt, attachment_paths, issues, baseline, from, sent_at, app)
                .await?;
            return Ok(SendOutcome {
                issues: linked,
                ..Default::default()
            });
        }

        touch_session_index_item(session_id, model, effort, permission_mode, fast).await?;

        // A fork that hasn't spawned yet. The app's half happened when the user
        // asked for it — log copied, entry written — and this is the spawn that
        // carries out the CLI's, after which the session resumes like any other.
        let fork_from = indexed.as_ref().and_then(|i| i.fork_from.clone());

        // A fork into a *new* worktree is the one resume whose directory does
        // not exist yet, and a missing directory cannot be `chdir`ed into.
        //
        // Read off `fork_from`, which is why every fork sets it now — pi's has
        // no CLI half to perform and ignores it, but "this fork has not spawned
        // yet" is a fact both need and only the entry can carry. Probing the
        // directory instead looks equivalent and is worse: a tree deleted by
        // hand would also read as unmade, and remaking it runs
        // `worktree add -B`, which *resets the branch* and takes any commits on
        // it with it.
        let unmade_worktree = fork_from
            .as_ref()
            .and(indexed.as_ref())
            .filter(|item| item.worktree_name.is_some())
            .cloned();

        // Two ways to make it, and which one is the harness's own answer.
        // Claude Code takes `-w` and creates the tree itself after launch, so
        // the child spawns at the project root and the baseline can only be the
        // fork point it is about to resolve. Every other harness needs the tree
        // to exist first — so hz makes it, and then the ordinary snapshot
        // works, which is the more exact of the two baselines.
        let mut pending_worktree = None;
        let (spawn_cwd, baseline) = match unmade_worktree {
            Some(item) if harness.caps().creates_own_worktree => {
                pending_worktree = item.worktree_name.clone();
                let baseline = git::base_ref_tree(&item.project_path).await;
                (item.project_path.clone(), baseline)
            }
            Some(item) => {
                // Made only once, however many times this runs. The tree is
                // created before the child is spawned and `fork_from` is only
                // cleared after it, so a spawn that fails leaves the
                // instruction standing and the next send arrives here again —
                // where `worktree add` on a path that exists refuses outright,
                // and a fork that failed to start once could never start at
                // all. Nothing is lost by adopting the tree: it belongs to this
                // fork, whose first send is what this is, so there is no work
                // in it yet to be surprised by.
                if !tokio::fs::try_exists(&session_cwd).await.unwrap_or(false) {
                    let name = item.worktree_name.clone().expect("checked just above");
                    let base = git::default_base(&item.project_path)
                        .await
                        .unwrap_or_else(|| "HEAD".into());

                    git::create_worktree(&item.project_path, &name, &base).await?;
                }

                (session_cwd.clone(), git::snapshot_tree(&session_cwd).await)
            }
            None => (session_cwd.clone(), git::snapshot_tree(&session_cwd).await),
        };

        // The CLI's half of a fork, for a harness that has one. pi's fork was
        // whole the moment its session file was copied, so it gets `None` here
        // and its spawn is an ordinary resume — while `fork_from` above stays
        // unfiltered, because both harnesses need the *other* fact in it: that
        // this is a fork's first send, so a worktree may still have to be made
        // and the instruction has to be cleared afterwards.
        let cli_fork = fork_from
            .as_deref()
            .filter(|_| harness.caps().fork_needs_cli);

        let mut session = Session::init(
            session_id,
            harness,
            model_spec.as_ref(),
            effort,
            permission_mode,
            &spawn_cwd,
            &session_cwd,
            pending_worktree.as_deref(),
            is_new_session,
            cli_fork,
            // A fork continues its parent's conversation, and the Agent comes
            // with it — the CLI copies the session whole, so naming one here
            // would be a second answer to a question already answered.
            None,
            app,
        )
        .await?;

        // After the spawn, so a child that fails to start leaves the instruction
        // standing and the next send forks again. Cleared before the prompt goes
        // out for the opposite reason: from here the CLI owns a session under
        // this id, and forking the parent a second time would abandon it.
        if fork_from.is_some() {
            clear_fork_from(session_id).await?;
        }

            // **The one seam a Stop can be honoured at.** The child is up, so it
            // can be killed; the prompt has not gone out, so there is nothing
            // half-delivered to explain. Everything earlier is a spawn that
            // cannot be aborted without dropping a half-built child, and
            // everything later is a turn the ordinary `session/cancel` already
            // stops.
            //
            // The reader's words are not lost: this fails the send, and the
            // composer puts the text back where they typed it.
            if self.start_cancelled(session_id) {
                let _ = session.kill().await;
                bail!("Stopped before the turn started.");
            }

        if let Err(error) = session
            .send_msg(prompt, attachment_paths, issues, baseline, from, sent_at, app)
            .await
        {
            // Same reason as the creation path above: the insert is below, so
            // this is the last reference to a child that is still running.
            let _ = session.kill().await;
            return Err(error);
        }
        sessions_guard.insert(session_id.to_string(), session);
        Ok(SendOutcome {
            issues: linked,
            ..Default::default()
        })
    }

    /// Copies a session onto a new id, to be continued separately from the one
    /// it came from. `worktree` puts the fork in a tree of its own rather than
    /// leaving it in the parent's directory.
    ///
    /// Nothing spawns here. The CLI's fork only happens on a spawn, and spawning
    /// one to sit idle would cost a child process per fork and a turn's wait
    /// before the row appeared — so this writes the app's half now and leaves
    /// [`fork_from`](crate::store::SessionIndexItem::fork_from) as the
    /// instruction for the first send. The copied log is what the fork replays
    /// meanwhile, so it opens reading exactly like its parent.
    ///
    /// Refused while the parent's turn is in flight, and on nothing wider. The
    /// CLI forks by reading the parent's transcript, which a live child is
    /// appending to mid-turn, so a fork taken there inherits half of one. A
    /// background task outstanding is not that case: it appends *after* the
    /// turn ended — that is how a subagent reports back — and what this takes
    /// is a copy at a point in time, which is what a fork is.
    ///
    /// Reading [`has_outstanding_work`](StatusTracker::has_outstanding_work)
    /// here was the bug. That is the safe-to-replace-the-child question, and
    /// this replaces no child — it borrowed a guard written for the paths that
    /// kill one. A `local_bash` task never ends on its own, so a session
    /// running a dev server could not be forked again for the rest of its life,
    /// while the menu item stayed enabled: the sidebar guards on
    /// `status === "in_progress"`, which the same `result` had already moved to
    /// `completed`. The two must answer one question, which they now do —
    /// `InProgress` *is* `turn_in_flight`, pinned by test. An item offering
    /// what this refuses reads as Fork being broken rather than busy.
    pub async fn fork(
        &self,
        session_id: &str,
        fork_id: &str,
        worktree: bool,
    ) -> Result<SessionSnapshot> {
        let parent = get_session_index_item(session_id)
            .await?
            .with_context(|| format!("unknown session {session_id}"))?;

        // Ahead of every write below, not left to the first send. A fork copies
        // the log and appends an index entry before any child exists, so a
        // refusal that late leaves a row in the sidebar holding a whole
        // conversation it can never carry on.
        if !parent.harness.caps().forkable {
            bail!("{} sessions cannot be forked yet", parent.harness.label());
        }
        if !parent.harness.names_a_cli() {
            bail!(
                "this session runs on {}, which this version of hz can't drive — update hz",
                parent.harness.label()
            );
        }

        if let Some(s) = self.sessions.lock().await.get(session_id) {
            if s.status.lock().await.turn_in_flight() {
                bail!("wait for the turn to finish before forking it");
            }
        }

        // Resolved against the project rather than the parent's own name, so a
        // fork of a fork can't collide with the tree it came from — and against
        // the index as well as disk, since a fork's tree does not exist until
        // its first send.
        let worktree_name = if worktree {
            Some(resolve_unclaimed_worktree_name(&parent.project_path, None).await?)
        } else {
            None
        };

        let events = copy_session_log(session_id, fork_id, &parent.cwd).await?;

        // The parent never got a conversation off the ground — indexed, then its
        // spawn failed — so the CLI has no transcript under that id to fork
        // from. Refused here, where it can be said plainly; left to the first
        // send it would come back as the CLI's own "no conversation found".
        // Checked after the copy because that read is what answers it, and it
        // writes nothing when there is nothing to write.
        if events.is_empty() {
            bail!("this session has no conversation to fork yet");
        }

        // For pi and omp this *is* the fork: their resume handle is the file, so
        // the copy carries the conversation and the first send is an ordinary
        // spawn. Propagated rather than logged, unlike the delete path's — a fork
        // whose file failed to copy would open as an empty session claiming to
        // hold its parent's conversation, and the entry has not been written yet,
        // so failing here leaves nothing behind.
        //
        let item = parent.fork(fork_id, worktree_name.as_deref());
        append_session_index_item(item.clone()).await?;

        Ok(SessionSnapshot {
            index_item: item,
            events,
        })
    }

    /// Stops the turn in flight and nothing else. Errors when no live child
    /// holds the id — nothing is running, so there is nothing to stop.
    ///
    /// Background tasks are deliberately left alone: backgrounding one asks for
    /// it to outlive the turn, and the CLI's own interrupt honours that. Stop
    /// used to fan `stop_task` out over the whole set, from when an outstanding
    /// task held the session `in_progress` — the status follows the turn alone
    /// now, so that fan-out only killed dev servers the reader still wanted.
    /// Per-task stops stay available in the subagent panel for the narrower ask.
    /// Asks the live child for its own context report, for the composer's panel.
    ///
    /// **A reading is a question only a live child can answer**, so the three
    /// ways this cannot is each its own sentence rather than one silence: no child
    /// up (a `Err`, because the panel has already drawn the last reading the index
    /// holds and the reader is owed the reason the refresh did nothing), the child
    /// mid-turn (the agent refuses a second prompt outright), and a child that
    /// answers no report — `Ok(None)`, the agent's own "No Runtime context
    /// snapshot is available for this session yet." until a turn has run on it.
    ///
    /// A report is written to the index before it is answered, so the reading on
    /// screen and the one a reopened session draws are the same answer.
    pub async fn context_snapshot(
        &self,
        session_id: &str,
    ) -> Result<Option<ContextSnapshot>, String> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(session_id) else {
            // The panel draws the last reading off the index, so this is not
            // "nothing to show" — it is why the *refresh* it just offered did
            // nothing, and it says so rather than repeating the agent's own
            // "nothing to count yet", which is a different fact about a live
            // child.
            return Err("This session's agent is not running — a reading is taken while it is.".into());
        };

        // Refused rather than queued: the agent answers a second prompt with an
        // error, and a reading taken mid-turn would be of a run in progress
        // anyway. The panel says so and the reader asks again when it settles.
        if session.status.lock().await.turn_in_flight() {
            return Err("The agent is mid-turn — read this again when it settles.".into());
        }

        let Transport::Acp(child) = &session.stdin;
        let text = mcode::probe_context(child).await.map_err(|e| format!("{e:#}"))?;

        // No report: the agent said something else, or nothing it counts yet.
        // Both read as "nothing to show" rather than as a failure.
        let Some(snapshot) = mcode::context::parse(&text) else {
            return Ok(None);
        };

        // Kept before it is answered, so the panel's reading and the one a
        // reopened session draws are the same answer. Best effort: a failed write
        // costs the next cold open, and refusing here would cost the live one.
        let reading = crate::context::ContextReading {
            ts: now_rfc3339(),
            snapshot: snapshot.clone(),
        };
        if let Err(e) = record_context_reading(session_id, reading).await {
            eprintln!("[hz] could not record the context reading: {e:#}");
        }

        Ok(Some(snapshot))
    }

    /// The agent's own roster of the work it delegated, read on demand.
    ///
    /// **Read on the session's own child**, not the control one: the agent
    /// resolves the root session from the id it is asked about, so a roster asked
    /// of a child that does not own it answers nothing. The push fires whenever
    /// the roster moves; this is what a pane opened after the last push reads,
    /// and it is live-only — nothing here is written to a log.
    pub async fn delegations(
        &self,
        session_id: &str,
    ) -> Result<Vec<mcode::delegation::DelegatedMember>, String> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(session_id) else {
            return Err(
                "This session's agent is not running — its subagents are read while it is.".into(),
            );
        };
        let Transport::Acp(child) = &session.stdin;
        mcode::delegation::snapshot(child)
            .await
            .map_err(|e| format!("{e:#}"))
    }

    /// Stops every subagent this session's root started, together.
    ///
    /// **The only stop there is.** The agent publishes no per-task handle over
    /// ACP, so there is nothing narrower to offer — see
    /// [`delegation`](crate::harness::mcode::delegation).
    pub async fn stop_delegations(
        &self,
        session_id: &str,
    ) -> Result<mcode::delegation::DelegationStop, String> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(session_id) else {
            return Err("This session's agent is not running, so there is nothing to stop.".into());
        };
        let Transport::Acp(child) = &session.stdin;
        mcode::delegation::stop(child)
            .await
            .map_err(|e| format!("{e:#}"))
    }

    /// A delegated child's own session, as this app's events.
    ///
    /// **The child's own stream never reaches this app** — it is a separate
    /// runtime Session, and the parent's ACP stream carries only the spawning call
    /// — so this read is the one way a subagent's work can be watched rather than
    /// merely counted. It attaches nothing on the agent's side, which is what makes
    /// polling it safe while the run is live, and what it answers with is the same
    /// event vocabulary the app draws a conversation from.
    pub async fn delegation_transcript(
        &self,
        session_id: &str,
        member_session_id: &str,
        limit: Option<u64>,
    ) -> Result<Vec<crate::events::AgentEvent>, String> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(session_id) else {
            return Err(
                "This session's agent is not running — a subagent's work is read while it is."
                    .into(),
            );
        };
        let Transport::Acp(child) = &session.stdin;
        mcode::delegation::transcript(child, member_session_id, limit)
            .await
            .map_err(|e| format!("{e:#}"))
    }

    pub async fn interrupt(&self, session_id: &str, _app: &AppHandle) -> Result<()> {
        let mut sessions_guard = self.sessions.lock().await;
        if let Some(session) = sessions_guard.get_mut(session_id) {
            return session.interrupt().await;
        }
        // The second lock is taken with the first released: nothing here holds
        // both, and holding them in a different order somewhere else is how a
        // deadlock is built.
        drop(sessions_guard);

        // **A session that is still starting has no turn to cancel, and a reader
        // who presses Stop on one means "never mind".** Recorded rather than
        // acted on, because the spawn cannot be aborted mid-flight — `send_msg`
        // honours it at the seam it already has, before the prompt goes out.
        if self.cancel_start(session_id) {
            return Ok(());
        }

        bail!("no running session {session_id}")
    }

    /// Hands every held prompt into the running turn, without stopping it.
    ///
    /// See [`Session::steer_queued`]: this is the reader's own alternative to
    /// interrupting a turn just to release a sentence they have already written.
    pub async fn steer_queued(&self, session_id: &str, app: &AppHandle) -> Result<usize> {
        let mut sessions_guard = self.sessions.lock().await;
        let Some(session) = sessions_guard.get_mut(session_id) else {
            bail!("no running session {session_id}");
        };

        session.steer_queued(app).await
    }

    /// Takes back the newest prompt still waiting on a boundary, returning it
    /// so the composer can put the text back where the user left it.
    ///
    /// A session with no live child answers `None` rather than erroring: the
    /// queue died with the process, which is the same "nothing to take back"
    /// the frontend already handles.
    pub async fn cancel_queued(&self, session_id: &str) -> Option<QueuedMessage> {
        let sessions_guard = self.sessions.lock().await;
        let session = sessions_guard.get(session_id)?;
        session.cancel_queued().await
    }

    /// Answers a permission request. Errors when the session has no live child:
    /// the request died with the process, and the CLI will re-ask on resume.
    pub async fn respond_permission(
        &self,
        session_id: &str,
        request_id: &str,
        option_id: &str,
        app: &AppHandle,
    ) -> Result<()> {
        let mut sessions_guard = self.sessions.lock().await;
        let Some(session) = sessions_guard.get_mut(session_id) else {
            bail!("no running session {session_id}");
        };
        session.respond_permission(request_id, option_id, app).await
    }

    /// Answers an `AskUserQuestion`. Fails for a dead child like
    /// [`respond_permission`](Self::respond_permission) does, and for the same
    /// reason: only the process that asked can be told.
    pub async fn answer_questions(
        &self,
        session_id: &str,
        request_id: &str,
        answers: Vec<mcode::elicitation::QuestionAnswer>,
        app: &AppHandle,
    ) -> Result<()> {
        let mut sessions_guard = self.sessions.lock().await;
        let Some(session) = sessions_guard.get_mut(session_id) else {
            bail!("no running session {session_id}");
        };
        session.answer_questions(request_id, answers, app).await
    }

    /// Takes back a question the reader would rather not answer, which is the
    /// TUI's own way out of a questionnaire.
    pub async fn cancel_question(
        &self,
        session_id: &str,
        request_id: &str,
        app: &AppHandle,
    ) -> Result<()> {
        let mut sessions_guard = self.sessions.lock().await;
        let Some(session) = sessions_guard.get_mut(session_id) else {
            bail!("no running session {session_id}");
        };
        session.cancel_question(request_id, app).await
    }

    /// Deletes the worktree a session was running in and moves the session to
    /// its project root, keeping the transcript and everything in it.
    ///
    /// The child is killed first and unconditionally, even when it is idle:
    /// its working directory is about to stop existing, and the lock git
    /// refuses the removal over names that process. A session with no live
    /// child is the ordinary case here — this is offered on settle, which is
    /// something a reader does to finished work.
    ///
    /// Ordering is the whole of the method. Disk first, index second: an entry
    /// relocated before a removal that then failed would describe a session as
    /// living at the project root while its files sat in a directory nothing
    /// pointed at any more.
    pub async fn remove_worktree(&self, session_id: &str) -> Result<SessionIndexItem> {
        let item = get_session_index_item(session_id)
            .await?
            .with_context(|| format!("no session {session_id}"))?;

        if item.worktree_name.is_none() {
            bail!("that session is not running in a worktree");
        }

        if let Some(session) = self.sessions.lock().await.remove(session_id) {
            session.kill().await?;
        }

        let existed = remove_session_worktree(&item).await?;

        let relocated = relocate_session_to_project(session_id)
            .await?
            .with_context(|| format!("no session {session_id}"))?;

        // Reported here and not at the command, since only this side can tell a
        // deletion from a tidy-up — and only on the explicit route: `delete`
        // calls the same helper, but removing a session is a different action
        // and counting it here would report two features for one press.
        if existed {
            crate::analytics::feature_used("worktree_deleted");
        }

        Ok(relocated)
    }

    /// Deletes a session: kills its child if one is running, then drops the
    /// index entry and the log. Returns whether the index held it.
    ///
    /// The agent process's pid, for finding what it started (a dev server is a
    /// descendant). `None` while no child is running.
    pub async fn child_pid(&self, session_id: &str) -> Option<u32> {
        self.sessions.lock().await.get(session_id).and_then(|s| s.child.id())
    }

    /// The child goes first and its lock is released before the disk work, so a
    /// dying process can't append one last event to a file we just removed.
    pub async fn delete(&self, session_id: &str) -> Result<bool> {
        let running = self.sessions.lock().await.remove(session_id);
        if let Some(session) = running {
            session.kill().await?;
        }
        #[cfg(all(feature = "cef", target_os = "macos"))]
        crate::cef::close_session(session_id);

        // Best-effort for the same reason the attachments below are, and with
        // one cost worth naming: a removal that fails here orphans the tree
        // with no UI left to retry from, since the row it hung off is about to
        // go. `git worktree remove` by hand is the recovery. Failing the
        // delete instead would be worse — the session the user asked to be rid
        // of would still be there.
        //
        // Deliberately *not* covered by the card the frontend raises when
        // [`remove_worktree`] above is refused. That card corrects a "Deleted"
        // the reader was shown and sends them back to the session to try again;
        // here they were shown nothing to correct, and the session it would be
        // keyed to is the one being deleted — so it would be a card about a row
        // that is gone, whose button leads nowhere. Saying this properly means
        // naming the orphaned path with no session behind it, which is a
        // channel of its own and not this one.
        if let Some(item) = get_session_index_item(session_id).await? {
            if let Err(e) = remove_session_worktree(&item).await {
                eprintln!("could not remove worktree for {session_id}: {e}");
            }
        }

        // Best-effort: the images are a convenience for the transcript that is
        // about to stop existing, so failing to remove them must not fail the
        // delete the user asked for.
        if let Err(e) = attachments::delete_session_attachments(session_id).await {
            eprintln!("could not delete attachments for {session_id}: {e}");
        }

        // pi keeps its own transcript beside hz's, because the *file* is its
        // resume handle. Left behind it is a whole conversation on disk that
        // nothing can ever reach again, the index entry naming it having just
        // gone. Best-effort and unconditional: a non-pi session has no such
        // file, and a missing one reads as done.
        if let Err(e) = crate::store::delete_pi_session_file(session_id).await {
            eprintln!("could not delete pi's session file for {session_id}: {e}");
        }

        // And omp's, for the same reason under a different file: its resume
        // handle is the transcript too, so leaving it behind orphans a whole
        // conversation on disk under `~/.hz/omp-sessions/`. Best-effort and
        // unconditional, and a missing one reads as done.
        if let Err(e) = crate::store::delete_omp_session_file(session_id).await {
            eprintln!("could not delete omp's session file for {session_id}: {e}");
        }

        delete_session(session_id).await
    }

    /// Clears a finished session's unread mark: `Completed` → `Idle`, anything
    /// else untouched. Returns the status as written, `None` for no change.
    ///
    /// The live tracker is updated first so the in-memory machine agrees with
    /// the index; a session with no live process falls back to the index alone.
    pub async fn mark_idle(&self, session_id: &str) -> Result<Option<SessionStatus>> {
        let sessions_guard = self.sessions.lock().await;

        if let Some(session) = sessions_guard.get(session_id) {
            let Some(next) = session.status.lock().await.mark_seen() else {
                return Ok(None);
            };
            set_session_status(session_id, next).await?;
            return Ok(Some(next));
        }
        drop(sessions_guard);

        match get_session_index_item(session_id).await? {
            Some(item) if item.status == SessionStatus::Completed => {
                set_session_status(session_id, SessionStatus::Idle).await?;
                Ok(Some(SessionStatus::Idle))
            }
            _ => Ok(None),
        }
    }
}

/// How a session writes to its child.
///
/// The two harnesses do not merely encode differently — they have different
/// shapes. Claude Code takes newline-delimited JSON and its reader shares the
/// pipe, because an unanswerable `control_request` has to be refused from where
/// it is read. `codex app-server` is a JSON-RPC peer, so every write goes
/// through one queue and a send has an answer worth waiting for.
///
/// An enum rather than two fields with one always `None`: a session has exactly
/// one way to write, and the compiler should say so.
#[derive(Clone, Debug)]
pub enum Transport {
    /// ACP over stdio, addressed to the session the CLI minted. See
    /// [`McodeSession`](crate::harness::mcode::McodeSession).
    Acp(McodeSession),
}

#[derive(Debug)]
pub struct Session {
    pub id: String,
    pub child: Child,
    /// Shared with the stdout task, which has to write back on its own: an
    /// unanswerable `control_request` must be refused from where it is read,
    /// since the CLI blocks its turn until something replies.
    pub stdin: Transport,
    pub harness: Harness,
    pub model: ModelId,
    pub effort: Option<Effort>,
    pub permission_mode: ApprovalPolicy,
    /// What the child was last told about fast mode — the spawn's flag for
    /// Claude Code and Codex, and for fx the value stamped onto its session,
    /// which nothing can move after. Compared against the composer's pick to
    /// decide whether anything has to happen at all.
    pub fast: bool,
    pub events: Arc<Mutex<Vec<AgentEvent>>>,
    pub seq: Arc<AtomicU64>,
    /// Shared with the stdout task: sends flip it here, `result` and
    /// `background_tasks_changed` flip it there.
    pub status: Arc<Mutex<StatusTracker>>,
    /// Permission requests the mapper has registered and nobody has answered.
    pub pending_permissions: PendingPermissions,
    /// Questions the child is waiting on an answer to — the sibling of the map
    /// above, held for the same reason and filled the same way. See
    /// [`PendingQuestions`].
    pub pending_questions: PendingQuestions,
    /// Prompts typed during a running turn, waiting for the next boundary.
    /// Shared with the stdout task, which is what flushes them.
    pub queued: QueuedMessages,
}

impl Session {
    /// Spawns the child process for the given harness.
    ///
    /// `model` is optional because pi's is: it is multi-provider, so hz names
    /// no default it could be wrong about and lets pi's own settings decide.
    /// The other two name one in `default_model_for`, so `None` reaching them
    /// is a caller that skipped resolution rather than a state to spawn in.
    //
    // Eleven handles and facts about one spawn, and there is no object to name
    // that would group them: a `SpawnConfig` would be a struct with eleven
    // fields and one caller shape, which is this list with more ceremony.
    // `SendRequest` earns its struct because three callers build it from three
    // different places; this one is built where it is used.
    #[allow(clippy::too_many_arguments)]
    pub async fn init(
        session_id: &str,
        harness: Harness,
        model: Option<&Model>,
        effort: Option<Effort>,
        permission_mode: ApprovalPolicy,
        cwd: &str,
        // The session's own tree, for the turn-end snapshot. Differs from `cwd`
        // on a worktree creation, where the child spawns at the project root.
        session_cwd: &str,
        worktree_name: Option<&str>,
        is_new_session: bool,
        fork_from: Option<&str>,
        // The Agent a new session runs *as*, or `None` for the runtime's default.
        // Creation-time only: the runtime composes an Agent into a session when
        // it is made, so a session that already exists keeps the one it has.
        agent_name: Option<&str>,
        app: &AppHandle,
    ) -> Result<Session> {
        // The tree is made before this on every harness now — mcode has no `-w`
        // — so a name arriving here is a caller that skipped resolving one, and
        // a session that silently ran in the wrong tree is the failure worth
        // refusing outright.
        if worktree_name.is_some() {
            bail!("mcode cannot create a worktree — it has to be made first");
        }

        match harness {
            Harness::Mcode => {
                mcode::init(
                    session_id,
                    model,
                    effort,
                    permission_mode,
                    cwd,
                    session_cwd,
                    is_new_session,
                    fork_from,
                    agent_name,
                    app,
                )
                .await
            }
            // A session some newer build wrote into the shared index. Its
            // transcript still reads and its row still draws — that is what the
            // tolerant read bought — but there is no CLI here to carry it on,
            // and picking one would run a different agent inside somebody else's
            // conversation.
            Harness::Other(name) => {
                bail!("this session runs on {name}, which this version of hz can't drive — update hz")
            }
        }
    }

    /// Builds and saves the user's own prompt event, then writes it to the
    /// child's stdin — the CLI never echoes it back.
    ///
    /// `baseline` is the caller's working-tree snapshot, taken before this
    /// prompt reaches the child. It is passed in rather than taken here because
    /// only the manager knows which directory to snapshot: a worktree session's
    /// tree does not exist until the CLI creates it.
    // Eight arguments' worth of a prompt — its text, what it carries, what it is
    // timed and attributed by — and the path is the point: this is the one
    // function a queued prompt, a relayed one and a fresh one all reach, so the
    // fields stay named here rather than behind a struct only this signature
    // would use. See the note on `flush_queued` next door.
    #[allow(clippy::too_many_arguments)]
    pub async fn send_msg(
        &mut self,
        prompt: &str,
        attachment_paths: &[String],
        issues: &[IssueRef],
        baseline: Option<String>,
        from: Option<MessageSender>,
        sent_at: Option<&str>,
        app: &AppHandle,
    ) -> Result<()> {
        deliver_prompt(
            &self.id,
            self.harness,
            prompt,
            attachment_paths,
            issues,
            baseline,
            false,
            true,
            from,
            sent_at,
            &self.seq,
            &self.events,
            &self.stdin,
            app,
        )
        .await?;

        // After the write: a prompt that never reached the child starts
        // nothing, and the command's error is what the frontend acts on.
        if let Some(next) = self.status.lock().await.on_send() {
            publish_status(&self.id, next, app).await;
        }

        Ok(())
    }

    /// Holds a prompt typed during a running turn. Nothing is written or
    /// persisted here — [`flush_queued`] does both once the turn reaches a
    /// boundary, which is what leaves a cancel possible until then.
    pub async fn queue_msg(
        &self,
        prompt: &str,
        attachment_paths: &[String],
        issues: &[IssueRef],
        from: Option<MessageSender>,
        sent_at: Option<&str>,
    ) -> QueuedMessage {
        let message = QueuedMessage {
            id: Uuid::now_v7().to_string(),
            session_id: self.id.clone(),
            text: prompt.to_string(),
            attachment_paths: attachment_paths.to_vec(),
            from,
            issues: issues.to_vec(),
            sent_at: sent_at.map(str::to_string),
        };
        self.queued.lock().await.push(message.clone());
        message
    }

    /// fx alone, and the whole of what keeps its two-prompt race shut. Decides,
    /// **under the status lock**, whether this prompt joins the running turn —
    /// queued for the turn-end flush — or finds the turn already over and must
    /// start a fresh one. `Some` was queued; `None` means the turn ended and
    /// the caller delivers now.
    ///
    /// Holding the status lock across the `turn_in_flight` read *and* the
    /// enqueue is the point: it makes this exclusive with [`ingest`]'s
    /// completion-and-reservation, which takes the same lock across its own
    /// `on_event` and queue inspection. Read `turn_in_flight` and enqueue in
    /// two separate lock holds — as reading it up in `send_msg` and queueing
    /// later would — and a completion can slip between, marking the turn done
    /// with a prompt queued behind it and no reservation, which is the race.
    ///
    /// fx has no injection point, so a prompt for a live turn only ever waits
    /// here for its end; there is no write-through path to take.
    async fn acp_queue_if_in_flight(
        &self,
        prompt: &str,
        attachment_paths: &[String],
        issues: &[IssueRef],
        from: Option<MessageSender>,
        sent_at: Option<&str>,
    ) -> Option<QueuedMessage> {
        let _turn = self.status.lock().await;
        if !_turn.turn_in_flight() {
            return None;
        }
        Some(
            self.queue_msg(prompt, attachment_paths, issues, from, sent_at)
                .await,
        )
    }

    /// Takes back the newest held prompt, newest-first because that is the one
    /// the user just typed and the only one the composer is offering to undo.
    ///
    /// `None` means the flush won the race, which needs no handling beyond
    /// leaving the composer alone: the prompt is on its way and the frontend
    /// learns so from the `user_message` that follows.
    pub async fn cancel_queued(&self) -> Option<QueuedMessage> {
        self.queued.lock().await.pop()
    }

    /// Holds a prompt and immediately hands it over, for the case where a tool
    /// call is already running.
    ///
    /// Through the queue rather than written directly, so a prompt already
    /// waiting goes out ahead of this one instead of being overtaken.
    pub async fn queue_and_flush(
        &self,
        prompt: &str,
        attachment_paths: &[String],
        issues: &[IssueRef],
        from: Option<MessageSender>,
        sent_at: Option<&str>,
        app: &AppHandle,
    ) {
        self.queue_msg(prompt, attachment_paths, issues, from, sent_at)
            .await;
        flush_queued(
            &self.id,
            self.harness,
            &self.queued,
            &self.seq,
            &self.events,
            &self.stdin,
            &self.status,
            app,
        )
        .await;
    }

    /// Switches the model of a running child. mcode takes it as a session config
    /// option on the running connection, and the reply restates that model's
    /// whole ladder — which is what the composer's effort menu is drawn from, so
    /// the picker is told to re-read.
    pub async fn set_model(&mut self, model: &Model, app: &AppHandle) -> Result<()> {
        let Transport::Acp(session) = &self.stdin;
        mcode::set_model(session, model, app).await?;

        // **What the child is on, not what was asked for.** A refusal leaves the
        // session on whatever model it had, and adopting the CLI's own answer is
        // what keeps this struct, the index and the child from naming three
        // different models — a session whose every later send retries the same
        // refusal.
        if let Some(landed) = mcode::landed_model(session) {
            self.model = landed;
        }

        Ok(())
    }

    /// Switches the effort of a running child.
    ///
    /// A refusal is **not** fatal: mcode declines a level on a model that does
    /// no reasoning, and killing the child over that would make a session whose
    /// recorded level its model has since stopped taking unresumable. So the
    /// level is dropped, the session runs on mcode's own default, and stderr
    /// says which level was refused.
    pub async fn set_effort(&mut self, effort: Option<Effort>, app: &AppHandle) -> Result<()> {
        let _ = app;
        let Transport::Acp(session) = &self.stdin;

        if let Some(effort) = effort {
            if let Err(error) = mcode::set_effort(session, effort).await {
                mcode::note_effort(effort, &error.to_string());
            }
        }
        self.effort = effort;

        Ok(())
    }

    /// Switches the permission stance of a running child.
    ///
    /// ACP answers the permission modes as a session setting, and the two that
    /// are *modes* — plan and default — as a mode change; `mcode::set_mode`
    /// decides between them.
    pub async fn set_permission_mode(&mut self, mode: ApprovalPolicy) -> Result<()> {
        let Transport::Acp(session) = &self.stdin;
        mcode::set_mode(session, mode).await?;
        self.permission_mode = mode;

        Ok(())
    }

    /// Interrupts the in-flight turn without killing the child.
    ///
    /// ACP asks for this as a *notification*: nothing answers it, and the
    /// prompt's own response comes back with `stopReason: "cancelled"` — which
    /// the read loop reads as the turn's end, so the status machine needs
    /// nothing special here.
    pub async fn interrupt(&mut self) -> Result<()> {
        let Transport::Acp(session) = &self.stdin;
        mcode::cancel(session)
    }

    /// Hands held prompts into the running turn instead of waiting for it to end.
    ///
    /// **The alternative to interrupting, and the whole point of steering.** A
    /// held prompt used to have one way out — stop the turn, which throws away
    /// whatever the agent was part way through — because ACP has one prompt per
    /// turn. mcode's extension takes a message *into* the live turn, so the work
    /// in flight survives and the reader's sentence lands in it.
    ///
    /// All of them, oldest first, so a queue built up over a long turn arrives in
    /// the order it was written. Each is delivered with `send: false` first,
    /// which logs the bubble the way an ordinary prompt does without sending
    /// anything; the join is one steer carrying every line, the same shape the
    /// flush uses.
    ///
    /// Answers what it managed. A refusal — there is no live turn any more — puts
    /// everything back at the front of the queue in its original order, so the
    /// next boundary delivers it exactly as if this had not been asked.
    pub async fn steer_queued(&mut self, app: &AppHandle) -> Result<usize> {
        let held: Vec<QueuedMessage> = {
            let mut queue = self.queued.lock().await;
            std::mem::take(&mut *queue)
        };
        if held.is_empty() {
            return Ok(0);
        }

        let mut texts = Vec::with_capacity(held.len());
        for message in &held {
            texts.push(
                deliver_prompt(
                    &self.id,
                    self.harness,
                    &message.text,
                    &message.attachment_paths,
                    &message.issues,
                    None,
                    true,
                    false,
                    message.from.clone(),
                    message.sent_at.as_deref(),
                    &self.seq,
                    &self.events,
                    &self.stdin,
                    app,
                )
                .await?,
            );
        }

        let Transport::Acp(session) = &self.stdin;
        let joined = texts.join("\n\n");
        if let Err(e) = mcode::steer(session, &joined).await {
            // Put every one back, in order, and say why — a held prompt that
            // vanished into a failed call would be a sentence the reader wrote
            // and never saw again.
            let mut queue = self.queued.lock().await;
            queue.splice(0..0, held);
            return Err(e);
        }

        Ok(texts.len())
    }

    /// Answers a pending permission request and records the decision.
    ///
    /// The reply goes out before the event is minted: the CLI's turn is blocked
    /// on it, and a failure to persist the transcript row is not worth holding
    /// an agent still for. Taking the entry out of the map is what makes this
    /// single-shot — a second click on a card the frontend hasn't repainted yet
    /// finds nothing and errors rather than double-answering.
    pub async fn respond_permission(
        &mut self,
        request_id: &str,
        option_id: &str,
        app: &AppHandle,
    ) -> Result<()> {
        let (pending, chosen) = {
            let mut guard = self
                .pending_permissions
                .lock()
                .expect("pending permissions mutex poisoned");

            let pending = guard
                .get(request_id)
                .with_context(|| format!("no pending permission request {request_id}"))?;

            let chosen = pending
                .options
                .get(option_id)
                .with_context(|| format!("unknown permission option {option_id}"))?
                .clone();

            // Only removed once the option resolved: an unknown id leaves the
            // request answerable rather than stranding the turn.
            let pending = guard.remove(request_id).expect("just read under this lock");
            (pending, chosen)
        };

        // Answered on the channel that asked, which is the only one there is:
        // the decision *is* the outcome envelope the button was built with, sent
        // back under the id the request arrived on. ACP ignores a reply aimed at
        // the wrong id in silence, which is why the id is carried rather than
        // recomputed here.
        let (Transport::Acp(session), Reply::Rpc(rpc_id)) = (&self.stdin, &pending.reply);
        let outcome = chosen
            .decision
            .clone()
            .context("this option carries no outcome to send")?;
        session.client.respond(*rpc_id, outcome)?;

        let payload = AgentEventPayload::PermissionDecided {
            request_id: request_id.to_string(),
            tool_use_id: pending.tool_use_id,
            behavior: chosen.option.behavior,
            label: chosen.option.label,
            automatic: false,
        };

        self.emit_decision(payload, app)
    }

    /// Answers a form the agent is waiting on.
    ///
    /// The sibling of [`respond_permission`](Self::respond_permission), and the
    /// same two halves: the reader's own words go back under the id the request
    /// arrived on, and a decided event retires the card.
    pub async fn answer_questions(
        &mut self,
        request_id: &str,
        answers: Vec<mcode::elicitation::QuestionAnswer>,
        app: &AppHandle,
    ) -> Result<()> {
        let (pending, outcome, answered) = {
            let mut guard = self
                .pending_questions
                .lock()
                .expect("pending questions mutex poisoned");

            let pending = guard
                .get(request_id)
                .with_context(|| format!("no pending question request {request_id}"))?
                .clone();

            // Built before the entry is taken, so a form that somehow cannot be
            // answered stays answerable rather than stranding the turn.
            let outcome = mcode::elicitation::accepted(&pending, &answers);
            // A question the reader skipped is absent from the reply, and it is
            // not one they answered — so the count is of steps that carried
            // something, which is the same set the agent read.
            let answered = answers
                .iter()
                .filter(|a| !a.selected.is_empty() || a.other.is_some())
                .count();
            guard.remove(request_id).expect("just read under this lock");
            (pending, outcome, answered)
        };

        let (Transport::Acp(session), Reply::Rpc(rpc_id)) = (&self.stdin, &pending.reply);
        session.client.respond(*rpc_id, outcome)?;

        let payload = AgentEventPayload::PermissionDecided {
            request_id: request_id.to_string(),
            // A form is not a tool call, so there is no row for this to file
            // beside — see `raise_question`.
            tool_use_id: String::new(),
            // Nothing here allows or denies anything. The field is the permission
            // card's, and an answered question is the nearer of its two values:
            // the reader was asked and did reply.
            behavior: PermissionBehavior::Allow,
            label: format!("{answered} answers"),
            automatic: false,
        };

        self.emit_decision(payload, app)
    }

    /// Takes back a form the agent is waiting on, the way the TUI's own picker
    /// does.
    ///
    /// The reply is the wire's `decline` — the only non-accept ACP has for an
    /// elicitation, and what the agent reads as "not continued". The entry goes
    /// either way: the card is closed on this side whether or not the child took
    /// the news, and a question left answerable after the reader dismissed it
    /// would be one they could still be charged for.
    pub async fn cancel_question(&mut self, request_id: &str, app: &AppHandle) -> Result<()> {
        let pending = {
            let mut guard = self
                .pending_questions
                .lock()
                .expect("pending questions mutex poisoned");
            guard
                .remove(request_id)
                .with_context(|| format!("no pending question request {request_id}"))?
        };

        let (Transport::Acp(session), Reply::Rpc(rpc_id)) = (&self.stdin, &pending.reply);
        session.client.respond(*rpc_id, mcode::elicitation::declined())?;

        let payload = AgentEventPayload::PermissionDecided {
            request_id: request_id.to_string(),
            tool_use_id: String::new(),
            behavior: PermissionBehavior::Deny,
            label: "dismissed".to_string(),
            automatic: false,
        };

        self.emit_decision(payload, app)
    }

    /// Mints the `PermissionDecided` that retires an ask's card.
    ///
    /// Every answer on this channel — a permission, a question, a dismissal —
    /// retires its card with this one event rather than a variant each, because
    /// the frontend shares a `requestId` space across both kinds and
    /// `pendingAsksOf` already reads the decision as "this ask is over".
    ///
    /// Emitted, never persisted: the request it retires is not persisted either.
    /// Numbered through the shared counter all the same, so the live transcript
    /// orders it correctly. A failure to emit is returned rather than swallowed,
    /// since a card that will not retire is a reader with no way forward.
    fn emit_decision(&self, payload: AgentEventPayload, app: &AppHandle) -> Result<()> {
        let decision = AgentEvent {
            id: Uuid::now_v7().to_string(),
            session_id: self.id.clone(),
            harness: self.harness,
            seq: self.seq.fetch_add(1, Relaxed),
            ts: now_rfc3339(),
            turn_id: None,
            subagent: None,
            payload,
            raw: None,
        };

        app.emit("agent_event", &decision)?;

        Ok(())
    }

    /// Ends the child process. Takes `self` by value — a stopped session can't
    /// be reused.
    ///
    /// pi is asked to exit rather than killed, and that is not politeness: it
    /// holds `~/.pi/agent/auth.json.lock` while it runs and a `SIGKILL`ed one
    /// leaves it behind, so the cost of killing lands on the **next** pi, which
    /// waits that stale lock out for ~30s before answering anything. Every
    /// caller here is one where another pi follows — a respawn for an effort
    /// change, an update install, a delete and retry.
    pub async fn kill(mut self) -> Result<()> {
        // The session is closed and the pipe handed an EOF before the process
        // is touched: mcode runs its own teardown on a clean exit and a
        // `SIGKILL` would leave that half-written. `shutdown` waits for it, then
        // kills whatever is still there.
        let Transport::Acp(session) = &self.stdin;
        mcode::shutdown(&mut self.child, session).await;

        Ok(())
    }
}

/// Persists the user's own prompt event, emits it, then writes it to the
/// child's stdin — the CLI never echoes a prompt back, so this is the only
/// place it enters the transcript.
///
/// Free rather than a method because a queued prompt is delivered from the
/// stdout task, which holds the same handles but no `Session`.
#[allow(clippy::too_many_arguments)]
async fn deliver_prompt(
    session_id: &str,
    // Whose conversation this prompt joins. Recorded on the event rather than
    // assumed, since this is the one event hz mints itself for every harness.
    harness: Harness,
    prompt: &str,
    attachment_paths: &[String],
    // Already resolved against the tracker by the caller. Appended to the text
    // the child is given, so the transcript keeps showing exactly what the
    // model was told — the same rule a non-image attachment's `@path` follows.
    //
    // fx is the one exception, and it is deliberate: it has no system-prompt
    // surface, so [`crate::harness::fx::start_turn`] appends hz's rules to
    // the wire text alone and the transcript shows strictly less than the
    // model was told. Nothing else may take that liberty.
    issues: &[IssueRef],
    baseline: Option<String>,
    queued: bool,
    // `false` logs the prompt and hands its prepared text back without sending
    // it — [`flush_acp`] alone, which logs every held message as its own bubble
    // and then opens **one** turn with the lot, ACP taking one prompt per turn.
    send: bool,
    from: Option<MessageSender>,
    // When the reader pressed send, where a clock outside this process saw it.
    // `None` for a prompt nothing pressed — a relayed message, `hz new` — which
    // is stamped now, the only thing left to say.
    sent_at: Option<&str>,
    seq: &Arc<AtomicU64>,
    events: &Arc<Mutex<Vec<AgentEvent>>>,
    transport: &Transport,
    app: &AppHandle,
) -> Result<String> {
    let seq = seq.fetch_add(1, Relaxed);

    // Ahead of the event, because it is what decides the event's own text:
    // a non-image attachment becomes an `@path` mention on the prompt, and
    // the transcript has to show what the model was actually given.
    let prepared = attachments::prepare(session_id, prompt, attachment_paths, harness).await?;
    let text = prepared.text;

    let payload = AgentEventPayload::UserMessage {
        text: text.clone(),
        issues: issues.to_vec(),
        images: prepared
            .images
            .iter()
            .map(|i| ImageRef {
                path: Some(i.stored_path.clone()),
                url: None,
                mime_type: Some(i.mime_type.clone()),
            })
            .collect(),
        baseline,
        queued,
        from,
        // Absent means "this session's own cwd", which is the truth for every
        // message a session logs itself. Only a fork records one.
        cwd: None,
    };
    let agent_event = AgentEvent {
        id: Uuid::now_v7().to_string(),
        session_id: session_id.to_string(),
        harness,
        seq,
        ts: prompt_ts(sent_at),
        // Nothing tracks turns yet; Claude Code opens one per `init`.
        turn_id: None,
        subagent: None,
        payload,
        raw: None,
    };

    app.emit("agent_event", &agent_event)?;

    let mut events_guard = events.lock().await;
    events_guard.push(agent_event.clone());
    drop(events_guard);

    append_session_event(session_id, agent_event).await?;

    // Logged, not sent: the caller holds the text and opens the turn itself.
    if !send {
        return Ok(text);
    }

    // mcode takes a prompt as a request that blocks for the whole turn, so the
    // write *is* the send and the read loop settles the answer off the id.
    // Images are not wired at all: the agent answers `image: false` to the
    // prompt-capability question, and `attachments::prepare` has already named
    // any attachment in prose — which is also why nothing here builds a
    // content-block array.
    //
    // **One prompt per turn**, and that is the connection's own rule rather
    // than a preference: a second `session/prompt` while one is in flight moves
    // the single id the reader is watching, and the first answer would arrive as
    // a stray. Everything queued during a turn is flushed at the boundary,
    // joined into one.
    let Transport::Acp(session) = transport;
    mcode::start_turn(session, &text).await?;

    Ok(text)
}

/// The handles a read loop needs once its harness has stopped being relevant.
///
/// Bundled rather than passed loose because [`ingest`] takes eight of them and
/// every harness's reader holds the same set.
pub struct Ingest<'a> {
    pub session_id: &'a str,
    /// Stamped on prompts flushed from the queue, which this mints itself.
    pub harness: Harness,
    /// The session's own tree, for the turn-end snapshot. Differs from the
    /// spawn directory on a worktree creation.
    pub session_cwd: &'a str,
    pub events: &'a Arc<Mutex<Vec<AgentEvent>>>,
    pub status: &'a Arc<Mutex<StatusTracker>>,
    pub queued: &'a QueuedMessages,
    pub flush_seq: &'a Arc<AtomicU64>,
    pub flush_events: &'a Arc<Mutex<Vec<AgentEvent>>>,
    pub flush_transport: &'a Transport,
}

/// Everything that happens to a mapped event, from the snapshot on a closing
/// turn to the queued flush at a boundary.
///
/// Lives here rather than in a harness because none of it is one harness's
/// business: which payloads are persisted, when the tree is snapshotted, where
/// a tool result's images are archived, and what counts as a boundary are all
/// properties of hz's own event model. With a copy per harness they would
/// drift, and the drift would be silent — a second harness whose deltas were
/// persisted looks exactly like one whose logs are simply larger.
pub async fn ingest(ctx: &Ingest<'_>, mut agent_event: AgentEvent, app: &AppHandle) {
    // Filled here rather than in the mapper because only the session layer
    // knows the cwd. Freezing the tree id onto the closing event is what
    // stops an idle session's diff from absorbing everything that later
    // touches the same checkout. ~20ms once per turn; a background
    // subagent's writes land after this, but its report-back turn closes
    // with its own, fresher snapshot.
    if let AgentEventPayload::TurnCompleted { ref mut head, .. } = agent_event.payload {
        *head = crate::git::snapshot_tree(ctx.session_cwd).await;
    }

    // Here for the same reason: only the session layer knows which session's
    // directory the bytes belong in. Before the emit below, so the live
    // transcript and the replayed one load the same file.
    if let AgentEventPayload::ToolCallCompleted { ref mut result, .. } = agent_event.payload {
        crate::attachments::archive_result_images(ctx.session_id, &mut result.images).await;
    }

    // Read before the event is moved into the log below. These three are
    // the turn's boundaries in the sense that matters here: each is a point
    // where handing the CLI a held prompt costs nothing. A tool starting or
    // finishing means the next tool result — where the CLI injects a
    // buffered prompt — is still ahead, and a turn ending means there is no
    // result left to absorb one, so the prompt opens the next turn instead.
    //
    // A subagent's call counts here and deliberately does not in
    // `note_tool_call` below, because the two ask different questions.
    // That one asks whether a main-thread result is close enough ahead to
    // write straight through; this asks only whether handing over now is
    // safe, and it is at any point inside a turn — a prompt written early
    // waits in the CLI's own buffer for the same main-thread result it
    // would have waited here for.
    let at_boundary = match agent_event.payload {
        AgentEventPayload::TurnCompleted { .. } => true,
        // A tool boundary is not one of these: ACP's next prompt is its next
        // turn, so there is no buffer at a tool call for a held prompt to go
        // into.
        AgentEventPayload::ToolCallStarted { .. } | AgentEventPayload::ToolCallCompleted { .. } => {
            false
        }
        _ => false,
    };

    if let Err(err) = app.emit("agent_event", &agent_event) {
        eprintln!("[emit err] {err}");
    }

    // One lock for both. The tool count is fed here rather than from inside
    // `on_event` because the subagent test needs the envelope: a subagent's
    // tool call runs on its own thread, and its result is not a point where
    // the CLI injects a queued prompt.
    //
    // fx reserves its next turn here, atomically with the completion, and the
    // queue is inspected **under the status lock** — the crux. fx has a single
    // prompt id and no injection point, so a turn ending with a prompt queued
    // must hand straight to it, and between this completion and the flush below
    // sit two awaits (publish, append). A send racing that gap would read no
    // turn in flight and start a second fx prompt over the one id.
    //
    // A send decides queue-vs-deliver in `acp_queue_if_in_flight`, which takes
    // this same status lock across its `turn_in_flight` read *and* its enqueue.
    // So this section and that one cannot interleave: whichever holds the lock
    // runs whole. Either the send queues first and this sees the message and
    // reserves, or this completes first and the send reads the completed turn
    // and delivers directly instead of queueing. Inspecting the queue outside
    // this lock is what reopened the race — a send could enqueue in the gap
    // between the inspection and this taking the lock.
    //
    // Order is status→queued, matching every other holder of both, so no
    // deadlock: nothing holds `queued` while awaiting `status`.
    let next_status = {
        let mut tracker = ctx.status.lock().await;
        let before = tracker.status();
        if agent_event.subagent.is_none() {
            tracker.note_tool_call(&agent_event.payload);
        }
        tracker.on_event(&agent_event.payload);
        let reserve = matches!(ctx.flush_transport, Transport::Acp(_))
            && matches!(agent_event.payload, AgentEventPayload::TurnCompleted { .. })
            && !ctx.queued.lock().await.is_empty();
        if reserve {
            tracker.on_send();
        }
        let after = tracker.status();
        (after != before).then_some(after)
    };
    if let Some(next) = next_status {
        publish_status(ctx.session_id, next, app).await;
    }

    // Live-view only, never retained. Deltas are superseded by the
    // committed event; a usage update is a running counter whose final
    // value lands on `turn_completed` — and `thinking_tokens` alone fires
    // dozens of times per turn, which would be most of a session's log.
    //
    // A permission request is here for a different reason: it is a question,
    // and it can only be answered by the child that asked. That child does
    // not survive a restart, so a persisted request would come back as a
    // card whose buttons cannot work. Dropping it is what makes the stale
    // card impossible rather than merely unlikely. Nothing is lost — the
    // tool call it belongs to is persisted and shows the outcome either way,
    // and a live card survives re-selection because the frontend keeps a
    // loaded session in memory rather than re-reading it.
    //
    // Questions are dropped on the same reasoning, and the "nothing is lost"
    // half holds harder there: the `AskUserQuestion` result the harness
    // writes carries both the questions and the answers, so the transcript
    // keeps the whole exchange without this line.
    if matches!(
        agent_event.payload,
        AgentEventPayload::Delta(_)
            | AgentEventPayload::UsageUpdate(_)
            // Transient by the same rule: it says a request is in flight,
            // and no request survives the process that made it. Persisting
            // it would also be most of a busy session's log — it fires once
            // per turn *and* once per tool result, 89 times in one capture.
            | AgentEventPayload::ModelRequestStarted
            | AgentEventPayload::PermissionRequested { .. }
            | AgentEventPayload::QuestionsAsked { .. }
            // The decision retiring a withdrawn card. Dropped for the same
            // reason as the request it retires, and to keep one rule: the
            // decision `Session::respond_permission` mints is emitted and
            // never written, so persisting this one would make "was it
            // answered" true of cancels and false of real answers.
            | AgentEventPayload::PermissionDecided { .. }
    ) {
        return;
    }

    // The data: URL a failed archive leaves behind must not reach the
    // retained copies: it is the whole image as base64, in a log read whole
    // on every open — the exact cost archiving exists to avoid. Stripped
    // here rather than in the archiver because the emit above must keep it:
    // the live transcript draws the picture either way, and only a reload
    // pays for the failure by showing the row without it.
    if let AgentEventPayload::ToolCallCompleted { ref mut result, .. } = agent_event.payload {
        for image in &mut result.images {
            image.url = None;
        }
    }

    ctx.events.lock().await.push(agent_event.clone());

    if let Err(err) = append_session_event(ctx.session_id, agent_event).await {
        eprintln!("[write err] {err}");
    }

    // After the boundary event is logged, so the prompt that follows it
    // lands behind it in the file as well as by `seq`. Cheap when the queue
    // is empty, which is nearly always.
    if !at_boundary {
        return;
    }

    // The flush is awaited rather than spawned, and that is the difference the
    // old request/response transport forced: its prompt *was* a request the
    // reader had to answer, so awaiting the flush here was the reader waiting on
    // itself and the session stopped dead at the next tool boundary. mcode's
    // write is a detached request — it hands the line to the writer task and
    // returns — so there is nothing to wait on and no reason to spawn.
    flush_queued(
        ctx.session_id,
        ctx.harness,
        ctx.queued,
        ctx.flush_seq,
        ctx.flush_events,
        ctx.flush_transport,
        ctx.status,
        app,
    )
    .await;
}

/// Hands every held prompt to the child, oldest first.
///
/// Called from the stdout loop on a tool call starting or finishing, or on the
/// turn ending. Those are the points where writing costs nothing: the CLI
/// buffers a mid-turn prompt and injects it at its *next* tool result, so a
/// prompt written while a tool runs lands on that tool's result rather than
/// waiting for the one after — and a turn that never calls a tool would not
/// have absorbed it at all, so flushing at the end just starts the new turn the
/// CLI would have started anyway.
///
/// Verified against the CLI: nothing is written back to say a prompt was
/// absorbed, so the boundary is the app's only handle on when to let go of one.
///
/// Failures are logged, not propagated — the stdout loop must survive anything,
/// and a prompt that cannot be written is one the user can retype.
// Eight arguments, and every one of them distinct plumbing: a session id, its
// harness, the counter, the event list, the transport, the status tracker and
// the app handle. `Ingest` groups the same set for the read loop and exists for
// the same reason — this is that grouping one function short of being worth a
// second struct, and a struct-of-handles that only ever has one literal built
// at its call site is the list with more ceremony. What would earn one is a
// *request*: `SendRequest` has three callers building it from three places.
#[allow(clippy::too_many_arguments)]
pub async fn flush_queued(
    session_id: &str,
    harness: Harness,
    queued: &QueuedMessages,
    seq: &Arc<AtomicU64>,
    events: &Arc<Mutex<Vec<AgentEvent>>>,
    transport: &Transport,
    status: &Arc<Mutex<StatusTracker>>,
    app: &AppHandle,
) {
    // ACP drains one prompt per turn and reserves the next in `ingest`, so its
    // release is a two-lock affair the batch model has no answer to. Its own
    // path.
    if matches!(transport, Transport::Acp(_)) {
        flush_acp(session_id, harness, queued, seq, events, transport, status, app).await;
        return;
    }

    // Every other transport takes the whole batch at a boundary. Drained under
    // one lock so a cancel arriving mid-flush either takes a message back before
    // any of this or finds nothing — never races a half-written batch.
    let batch: Vec<QueuedMessage> = std::mem::take(&mut *queued.lock().await);
    if batch.is_empty() {
        return;
    }

    let mut delivered = 0;
    deliver_batch(
        batch, session_id, harness, seq, events, transport, app, &mut delivered,
    )
    .await;

    // A delivered batch at `turn_completed` opens a turn the CLI has not
    // announced yet, so without this the composer reads idle for the second or
    // so until `init` arrives — offering to send into a session that is already
    // working. Redundant at a tool boundary, where the session is in-progress
    // and `on_send` reports no change.
    //
    // Only where something actually reached the child. A batch that all failed
    // starts no turn, and reporting one would leave the session running forever
    // on a prompt the agent never received.
    if delivered == 0 {
        return;
    }
    if let Some(next) = status.lock().await.on_send() {
        publish_status(session_id, next, app).await;
    }
}

/// The fx flush: the **whole** queue as one turn, and the release symmetric to
/// the reservation `ingest` makes.
///
/// fx takes one prompt per turn — `session/prompt` blocks for the turn and a
/// second one written meanwhile takes over the id the read loop settles on — so
/// draining one message per boundary made a reader's second sentence wait out a
/// whole turn answering their first. Every held message is still its own bubble
/// and its own line in the log; what they share is the turn they open.
///
/// The empty-check and the release of the reservation are done **while holding
/// both status and queued** — the crux, symmetric to `acp_queue_if_in_flight`
/// on the send side. Release the queue lock before marking the turn Completed
/// and a send can enqueue in the gap, leaving a prompt with no turn to flush
/// it. Holding both, a send either lands its message before the take (drained
/// here, or reserved for the next turn) or reads the released Completed after
/// and delivers directly.
///
/// A batch that fails to reach the child starts no turn and so no flush to
/// reach the next, hence the loop: keep taking until something is delivered or
/// the queue is empty under both locks. Locks are dropped across each attempt,
/// so a cancel or a send can move the queue between them — which the next round
/// re-reads.
///
/// Order is status -> queued, as everywhere; nothing holds queued while
/// awaiting status, so no deadlock.
// Eight arguments, and every one of them distinct plumbing: a session id, its
// harness, the counter, the event list, the transport, the status tracker and
// the app handle. `Ingest` groups the same set for the read loop and exists for
// the same reason — this is that grouping one function short of being worth a
// second struct, and a struct-of-handles that only ever has one literal built
// at its call site is the list with more ceremony. What would earn one is a
// *request*: `SendRequest` has three callers building it from three places.
#[allow(clippy::too_many_arguments)]
async fn flush_acp(
    session_id: &str,
    harness: Harness,
    queued: &QueuedMessages,
    seq: &Arc<AtomicU64>,
    events: &Arc<Mutex<Vec<AgentEvent>>>,
    transport: &Transport,
    status: &Arc<Mutex<StatusTracker>>,
    app: &AppHandle,
) {
    loop {
        let batch: Vec<QueuedMessage> = {
            let mut tracker = status.lock().await;
            let mut held = queued.lock().await;
            let batch = std::mem::take(&mut *held);
            // Nothing to hand over: the whole queue failed to send, or a cancel
            // emptied it. Give the reserved turn back under both locks, or the
            // session hangs `InProgress` on a prompt no child holds — and a send
            // racing this either queued before the take (so it is in the batch)
            // or reads Completed after and delivers.
            if batch.is_empty() {
                let released = tracker.release_reserved_turn();
                drop(held);
                drop(tracker);
                if let Some(next) = released {
                    publish_status(session_id, next, app).await;
                }
                return;
            }
            batch
        };

        // Logged outside the locks — attachment prep and the log write both
        // await. Each message mints its own `user_message`, so the transcript
        // draws what the reader typed, separately, in the order they typed it.
        // The text comes back prepared — a non-image attachment is an `@path` on
        // it by now — which is what may be joined.
        let mut texts = Vec::new();
        for message in batch {
            match deliver_prompt(
                session_id,
                harness,
                &message.text,
                &message.attachment_paths,
                &message.issues,
                // No baseline, for `deliver_batch`'s reason.
                None,
                true,
                false,
                message.from,
                message.sent_at.as_deref(),
                seq,
                events,
                transport,
                app,
            )
            .await
            {
                Ok(text) => texts.push(text),
                Err(err) => {
                    eprintln!("[queued flush err] {err}");
                    report_send_failure(session_id, harness, &err.to_string(), seq, events, app)
                        .await;
                }
            }
        }

        // One prompt, blank-line separated, because one is all ACP takes without
        // moving the id the reader is watching. On success the reservation
        // stands as `InProgress` and the turn is this batch's; on failure every
        // message is already on screen and in the log, so the sentence saying
        // why is the only thing still owing.
        if let (false, Transport::Acp(session)) = (texts.is_empty(), transport) {
            match crate::harness::mcode::start_turn(session, &texts.join("\n\n")).await {
                Ok(()) => return,
                Err(err) => {
                    eprintln!("[queued flush err] {err}");
                    report_send_failure(session_id, harness, &err.to_string(), seq, events, app)
                        .await;
                }
            }
        }

        // Nothing reached the child, so nothing will flush whatever queued
        // behind this. Round again: the reservation is only given back where the
        // queue is empty under both locks.
    }
}

/// Hands one drained batch to the child, oldest first, counting what landed.
// Eight arguments, and every one of them distinct plumbing: a session id, its
// harness, the counter, the event list, the transport, the status tracker and
// the app handle. `Ingest` groups the same set for the read loop and exists for
// the same reason — this is that grouping one function short of being worth a
// second struct, and a struct-of-handles that only ever has one literal built
// at its call site is the list with more ceremony. What would earn one is a
// *request*: `SendRequest` has three callers building it from three places.
#[allow(clippy::too_many_arguments)]
async fn deliver_batch(
    batch: Vec<QueuedMessage>,
    session_id: &str,
    harness: Harness,
    seq: &Arc<AtomicU64>,
    events: &Arc<Mutex<Vec<AgentEvent>>>,
    transport: &Transport,
    app: &AppHandle,
    delivered: &mut usize,
) {
    for message in batch {
        // No baseline, and this is the load-bearing half of the queued case:
        // the changes panel pairs the newest baseline with the newest head
        // after it, so a snapshot taken here would cut the running turn's
        // range in two and credit it with only the work that came after this
        // prompt. `None` makes `changeRange` walk past it to the real prompt.
        match deliver_prompt(
            session_id,
            harness,
            &message.text,
            &message.attachment_paths,
            &message.issues,
            None,
            true,
            true,
            message.from,
            message.sent_at.as_deref(),
            seq,
            events,
            transport,
            app,
        )
        .await
        {
            Ok(_) => *delivered += 1,
            Err(err) => {
                eprintln!("[queued flush err] {err}");
                // Drawn, not only logged. The prompt is already on screen and in
                // the log — `deliver_prompt` writes the user's own event before
                // the send — so silence here leaves a message sitting above a
                // session that will never answer it, with nothing saying why.
                // It is out of the queue for good: retrying would mean a second
                // copy of an event already persisted.
                report_send_failure(session_id, harness, &err.to_string(), seq, events, app).await;
            }
        }
    }
}

/// Files a prompt that could not be handed to the child as an error in the
/// transcript, beside the message it belongs to.
///
/// Persisted like the prompt above it, so reopening the session still explains
/// why that message was never answered. Not fatal: the session is intact and
/// the next prompt may well go through — the write is what failed, not the
/// conversation.
async fn report_send_failure(
    session_id: &str,
    harness: Harness,
    message: &str,
    seq: &Arc<AtomicU64>,
    events: &Arc<Mutex<Vec<AgentEvent>>>,
    app: &AppHandle,
) {
    let message = format!("This message could not be sent: {message}");
    report_session_error(session_id, harness, &message, seq, events, app).await;
}

/// Files a sentence about the session itself — not about a turn — as a
/// non-fatal error row, emitted and persisted like any other event.
///
/// For what went wrong *around* the conversation rather than in it: a prompt
/// that never reached the child, a setting the harness declined. Non-fatal
/// because the session is intact either way, and the reader needs the sentence
/// far more than the turn needs to be marked failed.
pub(crate) async fn report_session_error(
    session_id: &str,
    harness: Harness,
    message: &str,
    seq: &Arc<AtomicU64>,
    events: &Arc<Mutex<Vec<AgentEvent>>>,
    app: &AppHandle,
) {
    let agent_event = AgentEvent {
        id: Uuid::now_v7().to_string(),
        session_id: session_id.to_string(),
        harness,
        seq: seq.fetch_add(1, Relaxed),
        ts: now_rfc3339(),
        turn_id: None,
        subagent: None,
        payload: AgentEventPayload::Error {
            source: ErrorSource::Process,
            message: message.to_string(),
            fatal: false,
        },
        raw: None,
    };

    if let Err(err) = app.emit("agent_event", &agent_event) {
        eprintln!("[session error emit err] {err}");
    }
    events.lock().await.push(agent_event.clone());
    if let Err(err) = append_session_event(session_id, agent_event).await {
        eprintln!("[session error log err] {err}");
    }
}

/// A read loop calls this when its child's stdout ends, before ingesting the
/// closing turn. Two failures to head off: a turn in flight never gets its
/// answer, so the session would hang `in_progress`; and prompts queued behind
/// it would be handed to the *dead* child by the turn-end boundary flush —
/// `start_turn` there sends into a writer whose child is gone and waits on a
/// response that never comes, hanging the session again. So the queue is
/// drained and reported here, and the caller ingests the closing turn with the
/// queue already empty, which is what stops that flush from firing into a
/// corpse.
///
/// Each stranded prompt gets its own bubble and a failure beside it, so a queued
/// row the composer is showing resolves into the transcript rather than sitting
/// pending forever, and the reader sees the prompt was lost and can resend it.
pub async fn strand_queue_on_exit(
    session_id: &str,
    harness: Harness,
    queued: &QueuedMessages,
    seq: &Arc<AtomicU64>,
    events: &Arc<Mutex<Vec<AgentEvent>>>,
    app: &AppHandle,
) {
    let stranded: Vec<QueuedMessage> = std::mem::take(&mut *queued.lock().await);
    for message in stranded {
        // The same preparation delivery does, so the bubble carries exactly what
        // would have been sent: images resolved to `ImageRef`, non-image
        // attachments folded into the text as `@path` mentions. Without it the
        // row retiring the queued prompt would drop its attachments from the
        // transcript while telling the reader to resend it. Best effort — a
        // failed prep still surfaces the text rather than losing the prompt.
        let (text, images) =
            match attachments::prepare(session_id, &message.text, &message.attachment_paths, harness)
                .await
            {
                Ok(prepared) => (
                    prepared.text,
                    prepared
                        .images
                        .iter()
                        .map(|i| ImageRef {
                            path: Some(i.stored_path.clone()),
                            url: None,
                            mime_type: Some(i.mime_type.clone()),
                        })
                        .collect(),
                ),
                Err(err) => {
                    eprintln!("[fx strand prepare err] {err:#}");
                    (message.text.clone(), Vec::new())
                }
            };
        let bubble = AgentEvent {
            id: Uuid::now_v7().to_string(),
            session_id: session_id.to_string(),
            harness,
            seq: seq.fetch_add(1, Relaxed),
            ts: prompt_ts(message.sent_at.as_deref()),
            turn_id: None,
            subagent: None,
            payload: AgentEventPayload::UserMessage {
                text,
                issues: message.issues.clone(),
                images,
                baseline: None,
                queued: true,
                from: message.from.clone(),
                cwd: None,
            },
            raw: None,
        };
        if let Err(err) = app.emit("agent_event", &bubble) {
            eprintln!("[fx strand emit err] {err}");
        }
        events.lock().await.push(bubble.clone());
        if let Err(err) = append_session_event(session_id, bubble).await {
            eprintln!("[fx strand log err] {err}");
        }
        report_send_failure(
            session_id,
            harness,
            "the agent exited before this queued message was sent — send it again to retry",
            seq,
            events,
            app,
        )
        .await;
    }
}

// The behaviours these tests pinned — a call in flight being visible while it
// runs, nothing left in flight when the turns are over, the counter that
// decides whether a prompt is written now or held — are the read loop's, and
// they are **not covered here yet**. They were written against Claude Code's
// wire format, which this build no longer speaks; the same assertions need
// rebuilding on `harness/mcode/fixtures/live_turn.jsonl`. Until then the
// coverage for that path is the mapper and parser tests, which pin what the
// loop feeds them rather than what it does with it.

#[cfg(test)]
mod tests {
    use super::*;

    /// **The start map is the only thing Stop can land on while a child boots.**
    /// So it has to answer for a start in flight, take a cancellation, and be
    /// empty again the moment the send that opened it leaves — by any of the
    /// dozen doors `send_msg` has.
    #[test]
    fn a_start_is_tracked_for_exactly_as_long_as_the_send_that_opened_it() {
        let manager = SessionManager::default();

        assert!(!manager.start_cancelled("s1"), "nothing in flight yet");
        assert!(!manager.cancel_start("s1"), "and nothing to cancel");

        {
            let _start = manager.starting("s1");
            assert!(!manager.start_cancelled("s1"), "in flight, not cancelled");
            assert!(manager.cancel_start("s1"), "the reader pressed Stop");
            assert!(manager.start_cancelled("s1"), "and the seam has to see it");
        }

        // Drop is what takes it back out, whichever door the send left by.
        assert!(!manager.start_cancelled("s1"));
        assert!(
            !manager.cancel_start("s1"),
            "a later Stop must not land on a start that is over"
        );
    }

    /// Two sends in flight are two starts, so cancelling one leaves the other.
    #[test]
    fn a_cancelled_start_does_not_touch_another() {
        let manager = SessionManager::default();
        let _a = manager.starting("a");
        let _b = manager.starting("b");

        assert!(manager.cancel_start("a"));
        assert!(manager.start_cancelled("a"));
        assert!(!manager.start_cancelled("b"));
    }
}
