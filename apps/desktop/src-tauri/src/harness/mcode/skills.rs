//! What the agent answers about the reader's Skills.
//!
//! **The screen that draws this is not a session and does not own one.** Every
//! call here takes the session it is asked on — the control child
//! [`open_control`](super::open_control) keeps — and holds nothing, so that
//! child's lifecycle stays in one place rather than being smeared across the
//! readers of it.
//!
//! **The roster read here is the management one, not the runtime one.** The agent
//! has two lists: the runtime list is what the *model* is told about, and a Skill
//! switched off is filtered out of it; this is the one the app's own "My skills"
//! reads, which keeps every row and marks it. Building a screen with switches on
//! the first list is how a Skill gets switched off and then never seen again —
//! there would be no row left to switch it back on.
//!
//! Rejected: reading `SKILL.md` here and handing the frontend the text directly.
//! The registry owns where a Skill lives and what its body is, and a path parsed
//! out of a `files://` URI is this app keeping a copy of a fact that moves.

use anyhow::{Context, Result};
use serde_json::{json, Value};

use super::McodeSession;
use crate::plugins::{PluginSkill, SkillRoster, SkillToggle};

/// The whole roster, Skills switched off included and marked.
pub async fn roster(session: &McodeSession) -> Result<SkillRoster> {
    let reply = session
        .client
        .request("mcode/session/skills/list", json!({"sessionId": session.id}))
        .await
        .context("the agent refused to list its Skills")?;

    Ok(SkillRoster {
        skills: reply
            .get("skills")
            .and_then(Value::as_array)
            .map(|rows| rows.iter().filter_map(skill_of).collect())
            .unwrap_or_default(),
        // Rides the answer rather than being assumed away: a screen drawing a
        // count would otherwise be stating something it was never told.
        has_more: reply
            .get("hasMore")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

/// Switches one Skill, and answers whether the registry took it.
///
/// **A refusal is not an error here.** The registry answers nothing for a Skill it
/// does not recognise — a row deleted or renamed since it was drawn — and that
/// arrives as `applied: false` on a successful call, which is the sentence the
/// screen can draw. What an `Err` means is the transport, so the caller drops the
/// child rather than retrying into a refusal.
pub async fn set_enabled(
    session: &McodeSession,
    name: &str,
    enabled: bool,
    location_uri: Option<&str>,
) -> Result<SkillToggle> {
    let reply = session
        .client
        .request(
            "mcode/session/skills/set_enabled",
            json!({
                "sessionId": session.id,
                "name": name,
                "enabled": enabled,
                // The registry keys its disabled set by this, so a row built from
                // a location hands it back: a rename between the read and the
                // press would otherwise leave the switch setting nothing, and it
                // would fail silently.
                "locationUri": location_uri,
            }),
        )
        .await
        .context("the agent refused to switch this Skill")?;

    Ok(SkillToggle {
        name: reply
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(name)
            .to_string(),
        enabled: reply
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(enabled),
        // Absent reads as *not* applied: a screen that claimed the switch took
        // when the agent said nothing would move a control over nothing.
        applied: reply
            .get("applied")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

/// One Skill's own text, or `None` for one the registry cannot find.
pub async fn read(
    session: &McodeSession,
    name: &str,
    location_uri: Option<&str>,
) -> Result<Option<String>> {
    let reply = session
        .client
        .request(
            "mcode/session/skills/read",
            json!({"sessionId": session.id, "name": name, "locationUri": location_uri}),
        )
        .await
        .context("the agent refused to read this Skill")?;

    // `null` is the agent's word for a Skill that is gone. It stays `None` rather
    // than becoming an error: the row the reader pressed may have been deleted
    // since it was listed, and "this one is gone" is a sentence, not a failure.
    Ok(reply
        .get("text")
        .and_then(Value::as_str)
        .map(str::to_string))
}

/// One row of the roster, out of the agent's own object.
///
/// A row this build cannot name is dropped rather than drawn as an empty line —
/// nothing on screen can be done with it. `enabled` is the exception and the
/// reason this is not a strict parse: absent means *on*, which is the registry's
/// own default, and reading it the other way would draw every Skill as switched
/// off on a reply that predates the field.
fn skill_of(row: &Value) -> Option<PluginSkill> {
    let name = text(row, "name")?;
    Some(PluginSkill {
        display_name: text(row, "displayName").unwrap_or_else(|| name.clone()),
        name,
        description: text(row, "description").unwrap_or_default(),
        enabled: row
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        source_kind: text(row, "sourceKind"),
        location_uri: text(row, "locationUri"),
    })
}

/// A trimmed non-empty string, or `None`.
fn text(row: &Value, key: &str) -> Option<String> {
    let value = row.get(key).and_then(Value::as_str)?.trim();
    (!value.is_empty()).then(|| value.to_string())
}
