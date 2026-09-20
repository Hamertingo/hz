//! What the agent answers about its own Agent definitions.
//!
//! **An Agent is not a Session and not a subagent.** It is a stored identity and
//! prompt that a Session is later started *under*, and it is the thing a `task`
//! call names in `agent_name`. Three are built in — `explore`, `worker`,
//! `verifier` — and the reader may write their own; this is the screen that reads
//! and writes them.
//!
//! **The store owns the rules.** A name that collides with a reserved role, a
//! blank prompt, an Agent that is gone: each is refused in the agent's own words,
//! which reach the reader untouched. Nothing here validates a draft, so a rule
//! the agent adds later cannot be one this build disagrees with.
//!
//! Every call takes the session it is asked on — the control child
//! [`open_control`](super::open_control) keeps — and holds nothing, the bargain
//! [`skills`](super::skills) makes: that child's lifecycle lives in one place
//! rather than being smeared across its readers.

use anyhow::{Context, Result};
use serde_json::{json, Map, Value};

use super::McodeSession;
use crate::plugins::{AgentDetail, AgentDraft, PluginAgent};

/// Every Agent the machine holds, the built-in roles included.
pub async fn roster(session: &McodeSession) -> Result<Vec<PluginAgent>> {
    let reply = session
        .client
        .request("mcode/agents/list", json!({}))
        .await
        .context("the agent refused to list its Agents")?;

    Ok(reply
        .get("agents")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().filter_map(agent_of).collect())
        .unwrap_or_default())
}

/// One Agent with its stored prompt, or `None` for one the store cannot find.
///
/// **`null` is an answer, not an error.** An Agent deleted or renamed between the
/// list and the press is a sentence the screen can draw — "this one is gone" —
/// where an `Err` would only say the transport failed, which is not what
/// happened.
pub async fn get(session: &McodeSession, name: &str) -> Result<Option<AgentDetail>> {
    let reply = session
        .client
        .request("mcode/agents/get", json!({"name": name}))
        .await
        .context("the agent refused to read this Agent")?;

    Ok(reply
        .get("agent")
        .filter(|value| !value.is_null())
        .and_then(detail_of))
}

/// Writes a new Agent definition down, and answers what was stored.
pub async fn create(session: &McodeSession, draft: &AgentDraft) -> Result<AgentDetail> {
    let reply = session
        .client
        .request("mcode/agents/create", Value::Object(create_body(draft)))
        .await
        .context("the agent refused to write this Agent down")?;

    reply
        .get("agent")
        .and_then(detail_of)
        .context("the agent answered with no Agent")
}

/// Rewrites an Agent's identity and prompt. An absent field is left as stored.
pub async fn update(
    session: &McodeSession,
    name: &str,
    draft: &AgentDraft,
) -> Result<AgentDetail> {
    let mut body = draft_json(draft);
    // The name is the address, not a field of the draft: a rewrite is keyed by
    // what the row was drawn from, so it is set last and cannot be overwritten
    // by a stray `name` in the body.
    body.insert("name".to_string(), json!(name));

    let reply = session
        .client
        .request("mcode/agents/update", Value::Object(body))
        .await
        .context("the agent refused to rewrite this Agent")?;

    reply
        .get("agent")
        .and_then(detail_of)
        .context("the agent answered with no Agent")
}

/// Removes an Agent definition, answering whether the store took it.
pub async fn delete(session: &McodeSession, name: &str) -> Result<bool> {
    let reply = session
        .client
        .request("mcode/agents/delete", json!({"name": name}))
        .await
        .context("the agent refused to remove this Agent")?;

    // Absent reads as *not* removed: a screen that told the reader an Agent was
    // gone when the agent said nothing would remove a row over nothing.
    Ok(reply
        .get("removed")
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

/// One row of the roster, out of the agent's own object.
///
/// A row this build cannot name is dropped rather than drawn as an empty line —
/// nothing on screen can be done with it. Everything else is optional, because
/// the identity line is the only part a row cannot do without.
fn agent_of(row: &Value) -> Option<PluginAgent> {
    let name = text(row, "name")?;
    let creation_source = text(row, "creationSource").unwrap_or_default();
    // The built-in roles are the ones the store marks as such, and that mark is
    // the agent's own word rather than a list of names this build keeps — a role
    // added after this build files itself correctly.
    let builtin = creation_source == "builtin";

    Some(PluginAgent {
        display_name: text(row, "displayName").unwrap_or_else(|| name.clone()),
        name,
        description: text(row, "description"),
        avatar: text(row, "avatar"),
        agent_role: text(row, "agentRole").unwrap_or_default(),
        creation_source,
        builtin,
    })
}

/// One Agent with its prompt, out of a reply that nests both.
fn detail_of(value: &Value) -> Option<AgentDetail> {
    Some(AgentDetail {
        agent: agent_of(value.get("agent")?)?,
        // Absent means the Agent has no stored prompt, which is a state the store
        // allows — the form opens on an empty box rather than an error.
        system_prompt: text(value, "systemPrompt"),
        persona: text(value, "persona"),
    })
}

/// A draft as the agent's own request shape.
///
/// **Blank names are dropped and blank prose is kept.** An empty name box means
/// "leave the name alone", so sending it would be a refusal about a field the
/// reader did not touch; an empty prompt is something a reader may genuinely
/// mean, so it is sent as the empty string it is.
fn draft_json(draft: &AgentDraft) -> Map<String, Value> {
    let mut body = Map::new();

    if let Some(name) = named(&draft.name) {
        body.insert("name".to_string(), json!(name));
    }
    if let Some(display_name) = named(&draft.display_name) {
        body.insert("displayName".to_string(), json!(display_name));
    }
    if let Some(description) = &draft.description {
        body.insert("description".to_string(), json!(description));
    }
    if let Some(avatar) = &draft.avatar {
        body.insert("avatar".to_string(), json!(avatar));
    }
    if let Some(prompt) = &draft.system_prompt {
        body.insert("systemPrompt".to_string(), json!(prompt));
    }
    if let Some(persona) = &draft.persona {
        body.insert("persona".to_string(), json!(persona));
    }

    body
}

/// The create request: the identity fields, plus the whole definition where a
/// model is named.
///
/// **The definition rides because a model has nowhere else to go.** An Agent that
/// inherits the runtime default is resolved *through* that default's context
/// window, and where the catalog carries no physical limit for the model — every
/// BYOK provider's — the store refuses the save outright. Naming a model at the
/// write is what keeps the Agent runnable, and the identity fields are the only
/// place a creation can state one. See
/// [`default_model`](super::providers::default_model).
fn create_body(draft: &AgentDraft) -> Map<String, Value> {
    let mut body = draft_json(draft);

    if let Some(model) = named(&draft.model) {
        body.insert(
            "initialDefinition".to_string(),
            json!({
                // The store resolves the create name itself, so this is the
                // caller's suggestion rather than the key — it is the same string
                // either way, and an absent one would leave the definition
                // nameless.
                "name": named(&draft.name).unwrap_or_default(),
                "description": draft.description.clone().unwrap_or_default(),
                "systemPrompt": draft.system_prompt.clone().unwrap_or_default(),
                "model": model,
            }),
        );
    }

    body
}

/// A name that says something, or `None` for one that is blank.
fn named(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|name| !name.is_empty())
}

/// A trimmed non-empty string, or `None`.
fn text(row: &Value, key: &str) -> Option<String> {
    let value = row.get(key).and_then(Value::as_str)?.trim();
    (!value.is_empty()).then(|| value.to_string())
}
