//! What happens when a CLI says it has hit its plan limit mid-request.
//!
//! The workspace's "When a CLI hits its limit" picks one of three:
//! - **wait**: resend the same prompt to the same agent once the window resets;
//! - **move**: resend it to an agent on the fallback CLI, with a note saying why;
//! - **ask**: raise an Inbox question and do whichever the reader answers.
//!
//! Only a turn that *ended in an error* is looked at, and only its error text:
//! an answer that happens to mention "rate limit" is not a limit.

use std::{
    collections::HashSet,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use tauri::AppHandle;

use crate::{agents::AgentRecord, events::{AgentEventPayload, MessageSender}, inbox, orchestration, store, workspaces};

/// Phrases the three CLIs use when a plan's window is spent. Lower case.
const NEEDLES: &[&str] = &[
    "usage limit",
    "hit your limit",
    "limit reached",
    "reached your limit",
    "rate limit",
    "rate_limit",
    "quota",
    "too many requests",
    "429",
    "try again at",
    "resets at",
];

/// Whether an error turn's text reads as a plan or rate limit.
pub fn is_limit_error(text: &str) -> bool {
    let lower = text.to_lowercase();
    NEEDLES.iter().any(|n| lower.contains(n))
}

/// What the workspace setting means.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Wait,
    Move,
    Ask,
}

/// The setting's wire value as an action. Anything unknown asks, which is the
/// one that cannot do something the reader did not choose.
pub fn action_for(setting: &str) -> Action {
    match setting {
        "wait" => Action::Wait,
        "move" => Action::Move,
        _ => Action::Ask,
    }
}

/// The teammate to move the request to: on the fallback CLI, in the failing
/// agent's workspace, and not the agent that failed. The first in roster order.
pub fn pick_fallback(candidates: &[AgentRecord], failed: &AgentRecord, harness: &str) -> Option<AgentRecord> {
    candidates
        .iter()
        .find(|a| a.id != failed.id && a.harness == harness && a.workspace_id == failed.workspace_id)
        .cloned()
}

/// The prompt as the fallback agent receives it: why it is arriving, then the
/// original words untouched.
pub fn moved_prompt(from: &str, cli: &str, prompt: &str) -> String {
    format!(
        "[hz] {from} could not answer this because {cli} hit its usage limit, so it was passed to you. \
         Answer it as if it had been sent to you.\n\n{prompt}"
    )
}

/// Words for a CLI by harness wire name.
fn cli_name(harness: &str) -> &str {
    match harness {
        "claude-acp" => "Claude",
        "codex-acp" => "Codex",
        "opencode" => "OpenCode",
        other => other,
    }
}

/// Sessions already being handled, so one failing turn is answered once.
static HANDLING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// The last thing the reader (or a teammate) asked in a session, skipping hz's
/// own hidden prompts.
async fn last_prompt(session_id: &str) -> Option<String> {
    let events = store::list_session_events(session_id).await.ok()?;
    events.into_iter().rev().find_map(|e| match e.payload {
        AgentEventPayload::UserMessage { text, .. }
            if !text.starts_with("<hz-intro/>") && !text.starts_with("<hz-tidy/>") =>
        {
            Some(text)
        }
        _ => None,
    })
}

/// A turn ended in an error. If it was a limit, does what the workspace says.
pub fn on_error_turn(session_id: &str, text: &str, app: &AppHandle) {
    if !is_limit_error(text) {
        return;
    }
    let Some(agent) = crate::agents::agent_of(session_id) else { return };
    if !HANDLING.lock().expect("fallback poisoned").insert(session_id.to_string()) {
        return;
    }
    let (app, session_id) = (app.clone(), session_id.to_string());
    tauri::async_runtime::spawn(async move {
        handle(&agent, &session_id, &app).await;
        HANDLING.lock().expect("fallback poisoned").remove(&session_id);
    });
}

async fn handle(agent: &AgentRecord, session_id: &str, app: &AppHandle) {
    let Some(prompt) = last_prompt(session_id).await else { return };
    let defaults = match agent.workspace_id.as_deref() {
        Some(id) => workspaces::defaults_of(id),
        None => workspaces::first_defaults(),
    };

    let mut action = action_for(&defaults.on_limit);
    if action == Action::Ask {
        let fallback_cli = cli_name(&defaults.fallback_harness);
        let question = format!(
            "{} could not go on: {} hit its usage limit. What should happen to \u{201c}{}\u{201d}?",
            agent.name,
            cli_name(&agent.harness),
            prompt.chars().take(80).collect::<String>()
        );
        let choices = vec!["Wait for the reset".to_string(), format!("Move to {fallback_cli}"), "Leave it".to_string()];
        let answer = inbox::ask_user(app, agent, &question, choices.clone()).await.unwrap_or_default();
        action = if answer == choices[0] {
            Action::Wait
        } else if answer == choices[1] {
            Action::Move
        } else {
            return;
        };
    }

    match action {
        Action::Wait => wait_and_resend(agent, session_id, &prompt, app).await,
        _ => {
            if !move_request(agent, &defaults.fallback_harness, &prompt, app).await {
                // Nobody to move it to: say so rather than lose the request.
                inbox::push_done(
                    app,
                    &agent.id,
                    "A request is stuck on a usage limit",
                    &format!("No {} agent in this workspace to take it", cli_name(&defaults.fallback_harness)),
                    serde_json::json!({"summary": prompt}),
                    Some(session_id),
                );
            }
        }
    }
}

/// Sleeps until the CLI's window resets, then sends the prompt again.
async fn wait_and_resend(agent: &AgentRecord, session_id: &str, prompt: &str, app: &AppHandle) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    // The limit reading when it has one; otherwise half an hour, which is long
    // enough for a rate limit and short enough to try again before the reader
    // has forgotten the request.
    let wait_ms = crate::limits::next_reset_ms(&agent.harness)
        .map_or(30 * 60_000, |at| at.saturating_sub(now) + 30_000);
    inbox::push_done(
        app,
        &agent.id,
        &format!("{} is waiting for {} to reset", agent.name, cli_name(&agent.harness)),
        &format!("Will try again in {} min", wait_ms / 60_000 + 1),
        serde_json::json!({"summary": prompt}),
        Some(session_id),
    );
    tokio::time::sleep(Duration::from_millis(wait_ms)).await;
    if let Some(target) = orchestration::resolved_session(Some(session_id)).await {
        let _ = orchestration::deliver(&target, None, prompt, app).await;
    }
}

/// Sends the prompt, with a note, to a teammate on the fallback CLI. Answers
/// whether there was one to send it to.
async fn move_request(agent: &AgentRecord, fallback_harness: &str, prompt: &str, app: &AppHandle) -> bool {
    let teammates = crate::agents::teammates(&agent.id);
    let Some(target) = pick_fallback(&teammates, agent, fallback_harness) else { return false };
    let text = moved_prompt(&agent.name, cli_name(&agent.harness), prompt);
    let from = MessageSender { session_id: agent.session_id.clone().unwrap_or_default(), title: agent.name.clone() };

    let sent = match orchestration::resolved_session(target.session_id.as_deref()).await {
        Some(existing) => orchestration::deliver(&existing, Some(from), &text, app).await.map(|_| ()),
        None => orchestration::start_agent_session(&target, &text, Some(from), app).await.map(|_| ()),
    };
    if sent.is_ok() {
        inbox::push_done(
            app,
            &agent.id,
            &format!("{} passed a request to {}", agent.name, target.name),
            &format!("{} hit its usage limit", cli_name(&agent.harness)),
            serde_json::json!({"summary": prompt}),
            agent.session_id.as_deref(),
        );
    }
    sent.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str, harness: &str, ws: &str) -> AgentRecord {
        AgentRecord {
            id: id.into(),
            name: id.to_uppercase(),
            harness: harness.into(),
            workspace_id: Some(ws.into()),
            ..Default::default()
        }
    }

    #[test]
    fn the_three_clis_limit_messages_are_recognised() {
        for text in [
            "Claude AI usage limit reached|1760000000",
            "You've hit your usage limit. Upgrade to Pro or try again at 3:10 PM.",
            "5-hour limit reached · resets 3pm",
            "Error 429: Too Many Requests",
            "rate_limit_error: This request would exceed your organization's rate limit",
        ] {
            assert!(is_limit_error(text), "{text}");
        }
    }

    #[test]
    fn an_ordinary_failure_is_not_a_limit() {
        for text in ["The file could not be read.", "Permission denied", "Node.js is needed to start Claude"] {
            assert!(!is_limit_error(text), "{text}");
        }
    }

    #[test]
    fn the_setting_picks_the_action_and_an_unknown_one_asks() {
        assert_eq!(action_for("wait"), Action::Wait);
        assert_eq!(action_for("move"), Action::Move);
        assert_eq!(action_for("ask"), Action::Ask);
        assert_eq!(action_for("???"), Action::Ask);
    }

    #[test]
    fn the_fallback_is_a_teammate_on_the_other_cli_in_the_same_workspace() {
        let failed = agent("ada", "claude-acp", "w1");
        let roster = [
            failed.clone(),
            agent("leo", "claude-acp", "w1"),
            agent("mila", "codex-acp", "w2"),
            agent("hugo", "codex-acp", "w1"),
            agent("zed", "codex-acp", "w1"),
        ];

        assert_eq!(pick_fallback(&roster, &failed, "codex-acp").map(|a| a.id), Some("hugo".into()));
        assert!(pick_fallback(&roster, &failed, "opencode").is_none());
        assert!(pick_fallback(&roster[..2], &failed, "codex-acp").is_none());
    }

    #[test]
    fn the_moved_prompt_says_why_and_keeps_the_original_words() {
        let text = moved_prompt("ADA", "Claude", "price the Pro plan");
        assert!(text.contains("Claude hit its usage limit"));
        assert!(text.ends_with("price the Pro plan"));
    }
}
