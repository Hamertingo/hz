//! What the agent answers about the reader's MCP servers.
//!
//! **The reader's own store, reached the way the Skill roster is** — the control
//! child [`open_control`](super::open_control) keeps, one question at a time, with
//! this module holding nothing. See [`crate::plugins`] for why that child exists
//! and [`crate::harness::mcode::skills`] for the same arrangement on the other
//! half of the Plugins screen.
//!
//! **Except that this half takes no session.** The Skill methods are
//! `mcode/session/*` and need one; these are `mcode/mcp/servers/*` and do not,
//! because the file they read and write belongs to the machine rather than to a
//! conversation — so there is no session id on any of these calls.
//!
//! Rejected: writing `mcp.json` from here. The agent has a service for it that
//! validates a name, refuses a duplicate, checks the transport's own fields, writes
//! at `0600` and can test the connection — and its reader *rejects an unknown
//! field*, so a hand-written entry would not fail alone: it could take the whole
//! file down and with it every server the reader has.

use anyhow::Result;
use serde_json::{json, Value};

use super::rpc::RpcError;
use super::McodeSession;
use crate::plugins::{McpConfig, McpServerDetail, McpTestResult, McpTool, PluginMcpServer};

/// Every server written down, off ones included.
pub async fn list(session: &McodeSession, keyword: Option<&str>) -> Result<Vec<PluginMcpServer>> {
    let reply = session
        .client
        .request("mcode/mcp/servers/list", json!({"keyword": keyword}))
        .await
        .map_err(spoken)?;

    Ok(reply
        .get("servers")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().filter_map(server_of).collect())
        .unwrap_or_default())
}

/// One server's whole configuration, or `None` for one that is gone.
pub async fn get(session: &McodeSession, name: &str) -> Result<Option<McpServerDetail>> {
    let reply = session
        .client
        .request("mcode/mcp/servers/get", json!({"name": name}))
        .await
        .map_err(spoken)?;

    // `null` is the agent's word for a server that is gone, and it stays `None`
    // rather than becoming an error: the row the reader pressed may have been
    // deleted since it was listed, which is a sentence the screen can draw.
    Ok(reply.get("server").and_then(detail_of))
}

pub async fn create(
    session: &McodeSession,
    name: &str,
    config: &McpConfig,
) -> Result<McpServerDetail> {
    let reply = session
        .client
        .request(
            "mcode/mcp/servers/create",
            json!({"name": name, "config": config}),
        )
        .await
        .map_err(spoken)?;

    detail_of(reply.get("server").unwrap_or(&Value::Null))
        .ok_or_else(|| anyhow::anyhow!("the agent saved the server but answered nothing about it"))
}

pub async fn update(
    session: &McodeSession,
    name: &str,
    config: &McpConfig,
) -> Result<McpServerDetail> {
    let reply = session
        .client
        .request(
            "mcode/mcp/servers/update",
            json!({"name": name, "config": config}),
        )
        .await
        .map_err(spoken)?;

    detail_of(reply.get("server").unwrap_or(&Value::Null))
        .ok_or_else(|| anyhow::anyhow!("the agent saved the server but answered nothing about it"))
}

pub async fn delete(session: &McodeSession, name: &str) -> Result<bool> {
    let reply = session
        .client
        .request("mcode/mcp/servers/delete", json!({"name": name}))
        .await
        .map_err(spoken)?;

    Ok(reply
        .get("deleted")
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

pub async fn set_enabled(session: &McodeSession, name: &str, enabled: bool) -> Result<PluginMcpServer> {
    let reply = session
        .client
        .request(
            "mcode/mcp/servers/set_enabled",
            json!({"name": name, "enabled": enabled}),
        )
        .await
        .map_err(spoken)?;

    server_of(reply.get("server").unwrap_or(&Value::Null))
        .ok_or_else(|| anyhow::anyhow!("the agent moved the switch but answered nothing about it"))
}

/// Connects once and answers what happened — a refusal is the *answer* here.
pub async fn test(session: &McodeSession, name: &str) -> Result<McpTestResult> {
    let reply = session
        .client
        .request("mcode/mcp/servers/test", json!({"name": name}))
        .await
        .map_err(spoken)?;

    let result = reply.get("result").unwrap_or(&Value::Null);
    Ok(McpTestResult {
        // Absent reads as *not* working: a client that claimed a connection the
        // agent never confirmed would be reporting something nobody observed.
        success: result
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        tool_count: result.get("toolCount").and_then(Value::as_u64),
        tools: result
            .get("tools")
            .and_then(Value::as_array)
            .map(|rows| rows.iter().filter_map(tool_of).collect())
            .unwrap_or_default(),
        error_code: text(result, "errorCode"),
        error_message: text(result, "errorMessage"),
    })
}

/// One tool the server offers, out of the agent's own object.
///
/// A row this build cannot name is dropped: there is nothing to do with it on a
/// list, and a blank line where a tool should be reads as a broken server.
fn tool_of(row: &Value) -> Option<McpTool> {
    Some(McpTool {
        name: text(row, "name")?,
        description: text(row, "description"),
    })
}

/// A refusal as the agent worded it, with the JSON-RPC code dropped.
///
/// **The code is kept everywhere else.** `RpcError`'s `Display` carries
/// `(code -32602)` because the code is what tells a retryable failure from a
/// permanent one — which matters in a log, and is noise under a form where the
/// sentence beside it is the whole answer. The chain still holds it for anything
/// that wants to look.
fn spoken(error: anyhow::Error) -> anyhow::Error {
    let message = error
        .downcast_ref::<RpcError>()
        .map(|refusal| refusal.message.clone());
    match message {
        Some(message) => anyhow::anyhow!(message),
        None => error,
    }
}

/// One row of the listing, out of the agent's own object.
fn server_of(row: &Value) -> Option<PluginMcpServer> {
    Some(PluginMcpServer {
        name: text(row, "name")?,
        // Absent reads as on, the agent's own default: a server nobody switched
        // off is one a session is offered.
        enabled: row.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        transport: text(row, "transport")?,
        description: text(row, "description"),
        endpoint: text(row, "endpoint"),
    })
}

/// One server with its whole configuration.
fn detail_of(row: &Value) -> Option<McpServerDetail> {
    let config = row.get("config")?;
    Some(McpServerDetail {
        name: text(row, "name")?,
        enabled: row.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        // Deserialised rather than read field by field: the reply is the agent's
        // own union — a stdio server carries `command`, a remote one `url` — and
        // the flat shape accepts either, so the two transports need no arm here.
        config: serde_json::from_value(config.clone()).ok()?,
    })
}

/// A trimmed non-empty string, or `None`.
fn text(row: &Value, key: &str) -> Option<String> {
    let value = row.get(key).and_then(Value::as_str)?.trim();
    (!value.is_empty()).then(|| value.to_string())
}
