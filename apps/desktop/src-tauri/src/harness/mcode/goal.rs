//! The goal a session is chasing, and the four calls that move it.
//!
//! **A Goal is the CLI's own object, not this app's**, and it is the one piece of
//! session state hz had no word for: an objective, the turns and tokens spent on
//! it, a budget that can stop it, and a status that pauses, blocks or completes.
//! Its own TUI treats it as first class — a statusline entry and a `/goal` command
//! with `pause`, `resume`, `edit`, `clear` and `budget=` — and the whole of that is
//! four request methods.
//!
//! **It has to be pushed, not polled.** The runtime moves a goal on its own: it
//! pauses one whose budget ran out, and completes one the agent says it finished.
//! A client that only read on demand would sit on a stale objective while the thing
//! that owns it moved on, so `mcode/session/goal_update` carries the whole goal —
//! and `null` with the id of one that was cleared — riding the same notification
//! flag `delegation_update` does.
//!
//! Emitted, never logged, for [`delegations`](super::delegation)'s reason: a goal
//! is the agent's record, and a session replayed after a restart has no child to
//! have stated one. The frontend keeps the last one it saw, which is sound rather
//! than merely convenient — a goal only moves while a child is alive.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use super::McodeSession;

/// The notification the agent pushes whenever a session's goal moves.
pub const NOTIFICATION: &str = "mcode/session/goal_update";

/// The request that answers the goal on demand — for a session whose goal was set
/// before this app connected to it, which is the ordinary case for one set from
/// the CLI's own TUI.
const GET: &str = "mcode/session/goal/get";
const CREATE: &str = "mcode/session/goal/create";
const PATCH: &str = "mcode/session/goal/patch";
const CLEAR: &str = "mcode/session/goal/clear";

/// The Tauri event carrying the pushed goal.
pub const EVENT: &str = "session_goal";

/// A goal, as the agent states one.
///
/// **`status` is a `String` and not an enum**, the bargain every other reader here
/// makes: the agent's vocabulary is `active`, `paused`, `blocked`, `complete` and
/// `budget_limited` today, and a word added after this build must draw as itself
/// rather than fail the line that carried it. What this app *sends* is a closed set
/// — see [`GoalMove`] — because that half is this app's to shape.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    #[serde(default)]
    pub goal_id: String,
    #[serde(default)]
    pub objective: String,
    #[serde(default)]
    pub status: String,
    /// Why the status is what it is, where the agent said so — its own sentence,
    /// drawn as written.
    #[serde(default)]
    pub status_reason: Option<String>,
    #[serde(default)]
    pub tokens_used: u64,
    #[serde(default)]
    pub turns_used: u64,
    /// Absent where the goal was set without one, which is a goal that runs until
    /// somebody stops it rather than forever.
    #[serde(default)]
    pub token_budget: Option<u64>,
    /// Wall-clock seconds the runtime has spent on it, which is the number a
    /// reader watching a long goal actually feels. Ticks on its own, so the band
    /// adds its own second-resolution counter while the goal is `active` rather
    /// than repainting on a push that never comes.
    #[serde(default)]
    pub time_used_seconds: u64,
    /// What an `active` goal is parked on, where it is parked. `None` is the
    /// ordinary "it is working" case.
    #[serde(default)]
    pub execution_wait: Option<ExecutionWait>,
    /// The last verifier's verdict, where the runtime keeps one — the only place
    /// the *why* of a goal that has not finished lives.
    #[serde(default)]
    pub last_verification: Option<Verification>,
}

/// What an `active` goal is waiting on.
///
/// **The status stays `active` while this is set**, which is the vendor's own
/// rule: a wait is an execution detail inside a running goal, not a lifecycle
/// state. The band draws the wait's phrase where the status word would go.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ExecutionWait {
    /// The runtime's vocabulary: `questionnaire`, `permission`, `plan`,
    /// `required_background`, `automation_owner_conflict`,
    /// `dependency_unavailable`, `verification`, `unknown`. A `String` for the
    /// reason every other reader here gives — a reason added after this build
    /// must draw as itself rather than fail the line that carried it.
    #[serde(default)]
    pub reason: String,
}

/// The last verifier's verdict on a goal.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    /// `met`, `not_met`, `impossible`, `inconclusive` — the vendor's words,
    /// drawn as written for `status`'s reason.
    #[serde(default)]
    pub verdict: String,
    #[serde(default)]
    pub not_met_streak: u64,
    /// What the verifier says is missing, where it says so.
    #[serde(default)]
    pub missing: Vec<String>,
}

/// The goal that just finished, where this push is the moment it did.
///
/// **The transition, not the state.** The runtime re-pushes a goal whenever
/// anything in it moves — a token count, a wait starting, a status reason — so a
/// rule that read "the status is `complete`" would write a receipt on every push
/// for as long as the goal existed. What makes a moment is that the status
/// *changed* into `complete`.
pub fn completion_of<'a>(previous: Option<&str>, next: Option<&'a Goal>) -> Option<&'a Goal> {
    let goal = next?;
    if goal.status != "complete" || previous == Some("complete") {
        return None;
    }
    Some(goal)
}

/// What a control can ask a goal to do.
///
/// **Two of the agent's five, and the split is who decides.** `blocked`,
/// `complete` and `budget_limited` are the agent's own verdicts on work it is
/// doing; a button for `complete` would let a reader tell the agent that a job it
/// is still on is finished, which is the one thing a goal exists to keep honest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum GoalMove {
    /// Set it running again — the agent's `active`, which is also what a goal is
    /// created as.
    #[serde(rename = "active")]
    Resume,
    #[serde(rename = "paused")]
    Pause,
}

/// The pushed notification, as the read loop reads it.
///
/// `goal: null` is a clear rather than a missing field, and the agent names the
/// goal it cleared beside it — so the event says "there is none" instead of
/// saying nothing, which would leave the last one drawn.
pub fn event_of(params: &Value, session_id: &str) -> GoalEvent {
    GoalEvent {
        session_id: session_id.to_string(),
        goal: goal_of(params),
    }
}

/// The goal inside a payload, or `None` where there is none.
///
/// **One reader for the notification and the `get` reply**, which carry the same
/// key: a session with no goal is the ordinary state, and both answer it the same
/// way. A payload this build cannot read also reads as no goal — the safe
/// direction, since a goal drawn from half a row would claim an objective nobody
/// stated.
pub fn goal_of(payload: &Value) -> Option<Goal> {
    let goal = payload.get("goal")?;
    if goal.is_null() {
        return None;
    }
    serde_json::from_value(goal.clone()).ok()
}

/// The pushed goal, shaped for the webview.
///
/// Carries *this* app's session id rather than the wire's, so the frontend routes
/// it into the session it already holds — mcode's own id lives on the index entry
/// and nowhere the listener reads.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct GoalEvent {
    pub session_id: String,
    pub goal: Option<Goal>,
}

/// Reads a session's goal on demand, for one set before this app connected.
pub async fn get(session: &McodeSession) -> Result<Option<Goal>> {
    let reply = session
        .client
        .request(GET, json!({"sessionId": session.id}))
        .await
        .context("the agent refused to report this session's goal")?;
    Ok(goal_of(&reply))
}

/// Starts a goal on a session.
///
/// The budget rides only where the reader set one: absent means no budget, and
/// `null` is what the agent takes for "none" — sending `0` would be a goal that is
/// over before it starts.
pub async fn create(
    session: &McodeSession,
    objective: &str,
    token_budget: Option<u64>,
) -> Result<Option<Goal>> {
    let reply = session
        .client
        .request(
            CREATE,
            json!({
                "sessionId": session.id,
                "objective": objective,
                "tokenBudget": token_budget,
            }),
        )
        .await
        .context("the agent refused to set a goal on this session")?;
    Ok(goal_of(&reply))
}

/// Pauses or resumes the goal a session already has.
pub async fn move_goal(session: &McodeSession, move_: GoalMove) -> Result<Option<Goal>> {
    let reply = session
        .client
        .request(
            PATCH,
            json!({"sessionId": session.id, "status": move_}),
        )
        .await
        .context("the agent refused to move this session's goal")?;
    Ok(goal_of(&reply))
}

/// Rewrites a goal's objective and its budget together.
///
/// **The two fields the dialog that edits one owns, and both always ride.**
/// `tokenBudget: null` is the agent's own way of saying "no budget", so it is what
/// an emptied field sends — the alternative, an omitted field, means "leave it as
/// it is" and would leave a budget the reader just deleted still in force.
pub async fn edit(
    session: &McodeSession,
    objective: &str,
    token_budget: Option<u64>,
) -> Result<Option<Goal>> {
    let reply = session
        .client
        .request(
            PATCH,
            json!({
                "sessionId": session.id,
                "objective": objective,
                "tokenBudget": token_budget,
            }),
        )
        .await
        .context("the agent refused to change this session's goal")?;
    Ok(goal_of(&reply))
}

/// Drops a session's goal.
pub async fn clear(session: &McodeSession) -> Result<()> {
    session
        .client
        .request(CLEAR, json!({"sessionId": session.id}))
        .await
        .context("the agent refused to clear this session's goal")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A goal as the agent states one, off a real `goal/create` answer.
    const CREATED: &str = r#"{"goal":{"goalId":"tg_0ezkffildtmud8258d",
        "sessionId":"mvs_1e89fb5e08a848bdba2bfdc14b989eeb",
        "objective":"make the inbox list pull requests","status":"active",
        "createdAt":1790114677501,"updatedAt":1790114677501,
        "tokensUsed":0,"turnsUsed":0,"timeUsedSeconds":0,"tokenBudget":50000,
        "statusReason":null,"executionWait":null,"hasKickoffAttachments":false}}"#;

    fn payload(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn reads_the_goal_out_of_a_push() {
        let goal = goal_of(&payload(CREATED)).expect("a goal reads");

        assert_eq!(goal.goal_id, "tg_0ezkffildtmud8258d");
        assert_eq!(goal.objective, "make the inbox list pull requests");
        assert_eq!(goal.status, "active");
        assert_eq!(goal.token_budget, Some(50_000));
        assert_eq!(goal.tokens_used, 0);
        assert_eq!(goal.turns_used, 0);
    }

    /// The clear rides the same notification as a change, so the two have to be
    /// told apart: read as "unreadable" it would leave the old goal on screen for
    /// the rest of the session.
    #[test]
    fn a_null_goal_is_no_goal() {
        assert!(goal_of(&payload(r#"{"goal":null,"goalId":"tg_1"}"#)).is_none());
        // And `get` on a session that never had one answers the same way.
        assert!(goal_of(&payload(r#"{"goal": null}"#)).is_none());
    }

    /// A goal with no budget is ordinary — it runs until somebody stops it — and
    /// it must not read as a budget of zero, which is a goal that is over.
    #[test]
    fn an_absent_budget_is_not_zero() {
        let goal = goal_of(&payload(
            r#"{"goal":{"goalId":"tg_1","objective":"x","status":"active","tokensUsed":12,
                "turnsUsed":1,"tokenBudget":null,"statusReason":null}}"#,
        ))
        .expect("a goal reads");

        assert_eq!(goal.token_budget, None);
        assert_eq!(goal.tokens_used, 12);
    }

    /// A status this build has never heard of draws as itself. The agent gaining a
    /// sixth is not a reason for the reader to see nothing.
    #[test]
    fn an_unknown_status_still_reads() {
        let goal = goal_of(&payload(
            r#"{"goal":{"goalId":"tg_1","objective":"x","status":"reticulating",
                "tokensUsed":0,"turnsUsed":0}}"#,
        ))
        .expect("a goal reads");

        assert_eq!(goal.status, "reticulating");
    }

    /// Every field but the two the app draws its own words around is optional: a
    /// goal the agent answers with less than this build expects is still a goal.
    #[test]
    fn a_thin_goal_still_reads() {
        let goal = goal_of(&payload(r#"{"goal":{"status":"paused"}}"#)).expect("a goal reads");

        assert_eq!(goal.status, "paused");
        assert_eq!(goal.objective, "");
        assert_eq!(goal.token_budget, None);
    }

    /// What a control sends, and the two the reader does not get to send.
    #[test]
    fn a_move_is_one_of_the_agent_s_spellings() {
        assert_eq!(serde_json::to_value(GoalMove::Resume).unwrap(), json!("active"));
        assert_eq!(serde_json::to_value(GoalMove::Pause).unwrap(), json!("paused"));
    }

    /// The event carries this app's own id, so the frontend can route it without
    /// knowing what mcode calls the session.
    #[test]
    fn the_event_carries_this_app_s_session() {
        let event = event_of(&payload(CREATED), "hz-session");

        assert_eq!(event.session_id, "hz-session");
        assert!(event.goal.is_some());
    }

    /// Only the change into `complete` is a moment. The state alone repeats.
    #[test]
    fn only_the_transition_into_complete_is_a_receipt() {
        let mut goal = Goal {
            status: "active".into(),
            ..Default::default()
        };
        assert!(completion_of(None, Some(&goal)).is_none());
        assert!(completion_of(Some("active"), Some(&goal)).is_none());
        assert!(completion_of(None, None).is_none());

        goal.status = "complete".into();
        assert!(completion_of(Some("active"), Some(&goal)).is_some());
        assert!(completion_of(Some("blocked"), Some(&goal)).is_some());
        assert!(completion_of(None, Some(&goal)).is_some());
        // The push that repeats it is not a second receipt.
        assert!(completion_of(Some("complete"), Some(&goal)).is_none());
        // And a goal resumed and finished again is a new one.
        assert!(completion_of(Some("active"), Some(&goal)).is_some());
    }
}
