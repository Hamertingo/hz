//! The plugin proxy: the one MCP server an agent talks to for each plugin it holds.
//!
//! Served on the team's loopback port at `/mcp/<agent>/plugin/<plugin>`. The agent
//! is never handed the real server, so it never sees a token, and every call passes
//! through [`gate`] first — which is what makes a grant, a revoked grant and a
//! tool's Allow / Ask / Off *enforced* rather than advisory:
//!
//! - `tools/list` returns the server's tools minus the ones switched off;
//! - a call to a tool that is off, or from an agent that no longer holds the
//!   plugin, is refused here whatever the agent's session was started with;
//! - a call to a tool set to Ask becomes an Inbox question and waits for the answer.
//!
//! One upstream connection per plugin is kept and shared by every agent that holds
//! it. Each call is written to the workspace's call log with the time it took.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::Instant;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::mcp_client::{Client, RemoteTool, Unauthorized};
use crate::plugin_store::{self, CallRecord, Plugin, Policy, Status};
use crate::{agents, inbox};

static POOL: LazyLock<Mutex<HashMap<String, Arc<Client>>>> = LazyLock::new(Default::default);

fn key(ws: &str, id: &str) -> String {
    format!("{ws}/{id}")
}

/// Drops the open connection to a plugin, so the next call opens a fresh one with
/// whatever credentials are stored by then.
pub async fn forget(ws: &str, id: &str) {
    POOL.lock().await.remove(&key(ws, id));
}

async fn upstream(ws: &str, plugin: &Plugin) -> Result<Arc<Client>> {
    let k = key(ws, &plugin.id);
    if let Some(c) = POOL.lock().await.get(&k) {
        return Ok(c.clone());
    }
    // Connected outside the lock: a slow `npx` start must not hold up every other plugin.
    let client = Arc::new(plugin_store::open_client(ws, plugin).await?);
    POOL.lock().await.insert(k, client.clone());
    Ok(client)
}

/// What to do with one call.
#[derive(Debug, PartialEq, Eq)]
pub enum Gate {
    Run,
    /// Wait for the reader's answer first.
    Ask,
    /// Turn it away: the outcome for the log and the words for the agent.
    Refuse(&'static str, String),
}

/// Decides a call from the plugin's stored state alone.
pub fn gate(plugin: Option<&Plugin>, agent_id: &str, tool: &str) -> Gate {
    let Some(plugin) = plugin else {
        return Gate::Refuse("revoked", "This plugin is no longer connected.".into());
    };
    if !plugin.grants.iter().any(|g| g == agent_id) {
        return Gate::Refuse("revoked", format!("You no longer have {}; the person took it away.", plugin.name));
    }
    if plugin.status != Status::Connected {
        return Gate::Refuse("error", format!("{} needs the person to sign in to it again.", plugin.name));
    }
    match plugin_store::policy_of(plugin, tool) {
        Policy::Off => Gate::Refuse("off", format!("{tool} is switched off for {}.", plugin.name)),
        Policy::Ask => Gate::Ask,
        Policy::Allow => Gate::Run,
    }
}

fn reply(id: &Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn tool_error(text: &str) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": true})
}

fn tool_json(t: &RemoteTool) -> Value {
    json!({
        "name": t.name,
        "description": t.description.clone().unwrap_or_default(),
        "inputSchema": t.input_schema.clone().unwrap_or_else(|| json!({"type": "object"})),
    })
}

/// Answers one JSON-RPC message from an agent. `None` means a notification, which
/// has no answer. `app` is `None` only in tests, where nobody can be asked.
pub async fn handle(agent_id: &str, plugin_id: &str, message: &Value, app: Option<&AppHandle>) -> Option<Value> {
    let method = message["method"].as_str()?;
    let id = message.get("id").cloned()?;

    let Some(agent) = agents::by_id(agent_id) else {
        return Some(rpc_error(&id, -32000, "unknown agent"));
    };
    let ws = agent.workspace_id.clone().unwrap_or_default();
    let plugin = plugin_store::plugin_in(&ws, plugin_id);

    Some(match method {
        "initialize" => reply(
            &id,
            json!({
                "protocolVersion": message["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
                "capabilities": {"tools": {"listChanged": false}},
                "serverInfo": {"name": plugin.as_ref().map_or("plugin", |p| p.name.as_str()), "version": "1"},
            }),
        ),
        "ping" => reply(&id, json!({})),
        "tools/list" => reply(&id, json!({"tools": list(&ws, agent_id, plugin).await})),
        "tools/call" => {
            let name = message["params"]["name"].as_str().unwrap_or_default().to_string();
            let args = message["params"]["arguments"].clone();
            reply(&id, call(app, &ws, &agent, plugin, &name, args).await)
        }
        _ => rpc_error(&id, -32601, "method not found"),
    })
}

async fn list(ws: &str, agent_id: &str, plugin: Option<Plugin>) -> Vec<Value> {
    // Not granted, or signed out: the agent sees a server with nothing on it,
    // which is also what a session started before the grant was taken away sees.
    let Some(plugin) = plugin.filter(|p| p.status == Status::Connected && p.grants.iter().any(|g| g == agent_id)) else {
        return Vec::new();
    };
    let listed = match upstream(ws, &plugin).await {
        Ok(c) => c.list_tools().await,
        Err(e) => Err(e),
    };
    match listed {
        Ok(remote) => {
            // A tool the server added since the reader last looked appears in the
            // plugin's sheet with its default policy.
            plugin_store::remember_tools(ws, &plugin.id, &remote);
            let current = plugin_store::plugin_in(ws, &plugin.id).unwrap_or(plugin);
            plugin_store::visible_tools(&current, remote).iter().map(tool_json).collect()
        }
        Err(e) => {
            forget(ws, &plugin.id).await;
            if e.downcast_ref::<Unauthorized>().is_some() {
                plugin_store::set_status(ws, &plugin.id, Status::Not, Some("The server refused the credentials. Reconnect it.".into()));
            }
            eprintln!("[plugin err] {}: {e:#}", plugin.name);
            Vec::new()
        }
    }
}

async fn call(app: Option<&AppHandle>, ws: &str, agent: &agents::AgentRecord, plugin: Option<Plugin>, tool: &str, args: Value) -> Value {
    let plugin_id = plugin.as_ref().map(|p| p.id.clone()).unwrap_or_default();
    let log = |outcome: &str, ok: bool, ms: u64| {
        let _ = plugin_store::record_call(
            ws,
            &CallRecord { t: now_ms(), plugin: plugin_id.clone(), agent: agent.id.clone(), tool: tool.to_string(), ms, ok, outcome: outcome.to_string() },
        );
        if let Some(app) = app {
            plugin_store::notify_changed(app);
        }
    };

    let mut outcome = "allowed";
    match gate(plugin.as_ref(), &agent.id, tool) {
        Gate::Refuse(why, message) => {
            log(why, false, 0);
            return tool_error(&message);
        }
        Gate::Ask => {
            let name = plugin.as_ref().map_or("a plugin", |p| p.name.as_str());
            let preview: String = args.to_string().chars().take(300).collect();
            let question = format!("{} wants to use {tool} on {name}\n{preview}", agent.name);
            // No window to ask in is a no: an unattended call is never waved through.
            let answer = match app {
                Some(app) => inbox::ask_user(app, agent, &question, vec!["Allow".into(), "Deny".into()]).await.unwrap_or_default(),
                None => String::new(),
            };
            if !answer.trim().to_ascii_lowercase().starts_with("allow") {
                log("denied", false, 0);
                return tool_error("The person said no to this call.");
            }
            outcome = "approved";
        }
        Gate::Run => {}
    }
    let plugin = plugin.expect("a gated-through call has a plugin");

    let started = Instant::now();
    let result = async {
        let client = upstream(ws, &plugin).await?;
        client.call_tool(tool, args).await.map_err(|e| anyhow!("{e:#}"))
    }
    .await;
    let ms = started.elapsed().as_millis() as u64;
    match result {
        Ok(value) => {
            let ok = value["isError"].as_bool() != Some(true);
            log(outcome, ok, ms);
            // A connector's answer is outside text: the agent reads it as data, never as orders.
            crate::safety_tools::wrap_result(value, &plugin.name)
        }
        Err(e) => {
            // The connection may be the thing that broke; the next call opens a new one.
            forget(ws, &plugin.id).await;
            log("error", false, ms);
            tool_error(&format!("{} failed: {e:#}", plugin.name))
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_store::{AuthKind, PluginKind, ToolPolicy, Transport};

    fn plugin(grants: &[&str], tools: &[(&str, Policy)]) -> Plugin {
        Plugin {
            id: "github".into(),
            kind: PluginKind::Catalog,
            slug: None,
            name: "GitHub".into(),
            description: String::new(),
            category: "Code".into(),
            transport: Transport::Http { url: "https://x".into(), header_keys: vec![] },
            auth: AuthKind::Token,
            token_target: None,
            status: Status::Connected,
            tools: tools.iter().map(|(n, p)| ToolPolicy { name: (*n).into(), description: None, policy: *p }).collect(),
            grants: grants.iter().map(|g| (*g).to_string()).collect(),
            connected_at: None,
            account: None,
            color: String::new(),
            mark: String::new(),
            error: None,
        }
    }

    #[test]
    fn the_gate_enforces_grants_and_policies() {
        let p = plugin(&["ada"], &[("list", Policy::Allow), ("merge", Policy::Ask), ("delete", Policy::Off)]);
        assert_eq!(gate(Some(&p), "ada", "list"), Gate::Run);
        assert_eq!(gate(Some(&p), "ada", "merge"), Gate::Ask);
        assert!(matches!(gate(Some(&p), "ada", "delete"), Gate::Refuse("off", _)));
        assert!(matches!(gate(Some(&p), "leo", "list"), Gate::Refuse("revoked", _)), "an agent without the grant is refused");
        assert!(matches!(gate(None, "ada", "list"), Gate::Refuse("revoked", _)), "a disconnected plugin is refused");
        // A tool the server added after the reader last looked is judged by name.
        assert_eq!(gate(Some(&p), "ada", "get_new"), Gate::Run);
        assert_eq!(gate(Some(&p), "ada", "post_new"), Gate::Ask);

        let mut out = p.clone();
        out.status = Status::Not;
        assert!(matches!(gate(Some(&out), "ada", "list"), Gate::Refuse("error", _)));
    }

    #[test]
    fn the_messages_an_agent_reads_are_well_formed() {
        let e = tool_error("no");
        assert_eq!(e["isError"], true);
        assert_eq!(e["content"][0]["text"], "no");
        let t = tool_json(&RemoteTool { name: "x".into(), description: None, input_schema: None });
        assert_eq!(t["inputSchema"]["type"], "object");
        assert_eq!(rpc_error(&json!(3), -32601, "m")["error"]["code"], -32601);
    }

    /// The whole proxy against a real MCP server and a real roster and store on
    /// disk. Run by hand with a throwaway home, since it writes `~/.hz`:
    /// `HOME=$(mktemp -d) target/debug/deps/hz_lib-… proxy_end_to_end --ignored`.
    #[tokio::test]
    #[ignore]
    async fn proxy_end_to_end_against_server_everything() {
        let home = std::env::home_dir().unwrap();
        assert!(home.starts_with(std::env::temp_dir()) || home.to_string_lossy().contains("tmp"), "run with a throwaway HOME");
        agents::agents_sync(vec![json!({"id": "ada", "name": "Ada", "workspaceId": "ws1"})]).await;

        let snap = |tool: &str, policy: Policy| ToolPolicy { name: tool.into(), description: None, policy };
        let stored = Plugin {
            id: "mcp-1".into(),
            kind: PluginKind::Custom,
            transport: Transport::Stdio {
                command: "npx".into(),
                args: vec!["-y".into(), "@modelcontextprotocol/server-everything".into()],
                env_keys: vec![],
            },
            auth: AuthKind::None,
            tools: vec![snap("echo", Policy::Allow), snap("get-sum", Policy::Off)],
            grants: vec!["ada".into()],
            ..plugin(&["ada"], &[])
        };
        let dir = home.join(".hz/workspaces/ws1");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("plugins.json"), serde_json::to_vec(&json!({"plugins": [stored], "skills": []})).unwrap()).unwrap();

        let rpc = |id: u64, method: &str, params: Value| json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let go = |m: Value| async move { handle("ada", "mcp-1", &m, None).await.unwrap() };

        let init = go(rpc(1, "initialize", json!({"protocolVersion": "2025-06-18"}))).await;
        assert!(init["result"]["capabilities"]["tools"].is_object());

        let listed = go(rpc(2, "tools/list", json!({}))).await;
        let names: Vec<&str> = listed["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"echo"), "{names:?}");
        assert!(!names.contains(&"get-sum"), "a tool that is off is not offered");

        let said = go(rpc(3, "tools/call", json!({"name": "echo", "arguments": {"message": "hi from ada"}}))).await;
        assert!(said["result"].to_string().contains("hi from ada"), "{said}");

        let off = go(rpc(4, "tools/call", json!({"name": "get-sum", "arguments": {"a": 1, "b": 2}}))).await;
        assert_eq!(off["result"]["isError"], true);

        // A tool the reader never judged is "ask", and nobody is there to answer.
        let ask = go(rpc(5, "tools/call", json!({"name": "trigger-long-running-operation", "arguments": {}}))).await;
        assert_eq!(ask["result"]["isError"], true);

        plugin_store::update_grants_for_test("ws1", "mcp-1", &[]);
        let revoked = go(rpc(6, "tools/list", json!({}))).await;
        assert_eq!(revoked["result"]["tools"].as_array().unwrap().len(), 0);
        let after = go(rpc(7, "tools/call", json!({"name": "echo", "arguments": {"message": "x"}}))).await;
        assert_eq!(after["result"]["isError"], true, "a revoked grant stops a live session");

        let log = std::fs::read_to_string(dir.join("plugin-calls.jsonl")).unwrap();
        let outcomes: Vec<String> = log.lines().map(|l| serde_json::from_str::<Value>(l).unwrap()["outcome"].as_str().unwrap().to_string()).collect();
        assert_eq!(outcomes, ["allowed", "off", "denied", "revoked"]);
    }
}
