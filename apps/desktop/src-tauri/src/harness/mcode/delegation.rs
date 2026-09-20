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
use serde_json::{json, Value};
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use ts_rs::TS;

use super::mapper::Mapper;
use super::parser::{self, McodeEvent, PromptResponse};
use super::McodeSession;
use crate::events::{AgentEvent, AgentEventPayload};

/// The notification the agent pushes whenever its delegation roster moves.
pub const NOTIFICATION: &str = "mcode/session/delegation_update";

/// The request that answers the same roster on demand — for a pane opened after
/// the last push, or a session that was idle when it moved.
const GET: &str = "mcode/session/delegation/get";

/// The request that stops a root session's delegated children together.
const STOP: &str = "mcode/session/delegation/stop";

/// The request that answers what one delegated child has actually said.
///
/// **The roster is status only, and a child's own stream never reaches here** — it
/// is a separate Session — so this is the one door onto a subagent's work. A plain
/// read of a page of messages: it attaches nothing, so watching a child cannot
/// disturb it.
const MESSAGES: &str = "mcode/session/delegation/messages";

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

/// A delegated child's own session, as this app's events.
///
/// **Read, never attach.** The child is a hidden Session whose own stream never
/// reaches its parent, so this is the only door onto a subagent's work — and it is
/// a plain page read that attaches nothing, so polling it cannot disturb the run.
///
/// **The agent projects and this maps, which is the whole design.** The turns come
/// back as the ACP updates `session/load` would have replayed, so they go through
/// the same [`Mapper`] the parent's own stream does — and the subagent is therefore
/// drawn by the code that draws the conversation. The shape that used to come back
/// here was purpose-built for a panel, and it could say no more than "a tool ran".
pub async fn transcript(
    session: &McodeSession,
    member_session_id: &str,
    limit: Option<u64>,
) -> Result<Vec<AgentEvent>> {
    let mut params = json!({
        "sessionId": session.id,
        "memberSessionId": member_session_id,
    });
    if let Some(limit) = limit {
        params["limit"] = json!(limit);
    }

    let reply = session
        .client
        .request(MESSAGES, params)
        .await
        .context("the agent refused to read this subagent's work")?;

    let turns: &[Value] = reply
        .get("turns")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();

    Ok(expand(member_session_id, turns))
}

/// One child's turns, as events this app already knows how to draw.
///
/// **A fresh [`Mapper`] per read, and that is right rather than wasteful.** It is
/// the same mapper that reads the live stream, so its rules — a call is committed
/// by the update that carries arguments, a block is closed by the next kind of
/// chunk, deltas are preview — apply here unchanged. The whole page is replayed
/// each time, so nothing has to be remembered between reads and a child's
/// transcript cannot drift from what its own session says.
fn expand(member_session_id: &str, turns: &[Value]) -> Vec<AgentEvent> {
    let seq = Arc::new(AtomicU64::new(0));
    let mut mapper = Mapper::new(member_session_id.to_string(), Arc::clone(&seq));
    let mut out = Vec::new();

    for turn in turns {
        let status = turn
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("completed");

        // **The prompt is synthesized, never replayed.** ACP has no update for a
        // committed user message — the parent's stream carries its own prompt as
        // the request it sent rather than as a line the child echoes — and this is
        // the boundary the walk cuts turns on. Without it an entire child is one
        // turn with nothing opening it.
        let mut prompt = mapper.synthesize(AgentEventPayload::UserMessage {
            text: turn
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            images: Vec::new(),
            issues: Vec::new(),
            baseline: None,
            queued: false,
            from: None,
            cwd: None,
        });
        // **Stamped with the child's own clock, not this read's.** The turn's
        // duration is a subtraction of two stamps, and both of these are minted
        // here — so left at "now" a child that ran for two minutes reports 0.0s,
        // because the read that produced them took no time at all.
        if let Some(at) = stamp(turn.get("at").and_then(Value::as_i64)) {
            prompt.ts = at;
        }
        out.push(prompt);

        for update in turn
            .get("updates")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            // A shape this build does not model costs the line and not the turn,
            // the same bargain the live read loop makes: a newer agent's update is
            // one row missing, never a child that draws nothing.
            if let Ok(Some(parsed)) = parser::parse_notification("session/update", json!({"update": update}))
            {
                out.extend(mapper.map(McodeEvent::Update(Box::new(parsed))));
            }
        }

        // A turn the agent says is over closes here — and closing is what commits
        // the block it was streaming, so the answer arrives whole rather than as
        // the deltas that previewed it. **The newest turn of a child still working
        // is left open on purpose**: that is what makes it read as live, and what
        // leaves its half-written block on screen as it is written.
        if status != "running" {
            let mut closed = mapper.map(McodeEvent::PromptDone(PromptResponse {
                stop_reason: if status == "failed" {
                    "refused".to_string()
                } else {
                    "end_turn".to_string()
                },
            }));
            // The other half of the pair above: the turn's end is the child's own
            // clock too, so the two together report the wait it actually took.
            if let Some(ended) = stamp(turn.get("endedAt").and_then(Value::as_i64)) {
                for event in &mut closed {
                    event.ts = ended.clone();
                }
            }
            out.extend(closed);
        }
    }

    out
}

/// An epoch-millisecond stamp as this app spells one, or `None` for a value no
/// clock produced.
fn stamp(ms: Option<i64>) -> Option<String> {
    let ms = ms?;
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::AgentEventPayload as P;

    /// One child's turn, as the agent projects it — the three messages every
    /// delegated run has, taken off a real session: the brief, a tool call that
    /// answered, and the reply.
    ///
    /// **Hand-written because a capture would not survive.** This is the agent's
    /// *projection*, not its wire, and the projection is what this build reads —
    /// a fixture of the messages underneath it would pin the layer that is not
    /// being tested.
    fn a_childs_turn() -> Value {
        json!([{
            "id": "turn_task_bg_1",
            "status": "completed",
            "prompt": "Olá! Este é um teste de conexão.",
            // The child's own clock, off its own messages — a read happens
            // whenever a client asks and takes no time at all.
            "at": 1789903868282_i64,
            "endedAt": 1789903901137_i64,
            "updates": [
                {
                    "sessionUpdate": "agent_thought_chunk",
                    "messageId": "m1",
                    "content": {"type": "text", "text": "The assignment is a read-only check."}
                },
                {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "c1",
                    "name": "glob",
                    "kind": "search",
                    "status": "completed",
                    "rawInput": {"pattern": "*", "path": "/repo"}
                },
                {"sessionUpdate": "tool_call_update", "toolCallId": "c1", "status": "completed"},
                {
                    "sessionUpdate": "agent_message_chunk",
                    "messageId": "m2",
                    "content": {"type": "text", "text": "Status: ok\n\nEcho: olá!"}
                }
            ]
        }])
    }

    /// **The whole read, end to end.** What a reader opens onto has to be a
    /// conversation — the brief, what the child thought, the tool it ran with its
    /// result, and the answer — because that is what the panel draws with the
    /// transcript's own components. A missing answer is the failure this pins: the
    /// commit only happens when the turn closes, so an unclosed turn leaves the
    /// child looking like it stopped mid-thought.
    #[test]
    fn a_childs_turn_expands_into_a_whole_conversation() {
        let turns = a_childs_turn();
        let events = expand("mvs_child", turns.as_array().expect("an array of turns"));

        assert!(
            matches!(events[0].payload, P::UserMessage { .. }),
            "the brief opens the turn"
        );
        assert!(
            events.iter().any(|e| matches!(e.payload, P::Reasoning { .. })),
            "the child's thinking arrived"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e.payload, P::ToolCallStarted { .. })),
            "the tool it ran arrived"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e.payload, P::ToolCallCompleted { .. })),
            "and the result the call answered with"
        );

        let answer = events.iter().find_map(|event| match &event.payload {
            P::AssistantText { text, .. } => Some(text.as_str()),
            _ => None,
        });
        assert_eq!(
            answer,
            Some("Status: ok\n\nEcho: olá!"),
            "the answer is committed whole when the turn closes"
        );

        assert!(
            matches!(
                events.last().map(|e| &e.payload),
                Some(P::TurnCompleted { .. })
            ),
            "a turn the agent says is over closes here"
        );
    }

    /// **`Worked for …` reports the child's own wait, not the read that fetched
    /// it.** Both stamps on this line are minted here, and left at "now" a child
    /// that ran for half a minute reads `0.0s` — because the read took no time.
    #[test]
    fn the_synthesized_turn_is_dated_from_the_child() {
        let turns = a_childs_turn();
        let events = expand("mvs_child", turns.as_array().unwrap());

        let start = chrono::DateTime::parse_from_rfc3339(&events[0].ts).expect("a stamp");
        let end = events
            .iter()
            .rev()
            .find_map(|event| match &event.payload {
                P::TurnCompleted { .. } => chrono::DateTime::parse_from_rfc3339(&event.ts).ok(),
                _ => None,
            })
            .expect("the turn closed with a stamp");

        assert_eq!(
            (end - start).num_milliseconds(),
            32_855,
            "the turn's own duration, not the read's"
        );
    }

    /// **A turn still running is left open**, and that is what makes a child read
    /// as live: the block it is writing stays open, so its words arrive as they
    /// are written rather than at the end.
    #[test]
    fn a_running_turn_is_left_open() {
        let mut turns = a_childs_turn();
        turns[0]["status"] = json!("running");

        let events = expand("mvs_child", turns.as_array().unwrap());

        assert!(
            !events
                .iter()
                .any(|e| matches!(e.payload, P::TurnCompleted { .. })),
            "a running turn must not be closed"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e.payload, P::Delta(_))),
            "its text is still a preview, which is what streams"
        );
    }
}
