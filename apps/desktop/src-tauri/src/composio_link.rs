//! Composio from one pasted key. The key opens a tool-router session, and that session's MCP
//! endpoint is saved as a plugin of the workspace, so grants, Allow / Ask / Off and the call log
//! come from the plugin store and the agent never holds the key (the proxy adds it).
//!
//! An app is connected through a link card: `connect_app` asks Composio for the app's sign-in
//! link and hands the agent an `hz-card` to show; `wait_for_app` waits until the person finishes.
//! Both are served at `/mcp/<agent>/apps` (see `kit_mcp`) to agents that hold the Composio plugin.

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::agentkit::composio::{self, ApiKey, ComposioSession, ReqwestPoller, Schedule, TokioSleeper};
use crate::integrations::{self, COMPOSIO_KEY};
use crate::{keychain, plugin_store};

const HEADER: &str = "x-api-key";
/// Where the browser lands once the person approved the app.
const DONE_URL: &str = "https://composio.dev/";

fn key() -> Result<ApiKey> {
    ApiKey::new(&keychain::get(COMPOSIO_KEY)?.context("Composio is not connected; the person adds its key in Settings → Privacy")?)
}

async fn open_session(key: &ApiKey, user_id: &str) -> Result<ComposioSession> {
    let resp = reqwest::Client::new()
        .post(composio::session_url())
        .header(HEADER, key.expose())
        .json(&composio::session_request_body(user_id))
        .send()
        .await
        .context("could not reach Composio")?;
    composio::parse_session(&resp.text().await.unwrap_or_default())
}

/// Saves the key, opens a session and adds it to the workspace as a plugin nobody holds yet.
#[tauri::command]
pub async fn composio_connect(app: AppHandle, workspace_id: String, key: String) -> Result<(), String> {
    connect(&app, &workspace_id, &key).await.map_err(|e| format!("{e:#}"))
}

async fn connect(app: &AppHandle, ws: &str, raw: &str) -> Result<()> {
    let key = ApiKey::new(raw)?;
    let user = integrations::load().composio.user_id.unwrap_or_else(|| format!("hz-{}", uuid::Uuid::new_v4().simple()));
    let session = open_session(&key, &user).await?;
    keychain::set(COMPOSIO_KEY, key.expose())?;
    let snap = plugin_store::plugin_add_custom(
        app.clone(),
        ws.to_string(),
        plugin_store::CustomInput {
            name: "Composio".into(),
            transport: "http".into(),
            target: session.mcp_url.clone(),
            env: vec![plugin_store::EnvVar { key: HEADER.into(), value: key.expose().into() }],
        },
    )
    .await
    .map_err(|e| anyhow!(e))?;
    let plugin = snap
        .plugins
        .iter()
        .find(|p| matches!(&p.transport, plugin_store::Transport::Http { url, .. } if *url == session.mcp_url))
        .map(|p| p.id.clone())
        .context("the Composio server was not saved")?;
    integrations::update(|v| {
        v.composio.user_id = Some(user.clone());
        v.composio.session_id = Some(session.id.clone());
        v.composio.mcp_url = Some(session.mcp_url.clone());
        v.composio.plugins.retain(|(w, _)| w != ws);
        v.composio.plugins.push((ws.to_string(), plugin));
    })?;
    Ok(())
}

/// Forgets the key and takes the Composio plugin out of every workspace it was added to.
#[tauri::command]
pub async fn composio_disconnect(app: AppHandle) -> Result<(), String> {
    let plugins = integrations::load().composio.plugins;
    for (ws, id) in plugins {
        let _ = plugin_store::plugin_disconnect(app.clone(), ws, id).await;
    }
    keychain::delete(COMPOSIO_KEY).map_err(|e| format!("{e:#}"))?;
    integrations::update(|v| {
        let user = v.composio.user_id.take();
        v.composio = Default::default();
        v.composio.user_id = user;
    })
    .map_err(|e| format!("{e:#}"))
}

/// Whether this agent holds the Composio plugin of its workspace.
pub fn granted(agent_id: &str) -> bool {
    let Some(ws) = crate::agents::by_id(agent_id).and_then(|a| a.workspace_id) else { return false };
    integrations::load()
        .composio
        .plugins
        .iter()
        .filter(|(w, _)| *w == ws)
        .filter_map(|(w, id)| plugin_store::plugin_in(w, id))
        .any(|p| p.grants.iter().any(|g| g == agent_id))
}

pub fn tools() -> Value {
    json!([
        {
            "name": "connect_app",
            "description": "Get a sign-in link for an app the person wants you to use through Composio (github, gmail, \
                            slack, notion, linear, hubspot, ...). Returns a card: put it in your reply exactly as given \
                            so the person sees a Connect button, then call wait_for_app.",
            "inputSchema": {"type": "object", "properties": {"app": {"type": "string", "description": "The app's slug, such as github."}}, "required": ["app"], "additionalProperties": false},
        },
        {
            "name": "wait_for_app",
            "description": "Wait until the person has finished connecting an app from its card, up to about six minutes. \
                            When it returns connected, the app's tools work through the Composio server.",
            "inputSchema": {"type": "object", "properties": {"app": {"type": "string"}}, "required": ["app"], "additionalProperties": false},
        },
    ])
}

/// The card block the agent pastes into its reply.
pub fn card_block(app: &str, url: &str) -> String {
    let c = composio::connect_card(app, url);
    let card = json!({"type": "connect", "app": c.app, "title": c.title, "url": c.url});
    format!("```hz-card\n{card}\n```")
}

pub async fn call(name: &str, args: &Value) -> Result<String> {
    let app = args.get("app").and_then(Value::as_str).map(str::trim).filter(|a| !a.is_empty()).context("`app` is required")?;
    let session = integrations::load().composio.session_id.context("Composio is not connected")?;
    let key = key()?;
    match name {
        "connect_app" => {
            let resp = reqwest::Client::new()
                .post(composio::link_url(&session))
                .header(HEADER, key.expose())
                .json(&composio::link_request_body(app, &composio::callback_url(DONE_URL, app)?))
                .send()
                .await
                .context("could not reach Composio")?;
            let link = composio::parse_connect_link(app, &resp.text().await.unwrap_or_default())?;
            Ok(format!(
                "Put this card in your reply as it is:\n\n{}\n\nThen call wait_for_app with app \"{}\".",
                card_block(&link.app, &link.url),
                link.app
            ))
        }
        "wait_for_app" => {
            let poller = ReqwestPoller { client: reqwest::Client::new(), key, session_id: session };
            composio::wait_for_connection(&poller, &TokioSleeper, app, Schedule::default()).await?;
            Ok(format!("{} is connected.", composio::app_label(app)))
        }
        _ => bail!("no tool {name}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_card_is_a_fenced_connect_block() {
        let b = card_block("github", "https://connect.example/x");
        assert!(b.starts_with("```hz-card\n") && b.ends_with("\n```"));
        let v: Value = serde_json::from_str(b.lines().nth(1).unwrap()).unwrap();
        assert_eq!(v["type"], "connect");
        assert_eq!(v["title"], "Connect GitHub");
        assert_eq!(v["url"], "https://connect.example/x");
    }

    #[test]
    fn two_tools_and_nobody_granted_without_a_workspace() {
        assert_eq!(tools().as_array().unwrap().len(), 2);
        assert!(!granted("nobody"));
    }

    #[tokio::test]
    async fn calls_need_an_app_and_a_session() {
        assert!(call("connect_app", &json!({})).await.unwrap_err().to_string().contains("`app`"));
        assert!(call("connect_app", &json!({"app": "github"})).await.unwrap_err().to_string().contains("not connected"));
    }
}
