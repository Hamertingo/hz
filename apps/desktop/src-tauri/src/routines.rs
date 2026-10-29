//! Running a routine: into the agent's one conversation, then telling the reader.
//!
//! A routine does not open a session of its own. The prompt goes into the agent's
//! persistent chat like a message from the reader, so the agent answers there with
//! all its memory and the reader sees the run in the place they already look. The
//! app then waits for that turn to close, which is how the run gets its duration,
//! its cost and its excerpt. The wait is a [`Pending`] filed under the session,
//! settled by the two hooks `session.rs` calls on every turn.

use std::{
    collections::{HashMap, VecDeque},
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use ts_rs::TS;
use uuid::Uuid;

use crate::{
    agents,
    automations::{self, RunRecord, RunStatus, Routine, Trigger, CHANGED},
    events::TurnStatus,
    models::ModelId,
    orchestration,
};

/// How long a run waits for its turn to close, queue included.
const TIMEOUT: Duration = Duration::from_secs(20 * 60);
/// Webhook events held while a routine is still on the previous one.
const MAX_BACKLOG: usize = 5;
/// How much of the answer a run keeps.
const EXCERPT: usize = 700;
/// The line a quiet run's answer opens with when the person is needed.
pub const NEEDS_YOU: &str = "[needs you]";
/// How long a quiet turn stays muted after it closes: the webview announces the
/// turn a moment after the backend sees it end.
const MUTE_TAIL: Duration = Duration::from_secs(5);

/// A routine that is running now.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Running {
    pub id: String,
    /// Unix milliseconds, so the row's clock runs from the real start.
    pub since_ms: u64,
}

/// A webhook event held while the routine finishes the one before it: `via`, then
/// the text appended to the prompt.
type Waiting = (String, Option<String>);

struct Outcome {
    ok: bool,
    text: String,
    cost: Option<f64>,
}

struct Pending {
    prompt: String,
    started: bool,
    /// The session was made for this run, so its cost before it is zero.
    fresh: bool,
    quiet: bool,
    tx: Option<oneshot::Sender<Outcome>>,
}

static RUNNING: LazyLock<Mutex<HashMap<String, u64>>> = LazyLock::new(Default::default);
static BACKLOG: LazyLock<Mutex<HashMap<String, VecDeque<Waiting>>>> = LazyLock::new(Default::default);
static PENDING: LazyLock<Mutex<HashMap<String, Pending>>> = LazyLock::new(Default::default);
/// The running cost last seen per session, so a turn's own share is a difference.
static TOTALS: LazyLock<Mutex<HashMap<String, f64>>> = LazyLock::new(Default::default);

fn now_ms() -> u64 {
    Utc::now().timestamp_millis().max(0) as u64
}

/// The routines running right now.
pub fn running() -> Vec<Running> {
    RUNNING
        .lock()
        .expect("routines running poisoned")
        .iter()
        .map(|(id, since_ms)| Running { id: id.clone(), since_ms: *since_ms })
        .collect()
}

/// What [`fire`] did with a request.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Fired {
    Started,
    /// The routine is mid-run; this one waits its turn.
    Queued,
    /// The routine is mid-run and its queue is full.
    Full,
}

/// Starts a run in the background. `via` says what asked (`schedule`, `manual`,
/// `webhook: <event>`) and `extra` is text appended to the prompt, which is how a
/// webhook's payload reaches the agent.
pub fn fire(app: AppHandle, id: String, via: String, extra: Option<String>) -> Fired {
    {
        let mut running = RUNNING.lock().expect("routines running poisoned");
        if running.contains_key(&id) {
            let mut backlog = BACKLOG.lock().expect("routines backlog poisoned");
            let queue = backlog.entry(id).or_default();
            if queue.len() >= MAX_BACKLOG {
                return Fired::Full;
            }
            queue.push_back((via, extra));
            return Fired::Queued;
        }
        running.insert(id.clone(), now_ms());
    }
    app.emit(CHANGED, ()).ok();

    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_once(&app, &id, &via, extra.as_deref()).await {
            eprintln!("[routines err] {id}: {e:#}");
        }
        RUNNING.lock().expect("routines running poisoned").remove(&id);
        app.emit(CHANGED, ()).ok();

        let next = BACKLOG.lock().expect("routines backlog poisoned").get_mut(&id).and_then(VecDeque::pop_front);
        if let Some((via, extra)) = next {
            fire(app, id, via, extra);
        }
    });
    Fired::Started
}

/// The prompt as the agent reads it: the reader's words under a label that says
/// a routine sent them, then what this run adds.
pub fn compose(routine: &Routine, extra: Option<&str>) -> String {
    let mut text = format!("[routine: {}]\n\n{}", routine.name, routine.prompt.trim());
    if let (Trigger::Webhook { source, event }, Some(extra)) = (&routine.trigger, extra) {
        text.push_str(&format!("\n\nWhat called you ({source}, {event}):\n{extra}"));
    }
    if routine.to == "pr_comment" {
        text.push_str("\n\nPost your result as a comment on the pull request this concerns, with `gh pr comment`.");
    }
    if routine.quiet {
        text.push_str(&format!(
            "\n\nThis is a quiet run. If nothing changed and nothing needs the person, answer in one short line. \
             If something needs their attention or a decision, begin your answer with {NEEDS_YOU}."
        ));
    }
    text
}

async fn run_once(app: &AppHandle, id: &str, via: &str, extra: Option<&str>) -> Result<()> {
    let routine = automations::get(id)
        .await?
        .filter(|r| r.deleted_at.is_none())
        .context("the routine is gone")?;

    let at = Utc::now();
    let started = Instant::now();
    let (outcome, session) = if routine.agent_id.is_empty() {
        (legacy(app, &routine).await, None)
    } else {
        execute(app, &routine, extra).await
    };

    let (status, text, cost, error) = match outcome {
        Ok(o) if o.ok => (RunStatus::Ok, o.text, o.cost, None),
        Ok(o) => (RunStatus::Fail, String::new(), o.cost, Some("It stopped before answering.".to_string())),
        Err(e) => (RunStatus::Fail, String::new(), None, Some(format!("{e:#}"))),
    };
    let needs_you = text.trim_start().to_lowercase().starts_with(NEEDS_YOU);
    let run = RunRecord {
        at: at.to_rfc3339_opts(SecondsFormat::Secs, true),
        status,
        duration_ms: started.elapsed().as_millis() as u64,
        cost,
        output_excerpt: excerpt(&text),
        error,
        via: via.to_string(),
        delivery: None,
        needs_you,
    };

    automations::record_run(id, run.clone()).await?;
    let delivery = deliver_result(app, &routine, &run, &text).await;
    automations::note_delivery(id, &run.at, delivery).await?;

    if let (Some(session), true) = (session, routine.quiet) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(MUTE_TAIL).await;
            app.emit("routine_quiet", json!({"sessionId": session, "quiet": false})).ok();
        });
    }
    Ok(())
}

/// The answer's first part, with the needs-you marker taken off the front.
pub fn excerpt(text: &str) -> String {
    let trimmed = text.trim();
    let body = if trimmed.to_lowercase().starts_with(NEEDS_YOU) {
        trimmed[NEEDS_YOU.len()..].trim_start()
    } else {
        trimmed
    };
    if body.chars().count() <= EXCERPT {
        return body.to_string();
    }
    let cut: String = body.chars().take(EXCERPT).collect();
    format!("{}…", cut.trim_end())
}

/// Sends the prompt into the agent's chat and waits for the turn that answers it.
async fn execute(
    app: &AppHandle,
    routine: &Routine,
    extra: Option<&str>,
) -> (Result<Outcome>, Option<String>) {
    let Some(agent) = agents::by_id(&routine.agent_id) else {
        return (Err(anyhow::anyhow!("The agent no longer exists.")), None);
    };
    let prompt = compose(routine, extra);

    let existing = match agent.session_id.as_deref() {
        Some(id) => orchestration::resolved_session(Some(id)).await,
        None => None,
    };
    let (tx, rx) = oneshot::channel();
    let pending = |started, fresh| Pending {
        prompt: prompt.clone(),
        started,
        fresh,
        quiet: routine.quiet,
        tx: Some(tx),
    };

    let session = match &existing {
        Some(item) => {
            let session = item.session_id.clone();
            mute(app, &session, routine.quiet);
            PENDING.lock().expect("routines pending poisoned").insert(session.clone(), pending(false, false));
            if let Err(e) = orchestration::deliver(item, None, &prompt, app).await {
                PENDING.lock().expect("routines pending poisoned").remove(&session);
                return (Err(e), Some(session));
            }
            session
        }
        None => match orchestration::start_agent_session(&agent, &prompt, None, app).await {
            Ok(item) => {
                let session = item.session_id;
                mute(app, &session, routine.quiet);
                // Its first turn is the answer, so it is started already.
                PENDING.lock().expect("routines pending poisoned").insert(session.clone(), pending(true, true));
                session
            }
            Err(e) => return (Err(e), None),
        },
    };

    let outcome = match tokio::time::timeout(TIMEOUT, rx).await {
        Ok(Ok(outcome)) => Ok(outcome),
        Ok(Err(_)) => Err(anyhow::anyhow!("The run was dropped before it finished.")),
        Err(_) => {
            PENDING.lock().expect("routines pending poisoned").remove(&session);
            Err(anyhow::anyhow!("The agent did not finish in {} minutes.", TIMEOUT.as_secs() / 60))
        }
    };
    (outcome, Some(session))
}

fn mute(app: &AppHandle, session: &str, quiet: bool) {
    if quiet {
        app.emit("routine_quiet", json!({"sessionId": session, "quiet": true})).ok();
    }
}

/// A routine from before agents: its own session in its own worktree, as it always
/// ran. Nothing waits on it, so the run records that it started.
async fn legacy(app: &AppHandle, routine: &Routine) -> Result<Outcome> {
    use crate::{
        events::ApprovalPolicy,
        session::{Harness, SendRequest, SessionManager},
    };
    use tauri::Manager;

    let cwd = routine.project_path.as_deref().context("it has no folder to run in")?;
    let session_id = Uuid::now_v7().to_string();
    let outcome = app
        .state::<SessionManager>()
        .send_msg(
            SendRequest {
                session_id: &session_id,
                prompt: &routine.prompt,
                attachment_paths: &[],
                harness: Harness::Mcode,
                model: routine.model.clone().unwrap_or_else(|| ModelId::new(String::new())),
                effort: None,
                permission_mode: ApprovalPolicy::default(),
                fast: false,
                cwd,
                branch: None,
                use_worktree: true,
                worktree_name: None,
                base_ref: None,
                seed_tree: None,
                agent_name: None,
                is_new_session: true,
                parent_session_id: None,
                from: None,
                reply_to: None,
                sent_at: None,
                purpose: None,
            },
            app,
        )
        .await
        .context("could not start the run")?;
    if let Some(item) = outcome.snapshot.map(|s| s.index_item) {
        app.emit(orchestration::SESSION_CREATED, &item).ok();
    }
    Ok(Outcome { ok: true, text: "Started a session in the sidebar.".into(), cost: None })
}

/// Called with every message a session logs: a run queued behind a turn learns
/// when its own prompt becomes the next one.
pub fn observe_user(session_id: &str, text: &str) {
    if let Some(p) = PENDING.lock().expect("routines pending poisoned").get_mut(session_id) {
        // `contains`, not `==`: prompts queued during a turn are flushed joined.
        if !p.started && text.contains(&p.prompt) {
            p.started = true;
        }
    }
}

/// Whether a routine's run is what this session is answering now.
pub fn is_running(session_id: &str) -> bool {
    PENDING.lock().expect("routines pending poisoned").get(session_id).is_some_and(|p| p.started)
}

/// Called when a session's turn closes. Settles the run that turn carried, and
/// keeps a quiet run quiet unless the answer asks for the person.
pub fn observe_completed(
    app: &AppHandle,
    session_id: &str,
    status: &TurnStatus,
    final_text: Option<&str>,
    cost_total: Option<f64>,
) {
    let before = cost_total.and_then(|total| {
        TOTALS.lock().expect("routines totals poisoned").insert(session_id.to_string(), total)
    });

    let mut pending = PENDING.lock().expect("routines pending poisoned");
    if !pending.get(session_id).is_some_and(|p| p.started) {
        return;
    }
    let Some(mut p) = pending.remove(session_id) else { return };
    drop(pending);

    let text = final_text.unwrap_or_default().to_string();
    if p.quiet && text.trim_start().to_lowercase().starts_with(NEEDS_YOU) {
        // Emitted here, ahead of the event the webview announces the turn from.
        app.emit("routine_quiet", json!({"sessionId": session_id, "quiet": false})).ok();
    }
    let cost = cost_share(cost_total, before, p.fresh);
    if let Some(tx) = p.tx.take() {
        let _ = tx.send(Outcome { ok: matches!(status, TurnStatus::Success), text, cost });
    }
}

/// This turn's share of a running session total.
fn cost_share(total: Option<f64>, before: Option<f64>, fresh: bool) -> Option<f64> {
    let total = total?;
    match before {
        Some(b) if total >= b => Some(total - b),
        // The total went down: the session started over, so all of it is this.
        Some(_) => Some(total),
        None if fresh => Some(total),
        None => None,
    }
}

/// Where a result goes beyond the chat the agent answered in. Each place says in
/// a sentence what it did, which the run's sheet shows verbatim.
pub trait ResultSink {
    fn inbox(&self, routine: &Routine, run: &RunRecord, text: &str) -> impl std::future::Future<Output = String> + Send;
    fn channel(&self, channel: &str, routine: &Routine, run: &RunRecord, text: &str) -> impl std::future::Future<Output = String> + Send;
}

/// The real sink: a finished-work note in the Inbox, and a message in the
/// channel from the agent that did the run.
struct Live<'a>(&'a AppHandle);

impl ResultSink for Live<'_> {
    async fn inbox(&self, routine: &Routine, run: &RunRecord, text: &str) -> String {
        let first = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or(&routine.name);
        crate::inbox::push_done(
            self.0,
            &routine.agent_id,
            &format!("{}: {}", routine.name, excerpt(first)),
            &format!("routine \u{00b7} {}s", (run.duration_ms / 1000).max(1)),
            json!({"summary": excerpt(text), "steps": 0, "durationMs": run.duration_ms}),
            None,
        );
        "In the agent's chat and the Inbox.".into()
    }

    async fn channel(&self, channel: &str, routine: &Routine, _run: &RunRecord, text: &str) -> String {
        match crate::channels::post_as_agent(self.0, channel, &routine.agent_id, &excerpt(text)).await {
            Ok(()) => "In the agent's chat and the channel.".into(),
            Err(why) => format!("In the agent's chat. The channel could not take it: {why}"),
        }
    }
}

/// Posts a finished run's result where the routine says. The agent has already
/// answered in its own chat, so `agent_chat` has nothing to add, and a PR comment
/// is the agent's own tool call (see [`compose`]). Returns what happened, in words.
pub async fn deliver_result(app: &AppHandle, routine: &Routine, run: &RunRecord, text: &str) -> String {
    if run.status == RunStatus::Fail {
        return "Nothing to deliver: the run failed.".into();
    }
    delivery_for(&Live(app), routine, run, text).await
}

async fn delivery_for(sink: &impl ResultSink, routine: &Routine, run: &RunRecord, text: &str) -> String {
    match routine.to.as_str() {
        "agent_chat" => "In the agent's chat.".into(),
        "inbox" => sink.inbox(routine, run, text).await,
        "pr_comment" => "In the agent's chat. The agent was asked to comment on the pull request.".into(),
        to => match to.strip_prefix("channel:") {
            Some(channel) => sink.channel(channel, routine, run, text).await,
            None => format!("In the agent's chat. {to:?} is not a place results go."),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn routine(trigger: Trigger, to: &str, quiet: bool) -> Routine {
        serde_json::from_value(json!({
            "id": "r", "name": "Review PRs", "agentId": "a", "prompt": "  Review it.  ",
            "trigger": serde_json::to_value(trigger).unwrap(), "to": to, "quiet": quiet,
        }))
        .unwrap()
    }

    fn hook() -> Trigger {
        Trigger::Webhook { source: "GitHub".into(), event: "pull_request.opened".into() }
    }

    #[test]
    fn the_prompt_is_labelled_and_the_event_appended() {
        let text = compose(&routine(hook(), "inbox", false), Some("acme/app #4 Fix it"));
        assert!(text.starts_with("[routine: Review PRs]\n\nReview it."));
        assert!(text.contains("What called you (GitHub, pull_request.opened):\nacme/app #4 Fix it"));
        assert!(!text.contains("quiet run"));
    }

    #[test]
    fn a_schedule_ignores_extra_and_a_quiet_run_says_how_to_ask_for_the_person() {
        let sched = Trigger::Schedule { days: vec![0], time: "09:00".into(), tz: "UTC".into() };
        let text = compose(&routine(sched, "agent_chat", true), Some("ignored"));
        assert!(!text.contains("ignored"));
        assert!(text.contains("quiet run") && text.contains(NEEDS_YOU));
    }

    #[test]
    fn a_pr_comment_routine_tells_the_agent_to_comment() {
        assert!(compose(&routine(hook(), "pr_comment", false), None).contains("gh pr comment"));
    }

    #[test]
    fn the_excerpt_drops_the_marker_and_cuts_long_answers() {
        assert_eq!(excerpt("[needs you] Stripe key expired."), "Stripe key expired.");
        assert_eq!(excerpt("  fine  "), "fine");
        let long = "x".repeat(2000);
        let cut = excerpt(&long);
        assert!(cut.ends_with('…') && cut.chars().count() == EXCERPT + 1);
    }

    #[test]
    fn a_turns_cost_is_the_difference_of_the_running_total() {
        assert_eq!(cost_share(Some(0.50), Some(0.30), false), Some(0.20));
        assert_eq!(cost_share(Some(0.10), Some(0.30), false), Some(0.10), "the total reset");
        assert_eq!(cost_share(Some(0.12), None, true), Some(0.12), "a session made for the run");
        assert_eq!(cost_share(Some(0.12), None, false), None, "unknown, not zero");
        assert_eq!(cost_share(None, Some(1.0), false), None);
    }

    #[test]
    fn a_pending_run_starts_when_its_own_prompt_is_logged_and_settles_on_the_turn_after() {
        let (tx, mut rx) = oneshot::channel();
        PENDING.lock().unwrap().insert(
            "s-test".into(),
            Pending { prompt: "[routine: x]\n\ndo it".into(), started: false, fresh: false, quiet: false, tx: Some(tx) },
        );

        observe_user("s-test", "something else");
        assert!(!PENDING.lock().unwrap()["s-test"].started);
        observe_user("s-test", "[routine: x]\n\ndo it\n\nand a queued second message");
        assert!(PENDING.lock().unwrap()["s-test"].started);
        assert!(rx.try_recv().is_err());

        // The settle itself needs an AppHandle for the quiet event; the state the
        // hook reads is what is under test here.
        let mut p = PENDING.lock().unwrap().remove("s-test").unwrap();
        let _ = p.tx.take().unwrap().send(Outcome { ok: true, text: "done".into(), cost: None });
        assert_eq!(rx.try_recv().unwrap().text, "done");
    }

    #[derive(Default)]
    struct Spy(std::sync::Mutex<Vec<String>>);

    impl ResultSink for Spy {
        async fn inbox(&self, routine: &Routine, _: &RunRecord, text: &str) -> String {
            self.0.lock().unwrap().push(format!("inbox {} {text}", routine.name));
            "inbox".into()
        }
        async fn channel(&self, channel: &str, _: &Routine, _: &RunRecord, text: &str) -> String {
            self.0.lock().unwrap().push(format!("channel {channel} {text}"));
            "channel".into()
        }
    }

    fn run() -> RunRecord {
        RunRecord {
            at: "2026-10-23T09:00:00Z".into(),
            status: RunStatus::Ok,
            duration_ms: 4000,
            cost: None,
            output_excerpt: String::new(),
            error: None,
            via: "manual".into(),
            delivery: None,
            needs_you: false,
        }
    }

    #[tokio::test]
    async fn a_result_goes_to_the_place_the_routine_names() {
        let spy = Spy::default();
        assert_eq!(delivery_for(&spy, &routine(hook(), "inbox", false), &run(), "all green").await, "inbox");
        assert_eq!(delivery_for(&spy, &routine(hook(), "channel:abc", false), &run(), "all green").await, "channel");
        assert_eq!(delivery_for(&spy, &routine(hook(), "agent_chat", false), &run(), "x").await, "In the agent's chat.");
        assert!(delivery_for(&spy, &routine(hook(), "nowhere", false), &run(), "x").await.contains("not a place"));
        assert_eq!(
            spy.0.lock().unwrap().as_slice(),
            ["inbox Review PRs all green", "channel abc all green"]
        );
    }
}
