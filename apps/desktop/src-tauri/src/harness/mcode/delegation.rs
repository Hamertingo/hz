//! What the agent answers about the work it delegated.
//!
//! **The agent keeps the roster of its own children** — the nested agents a
//! `task` call starts — and publishes it over two request methods and one
//! notification. The transcript does not need it: a `task` call and its result
//! are the whole account of a run on the parent's own stream. What this adds is
//! the live half the parent's stream never carries — which children are still
//! running — and the one control that stops them.
//!
//! **`delegation/stop` stops a root session's children together.** The agent
//! publishes no per-task handle over ACP, so there is no narrower stop to offer.
//! Empty `agent_id`s on the mapper's own subagent events say the same thing from
//! the other side.
//!
//! The notification is **live only**: a snapshot names children no child
//! survives a restart, so it is emitted to the webview and never written to a
//! session's log, the same bargain `slash_commands` makes.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::McodeSession;

/// The notification the agent pushes whenever its delegation roster moves.
pub const NOTIFICATION: &str = "mcode/session/delegation_update";

/// The request that answers the same roster on demand — for a pane opened after
/// the last push, or a session that was idle when it moved.
const GET: &str = "mcode/session/delegation/get";

/// The request that stops a root session's delegated children together.
const STOP: &str = "mcode/session/delegation/stop";

/// The Tauri event carrying it, and the shape a one-shot read answers with.
pub const EVENT: &str = "subagent_delegations";

/// One child the agent delegated to.
///
/// Every field but the status is optional, because the agent fills what it knows
/// and a row this build cannot name is still a row the reader is owed: an
/// unnamed child that is *running* is worth more on screen than nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct DelegatedMember {
    /// The child Session's own id — mcode's, never this app's. It is what the
    /// roster is keyed by and what correlates nothing in the transcript.
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub parent_session_id: String,
    /// The agent it runs as — `explore`, `worker`, `verifier` or a custom name.
    #[serde(default)]
    pub agent_name: Option<String>,
    /// The short title the spawning call gave it, where it named one.
    #[serde(default)]
    pub task: Option<String>,
    /// `queued`, `running`, `completed`, `failed`, `stopped` or `unknown` — the
    /// agent's own vocabulary, carried verbatim so a word added later draws as
    /// itself rather than as nothing.
    #[serde(default)]
    pub status: String,
    /// The background task this child belongs to, where it is a background one.
    /// The only handle that ever correlates a roster row to a tool call.
    #[serde(default)]
    pub background_task_id: Option<String>,
    #[serde(default)]
    pub error_message: Option<String>,
}

/// The roster, shaped for the webview.
///
/// Carries *this* app's session id rather than the wire's, so the frontend
/// routes it into the session it already holds — mcode's own id lives on the
/// index entry and nowhere the listener reads.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct DelegationEvent {
    pub session_id: String,
    pub members: Vec<DelegatedMember>,
}

/// What a stop did, counted.
///
/// Three numbers rather than the agent's four id lists: the reader's question is
/// whether the work stopped, and a list of child session ids is a fact nothing
/// on screen can draw.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct DelegationStop {
    pub stopped: u64,
    pub active: u64,
    pub failed: u64,
}

/// Reads a `{snapshot: {members: […]}}` payload.
///
/// **Both the notification and the `delegation/get` reply carry it**, so one
/// reader serves the two. An absent snapshot reads as no members rather than as
/// a failure: a session with nothing delegated is the ordinary state, and the
/// agent answers an empty roster the same way it answers the one after a child
/// finished. A single unreadable row is dropped rather than taking the roster
/// with it — the same bargain the MCP and Skill readers make.
pub fn members_of(payload: &Value) -> Vec<DelegatedMember> {
    payload
        .get("snapshot")
        .and_then(|snapshot| snapshot.get("members"))
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| serde_json::from_value(row.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

/// The pushed notification, as the read loop reads it.
pub fn event_of(params: &Value, session_id: &str) -> DelegationEvent {
    DelegationEvent {
        session_id: session_id.to_string(),
        members: members_of(params),
    }
}

/// Reads a session's roster on demand, for a pane opened after the last push.
pub async fn snapshot(session: &McodeSession) -> Result<Vec<DelegatedMember>> {
    let reply = session
        .client
        .request(GET, serde_json::json!({"sessionId": session.id}))
        .await
        .context("the agent refused to report its delegated work")?;
    Ok(members_of(&reply))
}

/// Stops every child of the session's root, and counts what the agent did.
pub async fn stop(session: &McodeSession) -> Result<DelegationStop> {
    let reply = session
        .client
        .request(STOP, serde_json::json!({"sessionId": session.id}))
        .await
        .context("the agent refused to stop its delegated work")?;

    Ok(DelegationStop {
        stopped: count(&reply, "stoppedSessionIds"),
        // Left running rather than stopped — a child that refused to abort. The
        // reader asked for all of them, so the number that did not go is the one
        // worth saying.
        active: count(&reply, "activeSessionIds"),
        failed: count(&reply, "failedSessionIds"),
    })
}

/// The length of one id list in a stop receipt.
fn count(reply: &Value, key: &str) -> u64 {
    reply
        .get(key)
        .and_then(Value::as_array)
        .map(|ids| ids.len() as u64)
        .unwrap_or(0)
}
