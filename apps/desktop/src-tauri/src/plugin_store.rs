//! Plugins and Skills of a workspace: what the Plugins page reads and writes, and
//! what a session is started with.
//!
//! **A plugin is an MCP server a workspace has connected**, with a policy for each
//! of its tools and a list of the agents allowed to use it. Those two decide
//! everything an agent gets: [`servers_for_agent`] turns the grants into the
//! `mcpServers` of its next session, and [`crate::plugin_proxy`] applies the
//! policies to every call. **Nothing secret is in `plugins.json`.** Tokens,
//! environment values and header values are one Keychain item per plugin
//! ([`Secret`]); the file holds only their names.
//!
//! Skills are plain `SKILL.md` files under `~/.hz/workspaces/<id>/skills/<slug>/`,
//! so an agent can read them with its own file tools. The grants that say which
//! agents are told about them live beside the plugins.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;
use ts_rs::TS;

use crate::mcp_client::{Client, RemoteTool, Spec, Unauthorized};
use crate::plugin_oauth::{self, OwnClient, Tokens};
use crate::{keychain, plugin_proxy};

/// What an agent may do with one tool.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "lowercase")]
pub enum Policy {
    Allow,
    /// The call waits for the reader's answer in the Inbox.
    Ask,
    /// The tool is not offered to the agent at all.
    Off,
}

/// Whether a plugin came from the catalog or was typed in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "lowercase")]
pub enum PluginKind {
    Catalog,
    Custom,
}

/// How a plugin proves who is calling.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum AuthKind {
    None,
    /// Browser sign-in; the server registers hz as a client by itself.
    Oauth,
    /// Browser sign-in with a client ID the reader brought.
    OauthOwn,
    /// A secret the reader pasted.
    Token,
}

/// Connected, or in need of signing in again.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Connected,
    /// The server refused the stored credentials. Grants and policies are kept.
    Not,
}

/// How hz reaches the server. Values of `env` and headers are in the Keychain;
/// only their names are here.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Transport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default, rename = "envKeys")]
        env_keys: Vec<String>,
    },
    Http {
        url: String,
        #[serde(default, rename = "headerKeys")]
        header_keys: Vec<String>,
    },
}

/// One tool and the policy it is under.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ToolPolicy {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub policy: Policy,
}

/// One MCP server of a workspace.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub id: String,
    pub kind: PluginKind,
    /// The brand mark's name, for a catalog entry that has one.
    #[serde(default)]
    pub slug: Option<String>,
    pub name: String,
    pub description: String,
    pub category: String,
    pub transport: Transport,
    pub auth: AuthKind,
    /// For a pasted secret: `bearer` goes in the Authorization header, `arg`
    /// is appended to the command line.
    #[serde(default)]
    pub token_target: Option<String>,
    pub status: Status,
    pub tools: Vec<ToolPolicy>,
    /// Agent ids allowed to use it.
    #[serde(default)]
    pub grants: Vec<String>,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub connected_at: Option<u64>,
    /// Who it is signed in as, when the server says; otherwise what kind of
    /// credential it holds.
    #[serde(default)]
    pub account: Option<String>,
    /// The banner colour and the initials a plugin without a brand mark wears.
    pub color: String,
    pub mark: String,
    /// The last failure to reach it, cleared on the next success.
    #[serde(default)]
    pub error: Option<String>,
}

/// A Skill's record. Its text is the file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct SkillMeta {
    slug: String,
    name: String,
    /// An agent id, or `me`.
    by: String,
    #[serde(default)]
    grants: Vec<String>,
}

/// A Skill as the page draws it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub slug: String,
    pub name: String,
    pub by: String,
    pub grants: Vec<String>,
    pub md: String,
    /// Where `SKILL.md` is on disk, which is also what an agent is told.
    pub path: String,
}

/// What the Skill editor writes.
#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SkillInput {
    /// Absent for a new Skill.
    #[serde(default)]
    #[ts(optional)]
    pub slug: Option<String>,
    pub name: String,
    pub md: String,
    pub grants: Vec<String>,
}

/// One tool call that went through the proxy.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct CallRecord {
    #[ts(type = "number")]
    pub t: u64,
    pub plugin: String,
    pub agent: String,
    pub tool: String,
    #[ts(type = "number")]
    pub ms: u64,
    pub ok: bool,
    /// `allowed`, `approved`, `denied`, `off`, `revoked` or `error`.
    pub outcome: String,
}

/// A catalog entry's way in.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CatalogTransport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
    },
    Http {
        url: String,
    },
}

/// What signing in to a catalog entry takes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
pub struct CatalogAuth {
    pub kind: AuthKind,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub scopes: Vec<String>,
}

/// One server hz knows how to connect, from `plugin_catalog.json`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
pub struct CatalogEntry {
    pub id: String,
    pub slug: Option<String>,
    pub name: String,
    pub category: String,
    pub color: String,
    pub mark: String,
    pub description: String,
    pub transport: CatalogTransport,
    pub auth: CatalogAuth,
    /// `end_to_end`, or `own_client` when the reader must bring an OAuth client.
    pub support: String,
    pub note: String,
    /// Tool names known without signing in; empty when only the server can say.
    #[serde(default)]
    pub tools: Vec<String>,
}

/// Everything the page draws, in one read.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PluginSnapshot {
    pub plugins: Vec<Plugin>,
    pub skills: Vec<Skill>,
    pub catalog: Vec<CatalogEntry>,
    /// The last two weeks of calls, oldest first.
    pub calls: Vec<CallRecord>,
}

/// What a connection test found.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PluginTest {
    pub ok: bool,
    pub tools: Vec<RemoteTool>,
    pub error: Option<String>,
    #[ts(type = "number")]
    pub ms: u64,
}

/// What the Add dialog writes down.
#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct CustomInput {
    pub name: String,
    /// `stdio` or `http`.
    pub transport: String,
    /// The command line for `stdio`, the URL for `http`.
    pub target: String,
    /// Environment variables for a command, headers for a URL.
    pub env: Vec<EnvVar>,
}

/// One name and value.
#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

/// What a sign-in may need from the reader.
#[derive(Clone, Debug, Default, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ConnectCreds {
    #[serde(default)]
    #[ts(optional)]
    pub token: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub client_id: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub client_secret: Option<String>,
}

/// The secret half of a plugin, one Keychain item.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Secret {
    #[serde(default)]
    env: BTreeMap<String, String>,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    oauth: Option<Tokens>,
}

#[derive(Default, Serialize, Deserialize)]
struct Data {
    #[serde(default)]
    plugins: Vec<Plugin>,
    #[serde(default)]
    skills: Vec<SkillMeta>,
}

static LOCK: StdMutex<()> = StdMutex::new(());

const CATALOG_JSON: &str = include_str!("plugin_catalog.json");

/// The catalog this build ships.
pub fn catalog() -> Vec<CatalogEntry> {
    serde_json::from_str(CATALOG_JSON).expect("plugin_catalog.json is valid")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// `~/.hz`. Not created here: every write creates what it needs.
fn home() -> Result<PathBuf> {
    Ok(std::env::home_dir().context("could not resolve home directory")?.join(".hz"))
}

fn valid_id(id: &str) -> Result<()> {
    if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(())
    } else {
        bail!("not a valid id")
    }
}

fn ws_dir(home: &Path, ws: &str) -> Result<PathBuf> {
    valid_id(ws)?;
    Ok(home.join("workspaces").join(ws))
}

fn read_data(home: &Path, ws: &str) -> Result<Data> {
    let path = ws_dir(home, ws)?.join("plugins.json");
    match std::fs::read_to_string(&path) {
        Ok(text) if !text.trim().is_empty() => {
            serde_json::from_str(&text).with_context(|| format!("could not parse {}", path.display()))
        }
        Ok(_) => Ok(Data::default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Data::default()),
        Err(e) => Err(e).with_context(|| format!("could not open {}", path.display())),
    }
}

fn write_data(home: &Path, ws: &str, data: &Data) -> Result<()> {
    let dir = ws_dir(home, ws)?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("plugins.json");
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(data)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Reads, changes and writes a workspace's plugins as one step, so two writers
/// cannot lose each other's change.
fn update<R>(home: &Path, ws: &str, change: impl FnOnce(&mut Data) -> Result<R>) -> Result<R> {
    let _guard = LOCK.lock().expect("plugin store poisoned");
    let mut data = read_data(home, ws)?;
    let out = change(&mut data)?;
    write_data(home, ws, &data)?;
    Ok(out)
}

fn secret_account(ws: &str, id: &str) -> String {
    format!("plugin:{ws}:{id}")
}

fn read_secret(ws: &str, id: &str) -> Result<Secret> {
    match keychain::get(&secret_account(ws, id))? {
        Some(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        None => Ok(Secret::default()),
    }
}

fn write_secret(ws: &str, id: &str, secret: &Secret) -> Result<()> {
    keychain::set(&secret_account(ws, id), &serde_json::to_string(secret)?)
}

/// The policy a tool starts under: reading is allowed, everything else asks.
///
/// Judged from the name alone, which is a guess; the reader sees every default in
/// the Connect flow and can change it before any agent has the plugin.
pub fn default_policy(tool: &str) -> Policy {
    const READ: [&str; 12] =
        ["list", "get", "search", "read", "find", "query", "fetch", "describe", "view", "show", "select", "suggest"];
    let lower = tool.to_ascii_lowercase();
    let head = lower.split(['_', '-', '.', '/']).next().unwrap_or_default();
    if READ.contains(&head) {
        Policy::Allow
    } else {
        Policy::Ask
    }
}

/// The server's tools with the policies already chosen kept, and a default for
/// each new one. A tool the server no longer has is dropped.
pub fn merge_tools(existing: &[ToolPolicy], remote: &[RemoteTool]) -> Vec<ToolPolicy> {
    remote
        .iter()
        .map(|t| ToolPolicy {
            name: t.name.clone(),
            description: t.description.clone(),
            policy: existing.iter().find(|e| e.name == t.name).map_or_else(|| default_policy(&t.name), |e| e.policy),
        })
        .collect()
}

/// The policy one tool is under. A tool the plugin has not recorded yet is
/// judged as a new one would be.
pub fn policy_of(plugin: &Plugin, tool: &str) -> Policy {
    plugin.tools.iter().find(|t| t.name == tool).map_or_else(|| default_policy(tool), |t| t.policy)
}

/// What an agent is shown of the server's tools: everything not switched off.
pub fn visible_tools(plugin: &Plugin, remote: Vec<RemoteTool>) -> Vec<RemoteTool> {
    remote.into_iter().filter(|t| policy_of(plugin, &t.name) != Policy::Off).collect()
}

/// The name an agent sees the server under. Kept clear of hz's own `team` and
/// `memory`, which an agent already has.
pub fn server_name(plugin: &Plugin) -> String {
    let slug = slugify(&plugin.name);
    if matches!(slug.as_str(), "team" | "memory") {
        format!("{slug}-plugin")
    } else {
        slug
    }
}

/// Lower-case letters, digits and single dashes.
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "plugin".into()
    } else {
        out
    }
}

/// Splits a command line the way a shell would for the simple cases: spaces
/// separate words, quotes group them.
pub fn split_command(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for c in line.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                started = true;
            }
            (None, c) if c.is_whitespace() => {
                if started || !cur.is_empty() {
                    words.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if started || !cur.is_empty() {
        words.push(cur);
    }
    words
}

/// The `mcpServers` entries a session of `agent_id` is started with for the
/// plugins it holds: one loopback entry per granted, connected plugin, pointing at
/// hz's own proxy so the agent never sees a token and every call meets its policy.
pub fn build_servers(plugins: &[Plugin], agent_id: &str, port: u16) -> Vec<Value> {
    plugins
        .iter()
        .filter(|p| p.status == Status::Connected && p.grants.iter().any(|g| g == agent_id))
        // A plugin with every tool off offers nothing; leaving it out keeps the
        // agent from hearing about a server it can use none of.
        .filter(|p| p.tools.is_empty() || p.tools.iter().any(|t| t.policy != Policy::Off))
        .map(|p| {
            json!({
                "type": "http",
                "name": server_name(p),
                "url": format!("http://127.0.0.1:{port}/mcp/{agent_id}/plugin/{}", p.id),
                "headers": [],
            })
        })
        .collect()
}

/// The plugin servers for an agent's next session, read from disk. Empty while the
/// proxy is not up or the agent belongs to no workspace.
pub fn servers_for_agent(agent_id: &str) -> Vec<Value> {
    let Some(port) = crate::team::port() else { return Vec::new() };
    let Some(ws) = crate::agents::by_id(agent_id).and_then(|a| a.workspace_id) else { return Vec::new() };
    let Ok(home) = home() else { return Vec::new() };
    match read_data(&home, &ws) {
        Ok(data) => build_servers(&data.plugins, agent_id, port),
        Err(_) => Vec::new(),
    }
}

fn skill_path(home: &Path, ws: &str, slug: &str) -> Result<PathBuf> {
    Ok(ws_dir(home, ws)?.join("skills").join(slug).join("SKILL.md"))
}

/// The Skills an agent is told about: name and the path of `SKILL.md`.
pub fn skills_for_agent(agent_id: &str) -> Vec<(String, String)> {
    let Some(ws) = crate::agents::by_id(agent_id).and_then(|a| a.workspace_id) else { return Vec::new() };
    let Ok(home) = home() else { return Vec::new() };
    skill_refs(&home, &ws, agent_id)
}

fn skill_refs(home: &Path, ws: &str, agent_id: &str) -> Vec<(String, String)> {
    let Ok(data) = read_data(home, ws) else { return Vec::new() };
    data.skills
        .iter()
        .filter(|s| s.grants.iter().any(|g| g == agent_id))
        .filter_map(|s| skill_path(home, ws, &s.slug).ok().map(|p| (s.name.clone(), p.display().to_string())))
        .collect()
}

fn skills_of(home: &Path, ws: &str, data: &Data) -> Vec<Skill> {
    data.skills
        .iter()
        .filter_map(|m| {
            let path = skill_path(home, ws, &m.slug).ok()?;
            Some(Skill {
                slug: m.slug.clone(),
                name: m.name.clone(),
                by: m.by.clone(),
                grants: m.grants.clone(),
                md: std::fs::read_to_string(&path).unwrap_or_default(),
                path: path.display().to_string(),
            })
        })
        .collect()
}

const TWO_WEEKS_MS: u64 = 14 * 24 * 3600 * 1000;
const CALL_LOG_KEEP: usize = 5000;

fn calls_path(home: &Path, ws: &str) -> Result<PathBuf> {
    Ok(ws_dir(home, ws)?.join("plugin-calls.jsonl"))
}

/// Appends one call to the workspace's log, trimming it when it has grown large.
pub fn record_call(ws: &str, record: &CallRecord) -> Result<()> {
    append_call(&home()?, ws, record)
}

fn append_call(home: &Path, ws: &str, record: &CallRecord) -> Result<()> {
    use std::io::Write;
    let path = calls_path(home, ws)?;
    std::fs::create_dir_all(path.parent().context("no parent")?)?;
    let _guard = LOCK.lock().expect("plugin store poisoned");
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(file, "{}", serde_json::to_string(record)?)?;
    drop(file);
    if std::fs::metadata(&path).map_or(0, |m| m.len()) > 2 * 1024 * 1024 {
        let text = std::fs::read_to_string(&path)?;
        let lines: Vec<&str> = text.lines().collect();
        let keep = lines[lines.len().saturating_sub(CALL_LOG_KEEP)..].join("\n");
        std::fs::write(&path, format!("{keep}\n"))?;
    }
    Ok(())
}

/// Calls in the last two weeks, oldest first.
fn recent_calls(home: &Path, ws: &str, now: u64) -> Vec<CallRecord> {
    let Ok(path) = calls_path(home, ws) else { return Vec::new() };
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    let mut calls: Vec<CallRecord> = text
        .lines()
        .filter_map(|l| serde_json::from_str::<CallRecord>(l).ok())
        .filter(|c| c.t + TWO_WEEKS_MS >= now)
        .collect();
    let extra = calls.len().saturating_sub(CALL_LOG_KEEP);
    calls.drain(..extra);
    calls
}

fn snapshot(home: &Path, ws: &str) -> Result<PluginSnapshot> {
    let data = read_data(home, ws)?;
    Ok(PluginSnapshot {
        skills: skills_of(home, ws, &data),
        plugins: data.plugins,
        catalog: catalog(),
        calls: recent_calls(home, ws, now_ms()),
    })
}

fn changed(app: &AppHandle) {
    let _ = app.emit("plugins_changed", ());
}

/// Tells the page something changed; called by the proxy after each call.
pub fn notify_changed(app: &AppHandle) {
    changed(app);
}

fn find<'a>(data: &'a mut Data, id: &str) -> Result<&'a mut Plugin> {
    data.plugins.iter_mut().find(|p| p.id == id).ok_or_else(|| anyhow!("that plugin is gone"))
}

/// Replaces a plugin's grants, for the proxy's end-to-end test.
#[cfg(test)]
pub fn update_grants_for_test(ws: &str, id: &str, grants: &[&str]) {
    let home = home().unwrap();
    update(&home, ws, |d| {
        find(d, id)?.grants = grants.iter().map(|g| (*g).to_string()).collect();
        Ok(())
    })
    .unwrap();
}

/// The plugin with this id in a workspace, if it exists.
pub fn plugin_in(ws: &str, id: &str) -> Option<Plugin> {
    let home = home().ok()?;
    read_data(&home, ws).ok()?.plugins.into_iter().find(|p| p.id == id)
}

/// Records a plugin's tools as the server reported them, keeping chosen policies.
pub fn remember_tools(ws: &str, id: &str, remote: &[RemoteTool]) {
    let Ok(home) = home() else { return };
    let _ = update(&home, ws, |d| {
        let p = find(d, id)?;
        let merged = merge_tools(&p.tools, remote);
        if merged != p.tools {
            p.tools = merged;
        }
        Ok(())
    });
}

/// Marks a plugin as needing a new sign-in, or as fine again.
pub fn set_status(ws: &str, id: &str, status: Status, error: Option<String>) {
    let Ok(home) = home() else { return };
    let _ = update(&home, ws, |d| {
        let p = find(d, id)?;
        p.status = status;
        p.error = error;
        Ok(())
    });
}

/// How to reach a plugin, with its secrets put in place.
fn spec_for(plugin: &Plugin, secret: &Secret) -> Spec {
    match &plugin.transport {
        Transport::Stdio { command, args, .. } => {
            let mut args = args.clone();
            if plugin.token_target.as_deref() == Some("arg") {
                if let Some(t) = &secret.token {
                    args.push(t.clone());
                }
            }
            Spec::Stdio { command: command.clone(), args, env: secret.env.clone() }
        }
        Transport::Http { url, .. } => {
            let mut headers = secret.headers.clone();
            let bearer = secret
                .oauth
                .as_ref()
                .map(|t| t.access_token.clone())
                .or_else(|| (plugin.token_target.as_deref() != Some("arg")).then(|| secret.token.clone()).flatten());
            if let Some(b) = bearer {
                headers.insert("Authorization".into(), format!("Bearer {b}"));
            }
            Spec::Http { url: url.clone(), headers }
        }
    }
}

/// Opens a connection to a stored plugin, renewing an expiring OAuth token first
/// and once more if the server turns out to have refused the old one.
pub async fn open_client(ws: &str, plugin: &Plugin) -> Result<Client> {
    let http = reqwest::Client::new();
    let mut secret = read_secret(ws, &plugin.id)?;
    if let Some(tokens) = secret.oauth.clone().filter(plugin_oauth::needs_refresh) {
        if let Ok(fresh) = plugin_oauth::refresh(&http, &tokens).await {
            secret.oauth = Some(fresh);
            write_secret(ws, &plugin.id, &secret)?;
        }
    }
    match Client::connect(&spec_for(plugin, &secret)).await {
        Err(e) if e.downcast_ref::<Unauthorized>().is_some() && secret.oauth.is_some() => {
            let fresh = plugin_oauth::refresh(&http, secret.oauth.as_ref().expect("checked")).await?;
            secret.oauth = Some(fresh);
            write_secret(ws, &plugin.id, &secret)?;
            Client::connect(&spec_for(plugin, &secret)).await
        }
        other => other,
    }
}

fn explain(e: &anyhow::Error) -> String {
    if e.downcast_ref::<Unauthorized>().is_some() {
        "The server refused the credentials. Reconnect it.".into()
    } else {
        format!("{e:#}")
    }
}

/// Connects to a server described by `spec` and lists its tools.
async fn probe(spec: &Spec) -> PluginTest {
    let started = std::time::Instant::now();
    let result = async {
        let client = Client::connect(spec).await?;
        client.list_tools().await
    }
    .await;
    let ms = started.elapsed().as_millis() as u64;
    match result {
        Ok(tools) => PluginTest { ok: true, tools, error: None, ms },
        Err(e) => PluginTest { ok: false, tools: Vec::new(), error: Some(explain(&e)), ms },
    }
}

/// The workspace's plugins, Skills, the catalog and recent calls.
#[tauri::command]
pub async fn plugins_list(workspace_id: String) -> Result<PluginSnapshot, String> {
    let home = home().map_err(|e| e.to_string())?;
    snapshot(&home, &workspace_id).map_err(|e| format!("{e:#}"))
}

/// Starts a server and lists its tools, before anything is saved. For the Add
/// dialog's Test button.
#[tauri::command]
pub async fn plugin_test(input: CustomInput) -> Result<PluginTest, String> {
    let (_, secret, transport) = custom_parts(&input).map_err(|e| format!("{e:#}"))?;
    let plugin = custom_plugin("test", &input, transport);
    Ok(probe(&spec_for(&plugin, &secret)).await)
}

/// Tests a plugin that is already connected, and refreshes its tool list.
#[tauri::command]
pub async fn plugin_retest(workspace_id: String, id: String) -> Result<PluginTest, String> {
    let plugin = plugin_in(&workspace_id, &id).ok_or("that plugin is gone")?;
    let started = std::time::Instant::now();
    let listed = async { open_client(&workspace_id, &plugin).await?.list_tools().await }.await;
    let ms = started.elapsed().as_millis() as u64;
    Ok(match listed {
        Ok(tools) => {
            remember_tools(&workspace_id, &id, &tools);
            set_status(&workspace_id, &id, Status::Connected, None);
            plugin_proxy::forget(&workspace_id, &id).await;
            PluginTest { ok: true, tools, error: None, ms }
        }
        Err(e) => {
            let unauthorized = e.downcast_ref::<Unauthorized>().is_some();
            let msg = explain(&e);
            if unauthorized {
                set_status(&workspace_id, &id, Status::Not, Some(msg.clone()));
            }
            PluginTest { ok: false, tools: Vec::new(), error: Some(msg), ms }
        }
    })
}

fn custom_parts(input: &CustomInput) -> Result<(String, Secret, Transport)> {
    let name = input.name.trim().to_string();
    let target = input.target.trim();
    if target.is_empty() {
        bail!(if input.transport == "http" { "Enter the server's URL" } else { "Enter the command that starts it" });
    }
    let mut secret = Secret::default();
    let pairs: Vec<(&str, &str)> = input
        .env
        .iter()
        .filter(|e| !e.key.trim().is_empty())
        .map(|e| (e.key.trim(), e.value.as_str()))
        .collect();
    let transport = if input.transport == "http" {
        for (k, v) in &pairs {
            secret.headers.insert((*k).to_string(), (*v).to_string());
        }
        Transport::Http { url: target.to_string(), header_keys: pairs.iter().map(|(k, _)| (*k).to_string()).collect() }
    } else {
        let mut words = split_command(target);
        if words.is_empty() {
            bail!("Enter the command that starts it");
        }
        let command = words.remove(0);
        for (k, v) in &pairs {
            secret.env.insert((*k).to_string(), (*v).to_string());
        }
        Transport::Stdio { command, args: words, env_keys: pairs.iter().map(|(k, _)| (*k).to_string()).collect() }
    };
    Ok((name, secret, transport))
}

const COLORS: [&str; 8] = ["#e2a440", "#e2814a", "#df6f86", "#9a87ea", "#6a8cf0", "#4fb0c4", "#55b884", "#9198a8"];

fn custom_plugin(id: &str, input: &CustomInput, transport: Transport) -> Plugin {
    let name = if input.name.trim().is_empty() { "Custom server".to_string() } else { input.name.trim().to_string() };
    let initials: String = name.split_whitespace().filter_map(|w| w.chars().next()).take(2).collect::<String>().to_uppercase();
    let sum: usize = name.bytes().map(usize::from).sum();
    Plugin {
        id: id.to_string(),
        kind: PluginKind::Custom,
        slug: None,
        description: match &transport {
            Transport::Stdio { command, .. } => format!("Your MCP server · {command}"),
            Transport::Http { url, .. } => format!("Your MCP server · {url}"),
        },
        name,
        category: "Custom".into(),
        transport,
        auth: AuthKind::None,
        token_target: None,
        status: Status::Connected,
        tools: Vec::new(),
        grants: Vec::new(),
        connected_at: Some(now_ms()),
        account: None,
        color: COLORS[sum % COLORS.len()].into(),
        mark: initials,
        error: None,
    }
}

/// Adds a server the reader typed in. It is saved even when it cannot be reached
/// yet, with the reason on the card.
#[tauri::command]
pub async fn plugin_add_custom(app: AppHandle, workspace_id: String, input: CustomInput) -> Result<PluginSnapshot, String> {
    add_custom(&app, &workspace_id, input).await.map_err(|e| format!("{e:#}"))
}

async fn add_custom(app: &AppHandle, ws: &str, input: CustomInput) -> Result<PluginSnapshot> {
    let home = home()?;
    if input.name.trim().is_empty() {
        bail!("Give the server a name");
    }
    let (_, secret, transport) = custom_parts(&input)?;
    let id = format!("mcp-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
    let mut plugin = custom_plugin(&id, &input, transport);
    if !secret.env.is_empty() || !secret.headers.is_empty() {
        write_secret(ws, &id, &secret)?;
    }
    let tested = probe(&spec_for(&plugin, &secret)).await;
    if tested.ok {
        plugin.tools = merge_tools(&[], &tested.tools);
    } else {
        plugin.error = tested.error;
    }
    update(&home, ws, |d| {
        d.plugins.insert(0, plugin);
        Ok(())
    })?;
    changed(app);
    snapshot(&home, ws)
}

/// Signs in to a catalog server (or pastes its token), lists its tools and saves
/// it as connected with nobody granted yet. Reconnecting keeps grants and policies.
///
/// May wait minutes for the browser; [`plugin_connect_cancel`] ends the wait.
#[tauri::command]
pub async fn plugin_connect(
    app: AppHandle,
    workspace_id: String,
    catalog_id: String,
    creds: Option<ConnectCreds>,
) -> Result<Plugin, String> {
    connect(&app, &workspace_id, &catalog_id, creds.unwrap_or_default())
        .await
        .map_err(|e| format!("{e:#}"))
}

async fn connect(app: &AppHandle, ws: &str, catalog_id: &str, creds: ConnectCreds) -> Result<Plugin> {
    let home = home()?;
    valid_id(ws)?;
    let entry = catalog()
        .into_iter()
        .find(|c| c.id == catalog_id)
        .ok_or_else(|| anyhow!("that server is not in the catalog"))?;
    let previous = read_secret(ws, &entry.id).unwrap_or_default();
    let mut secret = Secret::default();

    let (transport, resource) = match &entry.transport {
        CatalogTransport::Stdio { command, args } => (
            Transport::Stdio { command: command.clone(), args: args.clone(), env_keys: Vec::new() },
            String::new(),
        ),
        CatalogTransport::Http { url } => (Transport::Http { url: url.clone(), header_keys: Vec::new() }, url.clone()),
    };
    let mut account = None;

    match entry.auth.kind {
        AuthKind::None => {}
        AuthKind::Token => {
            let token = creds
                .token
                .filter(|t| !t.trim().is_empty())
                .or_else(|| previous.token.clone())
                .ok_or_else(|| anyhow!("Paste the {}", entry.auth.label.as_deref().unwrap_or("token").to_lowercase()))?;
            secret.token = Some(token.trim().to_string());
            account = entry.auth.label.clone();
        }
        AuthKind::Oauth | AuthKind::OauthOwn => {
            let own = if entry.auth.kind == AuthKind::OauthOwn {
                let (id, sec) = match (&creds.client_id, previous.oauth.as_ref()) {
                    (Some(id), _) if !id.trim().is_empty() => (id.trim().to_string(), creds.client_secret.clone()),
                    (_, Some(t)) => (t.client_id.clone(), t.client_secret.clone()),
                    _ => bail!("Paste the client ID of your {}", entry.auth.label.as_deref().unwrap_or("OAuth client")),
                };
                Some(OwnClient { client_id: id, client_secret: sec.filter(|s| !s.trim().is_empty()) })
            } else {
                None
            };
            let opener = app.clone();
            let open = move |url: &str| -> Result<()> {
                opener.opener().open_url(url, None::<&str>).map_err(|e| anyhow!("{e}"))
            };
            let tokens = plugin_oauth::sign_in(
                &reqwest::Client::new(),
                &sign_in_key(ws, &entry.id),
                &resource,
                None,
                own,
                &entry.auth.scopes,
                &open,
            )
            .await?;
            account = tokens.account.clone().or_else(|| Some("Signed in with OAuth".into()));
            secret.oauth = Some(tokens);
        }
    }

    let existing = update(&home, ws, |d| Ok(d.plugins.iter().find(|p| p.id == entry.id).cloned()))?;
    let mut plugin = Plugin {
        id: entry.id.clone(),
        kind: PluginKind::Catalog,
        slug: entry.slug.clone(),
        name: entry.name.clone(),
        description: entry.description.clone(),
        category: entry.category.clone(),
        transport,
        auth: entry.auth.kind,
        token_target: entry.auth.target.clone(),
        status: Status::Connected,
        tools: existing.as_ref().map(|p| p.tools.clone()).unwrap_or_default(),
        grants: existing.as_ref().map(|p| p.grants.clone()).unwrap_or_default(),
        connected_at: Some(now_ms()),
        account,
        color: entry.color.clone(),
        mark: entry.mark.clone(),
        error: None,
    };

    // The secret goes in before the first request because the request needs it,
    // and comes out again if the server turns out to be unreachable with it.
    write_secret(ws, &plugin.id, &secret)?;
    let listed = async { Client::connect(&spec_for(&plugin, &secret)).await?.list_tools().await }.await;
    let remote = match listed {
        Ok(t) => t,
        Err(e) => {
            if existing.is_none() {
                let _ = keychain::delete(&secret_account(ws, &plugin.id));
            }
            return Err(anyhow!("Signed in, but {} could not be reached: {}", entry.name, explain(&e)));
        }
    };
    plugin.tools = merge_tools(&plugin.tools, &remote);

    let saved = plugin.clone();
    update(&home, ws, |d| {
        match d.plugins.iter_mut().find(|p| p.id == saved.id) {
            Some(slot) => *slot = saved,
            None => d.plugins.insert(0, saved),
        }
        Ok(())
    })?;
    plugin_proxy::forget(ws, &plugin.id).await;
    changed(app);
    Ok(plugin)
}

fn sign_in_key(ws: &str, id: &str) -> String {
    format!("{ws}/{id}")
}

/// Ends a sign-in that is waiting on the browser.
#[tauri::command]
pub fn plugin_connect_cancel(workspace_id: String, catalog_id: String) {
    plugin_oauth::cancel(&sign_in_key(&workspace_id, &catalog_id));
}

/// Signs a catalog plugin in again, or re-tests a custom one.
#[tauri::command]
pub async fn plugin_reconnect(
    app: AppHandle,
    workspace_id: String,
    id: String,
    creds: Option<ConnectCreds>,
) -> Result<Plugin, String> {
    let plugin = plugin_in(&workspace_id, &id).ok_or("that plugin is gone")?;
    if plugin.kind == PluginKind::Catalog {
        return connect(&app, &workspace_id, &id, creds.unwrap_or_default()).await.map_err(|e| format!("{e:#}"));
    }
    let test = plugin_retest(workspace_id.clone(), id.clone()).await?;
    changed(&app);
    match test.error {
        Some(e) => Err(e),
        None => plugin_in(&workspace_id, &id).ok_or_else(|| "that plugin is gone".into()),
    }
}

/// Forgets a plugin: its token, its policies and who held it.
#[tauri::command]
pub async fn plugin_disconnect(app: AppHandle, workspace_id: String, id: String) -> Result<PluginSnapshot, String> {
    let home = home().map_err(|e| e.to_string())?;
    keychain::delete(&secret_account(&workspace_id, &id)).map_err(|e| format!("{e:#}"))?;
    update(&home, &workspace_id, |d| {
        d.plugins.retain(|p| p.id != id);
        Ok(())
    })
    .map_err(|e| format!("{e:#}"))?;
    plugin_proxy::forget(&workspace_id, &id).await;
    changed(&app);
    snapshot(&home, &workspace_id).map_err(|e| format!("{e:#}"))
}

/// Sets one tool's policy.
#[tauri::command]
pub async fn plugin_set_policy(
    app: AppHandle,
    workspace_id: String,
    id: String,
    tool: String,
    policy: Policy,
) -> Result<PluginSnapshot, String> {
    let home = home().map_err(|e| e.to_string())?;
    update(&home, &workspace_id, |d| {
        let p = find(d, &id)?;
        match p.tools.iter_mut().find(|t| t.name == tool) {
            Some(t) => t.policy = policy,
            None => p.tools.push(ToolPolicy { name: tool.clone(), description: None, policy }),
        }
        Ok(())
    })
    .map_err(|e| format!("{e:#}"))?;
    changed(&app);
    snapshot(&home, &workspace_id).map_err(|e| format!("{e:#}"))
}

/// Sets every tool's policy at once, for the Connect flow's second step, and who
/// holds the plugin for its third.
#[tauri::command]
pub async fn plugin_configure(
    app: AppHandle,
    workspace_id: String,
    id: String,
    policies: Vec<ToolPolicy>,
    grants: Vec<String>,
) -> Result<PluginSnapshot, String> {
    let home = home().map_err(|e| e.to_string())?;
    update(&home, &workspace_id, |d| {
        let p = find(d, &id)?;
        for chosen in &policies {
            if let Some(t) = p.tools.iter_mut().find(|t| t.name == chosen.name) {
                t.policy = chosen.policy;
            }
        }
        p.grants = grants.clone();
        Ok(())
    })
    .map_err(|e| format!("{e:#}"))?;
    changed(&app);
    snapshot(&home, &workspace_id).map_err(|e| format!("{e:#}"))
}

/// Gives a plugin to an agent or takes it away. A revoked grant stops working at
/// once, because the proxy checks it on every call; a new one reaches the agent
/// when its next session starts.
#[tauri::command]
pub async fn plugin_set_grant(
    app: AppHandle,
    workspace_id: String,
    id: String,
    agent_id: String,
    on: bool,
) -> Result<PluginSnapshot, String> {
    let home = home().map_err(|e| e.to_string())?;
    update(&home, &workspace_id, |d| {
        let p = find(d, &id)?;
        p.grants.retain(|g| g != &agent_id);
        if on {
            p.grants.push(agent_id.clone());
        }
        Ok(())
    })
    .map_err(|e| format!("{e:#}"))?;
    changed(&app);
    snapshot(&home, &workspace_id).map_err(|e| format!("{e:#}"))
}

fn unique_slug(data: &Data, name: &str) -> String {
    let base = slugify(name);
    let mut slug = base.clone();
    let mut n = 2;
    while data.skills.iter().any(|s| s.slug == slug) {
        slug = format!("{base}-{n}");
        n += 1;
    }
    slug
}

/// Creates or rewrites a Skill: its `SKILL.md` and who is told about it.
#[tauri::command]
pub async fn skill_save(app: AppHandle, workspace_id: String, input: SkillInput) -> Result<PluginSnapshot, String> {
    let home = home().map_err(|e| e.to_string())?;
    save_skill(&home, &workspace_id, input).map_err(|e| format!("{e:#}"))?;
    changed(&app);
    snapshot(&home, &workspace_id).map_err(|e| format!("{e:#}"))
}

fn save_skill(home: &Path, ws: &str, input: SkillInput) -> Result<String> {
    let name = if input.name.trim().is_empty() { "Untitled skill".to_string() } else { input.name.trim().to_string() };
    update(home, ws, |d| {
        let slug = match &input.slug {
            Some(s) if d.skills.iter().any(|k| &k.slug == s) => s.clone(),
            Some(_) => bail!("that skill is gone"),
            None => unique_slug(d, &name),
        };
        let path = skill_path(home, ws, &slug)?;
        std::fs::create_dir_all(path.parent().context("no parent")?)?;
        std::fs::write(&path, &input.md)?;
        match d.skills.iter_mut().find(|k| k.slug == slug) {
            Some(k) => {
                k.name = name.clone();
                k.grants = input.grants.clone();
            }
            None => d.skills.push(SkillMeta { slug: slug.clone(), name: name.clone(), by: "me".into(), grants: input.grants.clone() }),
        }
        Ok(slug)
    })
}

/// Deletes a Skill and its file.
#[tauri::command]
pub async fn skill_delete(app: AppHandle, workspace_id: String, slug: String) -> Result<PluginSnapshot, String> {
    let home = home().map_err(|e| e.to_string())?;
    delete_skill(&home, &workspace_id, &slug).map_err(|e| format!("{e:#}"))?;
    changed(&app);
    snapshot(&home, &workspace_id).map_err(|e| format!("{e:#}"))
}

fn delete_skill(home: &Path, ws: &str, slug: &str) -> Result<()> {
    update(home, ws, |d| {
        if !d.skills.iter().any(|s| s.slug == slug) {
            return Ok(());
        }
        d.skills.retain(|s| s.slug != slug);
        let path = skill_path(home, ws, slug)?;
        if let Some(dir) = path.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hz-plugins-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn tool(name: &str, policy: Policy) -> ToolPolicy {
        ToolPolicy { name: name.into(), description: None, policy }
    }

    fn remote(name: &str) -> RemoteTool {
        RemoteTool { name: name.into(), description: Some(format!("{name} does a thing")), input_schema: None }
    }

    fn plugin(id: &str, grants: &[&str], tools: Vec<ToolPolicy>) -> Plugin {
        Plugin {
            id: id.into(),
            kind: PluginKind::Catalog,
            slug: Some(id.into()),
            name: id.to_uppercase(),
            description: String::new(),
            category: "Code".into(),
            transport: Transport::Http { url: "https://x.test/mcp".into(), header_keys: vec![] },
            auth: AuthKind::Oauth,
            token_target: None,
            status: Status::Connected,
            tools,
            grants: grants.iter().map(|g| (*g).to_string()).collect(),
            connected_at: Some(1),
            account: None,
            color: "#fff".into(),
            mark: "X".into(),
            error: None,
        }
    }

    #[test]
    fn the_catalog_parses_and_every_entry_is_complete() {
        let all = catalog();
        assert_eq!(all.len(), 14);
        for id in [
            "github", "linear", "postgres", "stripe", "browser", "slack", "drive", "figma", "notion", "sentry",
            "vercel", "supabase", "gmail", "calendar",
        ] {
            assert!(all.iter().any(|c| c.id == id), "{id} is missing");
        }
        for c in &all {
            assert!(!c.description.is_empty() && !c.note.is_empty(), "{}", c.id);
            if c.auth.kind == AuthKind::Token {
                assert!(c.auth.target.is_some(), "{} says where its token goes", c.id);
            }
        }
    }

    #[test]
    fn reading_is_allowed_and_the_rest_asks() {
        assert_eq!(default_policy("list_pull_requests"), Policy::Allow);
        assert_eq!(default_policy("search_issues"), Policy::Allow);
        assert_eq!(default_policy("get-file"), Policy::Allow);
        assert_eq!(default_policy("create_pull_request"), Policy::Ask);
        assert_eq!(default_policy("delete_issue"), Policy::Ask);
        assert_eq!(default_policy("refund"), Policy::Ask);
    }

    #[test]
    fn a_new_listing_keeps_chosen_policies_and_defaults_the_rest() {
        let existing = vec![tool("merge", Policy::Off), tool("gone", Policy::Allow)];
        let merged = merge_tools(&existing, &[remote("merge"), remote("list_prs"), remote("comment")]);
        let by = |n: &str| merged.iter().find(|t| t.name == n).unwrap().policy;
        assert_eq!(by("merge"), Policy::Off, "the reader's choice survives");
        assert_eq!(by("list_prs"), Policy::Allow);
        assert_eq!(by("comment"), Policy::Ask);
        assert!(merged.iter().all(|t| t.name != "gone"), "a vanished tool is dropped");
    }

    #[test]
    fn a_tool_that_is_off_is_not_shown_and_one_never_seen_is_judged_by_name() {
        let p = plugin("gh", &[], vec![tool("merge", Policy::Off), tool("list", Policy::Allow)]);
        let shown = visible_tools(&p, vec![remote("merge"), remote("list"), remote("new_thing")]);
        let names: Vec<_> = shown.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["list", "new_thing"]);
        assert_eq!(policy_of(&p, "merge"), Policy::Off);
        assert_eq!(policy_of(&p, "get_x"), Policy::Allow);
        assert_eq!(policy_of(&p, "post_x"), Policy::Ask);
    }

    #[test]
    fn grants_become_the_servers_of_the_next_session() {
        let tools = vec![tool("a", Policy::Allow)];
        let mut off = plugin("off", &["ada"], vec![tool("a", Policy::Off)]);
        off.name = "Off".into();
        let mut stale = plugin("stale", &["ada"], tools.clone());
        stale.status = Status::Not;
        let plugins = vec![
            plugin("github", &["ada", "leo"], tools.clone()),
            plugin("linear", &["leo"], tools.clone()),
            off,
            stale,
        ];
        let ada = build_servers(&plugins, "ada", 4000);
        assert_eq!(ada.len(), 1, "not linear (not granted), not off (nothing to offer), not stale (signed out)");
        assert_eq!(ada[0]["name"], "github");
        assert_eq!(ada[0]["url"], "http://127.0.0.1:4000/mcp/ada/plugin/github");
        assert_eq!(ada[0]["type"], "http");
        let leo: Vec<_> = build_servers(&plugins, "leo", 4000).iter().map(|s| s["name"].clone()).collect();
        assert_eq!(leo, [json!("github"), json!("linear")]);
        assert!(build_servers(&plugins, "nobody", 4000).is_empty());
    }

    #[test]
    fn a_server_never_takes_hzs_own_names() {
        let mut p = plugin("x", &[], vec![]);
        p.name = "Team".into();
        assert_eq!(server_name(&p), "team-plugin");
        p.name = "Hyze internal!".into();
        assert_eq!(server_name(&p), "hyze-internal");
    }

    #[test]
    fn a_command_line_splits_like_a_shell_for_the_simple_cases() {
        assert_eq!(split_command("npx -y @hyze/mcp-server"), ["npx", "-y", "@hyze/mcp-server"]);
        assert_eq!(split_command(r#"node "my server.js" --flag 'a b'"#), ["node", "my server.js", "--flag", "a b"]);
        assert!(split_command("   ").is_empty());
    }

    #[test]
    fn stored_plugins_hold_names_of_secrets_and_not_the_secrets() {
        let home = home_dir();
        let input = CustomInput {
            name: "Hyze internal".into(),
            transport: "stdio".into(),
            target: "npx -y @hyze/mcp".into(),
            env: vec![EnvVar { key: "API_KEY".into(), value: "sk-very-secret".into() }],
        };
        let (_, secret, transport) = custom_parts(&input).unwrap();
        let p = custom_plugin("mcp-1", &input, transport);
        update(&home, "ws1", |d| {
            d.plugins.push(p.clone());
            Ok(())
        })
        .unwrap();
        let file = std::fs::read_to_string(home.join("workspaces/ws1/plugins.json")).unwrap();
        assert!(file.contains("API_KEY"));
        assert!(!file.contains("sk-very-secret"), "the value must live in the Keychain");
        assert_eq!(secret.env["API_KEY"], "sk-very-secret");
        assert!(matches!(spec_for(&p, &secret), Spec::Stdio { env, .. } if env["API_KEY"] == "sk-very-secret"));
        assert_eq!(read_data(&home, "ws1").unwrap().plugins[0].name, "Hyze internal");
    }

    #[test]
    fn a_token_goes_where_the_catalog_says() {
        let mut p = plugin("gh", &[], vec![]);
        let secret = Secret { token: Some("tok".into()), ..Default::default() };
        p.token_target = Some("bearer".into());
        assert!(matches!(spec_for(&p, &secret), Spec::Http { headers, .. } if headers["Authorization"] == "Bearer tok"));
        p.transport = Transport::Stdio { command: "npx".into(), args: vec!["-y".into(), "pg".into()], env_keys: vec![] };
        p.token_target = Some("arg".into());
        assert!(matches!(spec_for(&p, &secret), Spec::Stdio { args, .. } if args == ["-y", "pg", "tok"]));
    }

    #[test]
    fn skills_are_files_with_grants_beside_them() {
        let home = home_dir();
        let slug = save_skill(
            &home,
            "ws1",
            SkillInput { slug: None, name: "Pricing analysis".into(), md: "---\nname: pricing-analysis\n---\nModel it.".into(), grants: vec!["atlas".into()] },
        )
        .unwrap();
        assert_eq!(slug, "pricing-analysis");
        let path = home.join("workspaces/ws1/skills/pricing-analysis/SKILL.md");
        assert!(std::fs::read_to_string(&path).unwrap().contains("Model it."));

        let again = save_skill(&home, "ws1", SkillInput { slug: None, name: "Pricing analysis".into(), md: "x".into(), grants: vec![] }).unwrap();
        assert_eq!(again, "pricing-analysis-2", "a second skill of the same name gets its own folder");

        save_skill(
            &home,
            "ws1",
            SkillInput { slug: Some(slug.clone()), name: "Pricing".into(), md: "new".into(), grants: vec!["atlas".into(), "ada".into()] },
        )
        .unwrap();
        let snap = snapshot(&home, "ws1").unwrap();
        let s = snap.skills.iter().find(|s| s.slug == slug).unwrap();
        assert_eq!((s.name.as_str(), s.md.as_str(), s.grants.len()), ("Pricing", "new", 2));
        assert_eq!(s.path, path.display().to_string());

        assert_eq!(skill_refs(&home, "ws1", "ada"), vec![("Pricing".to_string(), path.display().to_string())]);
        assert!(skill_refs(&home, "ws1", "leo").is_empty());

        delete_skill(&home, "ws1", &slug).unwrap();
        assert!(!path.exists());
        assert_eq!(snapshot(&home, "ws1").unwrap().skills.len(), 1);
        assert!(save_skill(&home, "ws1", SkillInput { slug: Some("../x".into()), name: "n".into(), md: String::new(), grants: vec![] }).is_err());
    }

    #[test]
    fn the_call_log_keeps_two_weeks() {
        let home = home_dir();
        let now = now_ms();
        let path = calls_path(&home, "ws1").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let rec = |t: u64, tool: &str| CallRecord { t, plugin: "github".into(), agent: "ada".into(), tool: tool.into(), ms: 400, ok: true, outcome: "allowed".into() };
        let lines: Vec<String> = [rec(now - TWO_WEEKS_MS - 5000, "old"), rec(now - 1000, "new")]
            .iter()
            .map(|r| serde_json::to_string(r).unwrap())
            .collect();
        std::fs::write(&path, lines.join("\n") + "\nnot json\n").unwrap();
        let calls = recent_calls(&home, "ws1", now);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].tool, "new");
    }

    #[test]
    fn a_call_is_appended_and_read_back() {
        let home = home_dir();
        let rec = CallRecord { t: now_ms(), plugin: "github".into(), agent: "ada".into(), tool: "list".into(), ms: 12, ok: true, outcome: "allowed".into() };
        append_call(&home, "ws1", &rec).unwrap();
        append_call(&home, "ws1", &CallRecord { tool: "merge".into(), ok: false, outcome: "denied".into(), ..rec.clone() }).unwrap();
        let snap = snapshot(&home, "ws1").unwrap();
        assert_eq!(snap.calls.len(), 2);
        assert_eq!(snap.calls[1].outcome, "denied");
        assert_eq!(snap.calls[0], rec);
    }

    #[test]
    fn ids_that_reach_into_paths_are_refused() {
        assert!(ws_dir(Path::new("/x"), "../etc").is_err());
        assert!(ws_dir(Path::new("/x"), "").is_err());
        assert!(ws_dir(Path::new("/x"), "7c9e-1").is_ok());
    }
}
