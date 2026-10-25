//! The agents the reader made, as the backend needs them: who they are, what they
//! were told, where their memory lives and how to reach their teammates.
//!
//! The webview's roster is the source of truth and mirrors itself here through
//! [`agents_sync`] on every change. The backend cannot ask the webview for it —
//! a relayed message arrives while no one is typing — so it keeps its own copy.

use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::{LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use serde_json::{json, Value};

use crate::store;

/// What the backend keeps of a roster entry. The face, colour, folder and model
/// stay in the webview: nothing here reads them.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// The CLI, the folder and the starting model: what it takes to open this
    /// agent's conversation from the backend when a teammate writes first.
    #[serde(default)]
    pub harness: String,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    /// The workspace this agent belongs to. Its teammates are the other agents
    /// of the same one, and its context goes in front of the briefing.
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// Things it must stop and ask about first, in the reader's words. Advisory:
    /// they reach the agent as hard rules in its briefing, and nothing here can
    /// stop a tool call an agent in full-access mode has already decided on.
    #[serde(default)]
    pub always_ask: Vec<AskRule>,
    /// Folders besides its own that it may touch. Claude is handed them as
    /// additional directories; every CLI is told them, and which are read only,
    /// in the briefing.
    #[serde(default)]
    pub folders: Vec<Folder>,
    /// Monthly spend limit in US dollars; `None` is no limit.
    #[serde(default)]
    pub budget: Option<f64>,
    /// Who may message it. Absent means everyone in its workspace.
    #[serde(default)]
    pub talk: Talk,
    /// hz's own tool servers the reader switched off: `"team"` and `"memory"`.
    #[serde(default)]
    pub tools_off: Vec<String>,
}

/// One "always ask me before" line.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct AskRule {
    pub text: String,
    pub on: bool,
}

/// A folder an agent may touch besides its own.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Folder {
    pub path: String,
    pub write: bool,
}

/// Who may message an agent. `mode` is `everyone`, `me` (no agent) or `list`.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Talk {
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub ids: Vec<String>,
}

impl Talk {
    /// Whether the agent `from` may message the owner of this setting. Callers
    /// have already checked that both share a workspace.
    pub fn allows(&self, from: &str) -> bool {
        match self.mode.as_str() {
            "me" => false,
            "list" => self.ids.iter().any(|id| id == from),
            _ => true,
        }
    }
}

static RECORDS: LazyLock<Mutex<Vec<AgentRecord>>> = LazyLock::new(Default::default);

/// Session → agent, for the window between a new agent's first send and the
/// webview's mirror learning which session it was bound to.
static BOUND: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);

/// Replaces the mirror with the webview's roster, and keeps a copy on disk.
///
/// Taken as raw JSON because the file has to hold everything the webview knows —
/// face, colour, model — while this side only reads the few fields it needs. The
/// copy is what brings the agents back when the webview's own storage is cleared.
#[tauri::command]
pub async fn agents_sync(agents: Vec<Value>) {
    let records = agents
        .iter()
        .filter_map(|a| serde_json::from_value::<AgentRecord>(a.clone()).ok())
        .collect();
    *RECORDS.lock().expect("agent records poisoned") = records;

    if let Err(e) = write_roster(&agents).await {
        eprintln!("[agents err] could not save the roster: {e:#}");
    }
}

/// The roster as the last sync left it on disk, or nothing for a fresh install.
#[tauri::command]
pub async fn agents_load() -> Vec<Value> {
    let Ok(path) = roster_path().await else { return Vec::new() };
    let Ok(raw) = tokio::fs::read_to_string(path).await else { return Vec::new() };
    serde_json::from_str(&raw).unwrap_or_default()
}

async fn roster_path() -> anyhow::Result<PathBuf> {
    Ok(store::get_home_app_dir().await?.join("agents.json"))
}

/// Written beside its target and renamed over it, so a crash mid-write leaves the
/// old roster rather than half of a new one.
async fn write_roster(agents: &[Value]) -> anyhow::Result<()> {
    let path = roster_path().await?;
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, serde_json::to_vec_pretty(agents)?).await?;
    tokio::fs::rename(&tmp, &path).await?;
    Ok(())
}

/// Records that `session_id` is `agent_id`'s conversation, ahead of the mirror.
pub fn bind(session_id: &str, agent_id: &str) {
    BOUND
        .lock()
        .expect("agent bindings poisoned")
        .insert(session_id.to_string(), agent_id.to_string());
}

/// An agent's name from its id, for turning a reply's address into words. `None`
/// for `"me"` and for an agent the roster no longer holds.
pub fn name_of(agent_id: &str) -> Option<String> {
    RECORDS
        .lock()
        .expect("agent records poisoned")
        .iter()
        .find(|a| a.id == agent_id)
        .map(|a| a.name.clone())
}

/// The agent a session belongs to, or `None` for a session that is not one's.
pub fn agent_of(session_id: &str) -> Option<AgentRecord> {
    let bound = BOUND
        .lock()
        .expect("agent bindings poisoned")
        .get(session_id)
        .cloned();
    let records = RECORDS.lock().expect("agent records poisoned");

    records
        .iter()
        .find(|a| Some(&a.id) == bound.as_ref() || a.session_id.as_deref() == Some(session_id))
        .cloned()
}

/// Records the session an agent's conversation was just started in, ahead of the
/// webview's own roster learning it from the `agent_session_bound` event.
pub fn set_session(agent_id: &str, session_id: &str) {
    if let Some(agent) = RECORDS
        .lock()
        .expect("agent records poisoned")
        .iter_mut()
        .find(|a| a.id == agent_id)
    {
        agent.session_id = Some(session_id.to_string());
    }
}

/// The agent with this id, if the mirror knows it.
pub fn by_id(id: &str) -> Option<AgentRecord> {
    RECORDS
        .lock()
        .expect("agent records poisoned")
        .iter()
        .find(|a| a.id == id)
        .cloned()
}

/// Every other agent **in the same workspace**, which is who `id` can talk to.
/// An agent from before workspaces (no id) shares the unassigned pool.
pub fn teammates(id: &str) -> Vec<AgentRecord> {
    let records = RECORDS.lock().expect("agent records poisoned");
    let mine = records.iter().find(|a| a.id == id).and_then(|a| a.workspace_id.clone());
    records
        .iter()
        .filter(|a| a.id != id && a.workspace_id == mine)
        .cloned()
        .collect()
}

/// Every agent the mirror knows, across workspaces.
pub fn all() -> Vec<AgentRecord> {
    RECORDS.lock().expect("agent records poisoned").clone()
}

/// The agents of one workspace, for deleting it.
pub fn in_workspace(workspace_id: &str) -> Vec<AgentRecord> {
    RECORDS
        .lock()
        .expect("agent records poisoned")
        .iter()
        .filter(|a| a.workspace_id.as_deref() == Some(workspace_id))
        .cloned()
        .collect()
}

/// Where an agent keeps what it remembers, created on first use with an empty
/// index so the agent's first read finds a file rather than an error.
pub async fn memory_dir(agent_id: &str) -> Option<PathBuf> {
    let dir = store::get_home_app_dir()
        .await
        .ok()?
        .join("agents")
        .join(agent_id)
        .join("memory");
    tokio::fs::create_dir_all(&dir).await.ok()?;

    let index = dir.join("MEMORY.md");
    if !tokio::fs::try_exists(&index).await.unwrap_or(false) {
        let _ = tokio::fs::write(&index, "# Memory\n\n").await;
    }
    Some(dir)
}

/// One note in an agent's memory folder, as the panel lists it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub name: String,
    pub size: u64,
    /// Milliseconds since the epoch, for "edited 3 days ago".
    pub modified_ms: u64,
}

/// A note name that cannot leave the memory folder: one flat `.md` file.
///
/// Checked on every call rather than trusted from the webview, because the name
/// ends up in a path and `..` or a separator would walk out of the folder.
pub(crate) fn note_path(dir: &std::path::Path, name: &str) -> anyhow::Result<PathBuf> {
    let clean = !name.is_empty()
        && name.len() <= 120
        && name.ends_with(".md")
        && !name.contains(['/', '\\', '\0'])
        && !name.starts_with('.');
    anyhow::ensure!(clean, "a note is a flat .md file name");
    Ok(dir.join(name))
}

/// An agent id that is only an id. Ids are uuids; refusing anything else keeps a
/// crafted one from becoming a path.
pub(crate) fn valid_agent_id(id: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
        "not an agent id"
    );
    Ok(())
}

pub(crate) async fn memory_dir_for(agent_id: &str) -> Result<PathBuf, String> {
    valid_agent_id(agent_id).map_err(|e| e.to_string())?;
    memory_dir(agent_id)
        .await
        .ok_or_else(|| "could not open the memory folder".to_string())
}

/// The agent's notes, the index first and then newest edit first.
#[tauri::command]
pub async fn agent_memory_list(agent_id: String) -> Result<Vec<MemoryFile>, String> {
    let dir = memory_dir_for(&agent_id).await?;
    let mut read = tokio::fs::read_dir(&dir).await.map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    while let Some(entry) = read.next_entry().await.map_err(|e| e.to_string())? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if note_path(&dir, &name).is_err() {
            continue;
        }
        let Ok(meta) = entry.metadata().await else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        files.push(MemoryFile { name, size: meta.len(), modified_ms });
    }

    files.sort_by(|a, b| {
        (b.name == "MEMORY.md")
            .cmp(&(a.name == "MEMORY.md"))
            .then(b.modified_ms.cmp(&a.modified_ms))
    });
    Ok(files)
}

#[tauri::command]
pub async fn agent_memory_read(agent_id: String, name: String) -> Result<String, String> {
    let dir = memory_dir_for(&agent_id).await?;
    let path = note_path(&dir, &name).map_err(|e| e.to_string())?;
    tokio::fs::read_to_string(path).await.map_err(|e| e.to_string())
}

/// Writes a note, replacing it. The reader editing and the agent writing share
/// the folder, so the last write wins — the same as two people on one file.
#[tauri::command]
pub async fn agent_memory_write(agent_id: String, name: String, content: String) -> Result<(), String> {
    let dir = memory_dir_for(&agent_id).await?;
    let path = note_path(&dir, &name).map_err(|e| e.to_string())?;
    tokio::fs::write(path, content).await.map_err(|e| e.to_string())
}

/// The last thing an agent said and when its conversation last moved, for the
/// sidebar row.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Glance {
    pub session_id: String,
    /// First line of the newest assistant message, or empty before there is one.
    pub line: String,
    /// The log file's last write, in ms since the epoch. The file's clock and not
    /// an event's `ts`, which most events omit.
    pub at_ms: Option<u64>,
}

/// How much of a log's end is read for a glance: a long answer's last lines fit,
/// and an 11 MB transcript is never read whole to draw one row.
const GLANCE_TAIL_BYTES: u64 = 64 * 1024;

/// The first line of the newest `assistant_text` in a chunk from a log's end.
/// The first line of the chunk may be cut in half, so it is skipped unless the
/// chunk is the whole file.
fn last_line_said(chunk: &str, whole: bool) -> String {
    let mut lines: Vec<&str> = chunk.lines().collect();
    if !whole && !lines.is_empty() {
        lines.remove(0);
    }
    for raw in lines.iter().rev() {
        let Ok(event) = serde_json::from_str::<Value>(raw) else { continue };
        let payload = &event["payload"];
        if payload["type"] != "assistant_text" || !event["subagent"].is_null() {
            continue;
        }
        if let Some(first) = payload["text"]
            .as_str()
            .and_then(|t| t.lines().map(str::trim).find(|l| !l.is_empty()))
        {
            return first.chars().take(160).collect();
        }
    }
    String::new()
}

/// A glance at each session: what the agent said last and when. Missing logs
/// read as empty, not as an error, since an agent can exist before its first turn.
#[tauri::command]
pub async fn agent_glances(session_ids: Vec<String>) -> Vec<Glance> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let mut out = Vec::new();
    for session_id in session_ids {
        let Ok(path) = store::get_session_path(&session_id).await else { continue };
        let Ok(mut file) = tokio::fs::File::open(&path).await else {
            out.push(Glance { session_id, line: String::new(), at_ms: None });
            continue;
        };
        let Ok(meta) = file.metadata().await else { continue };
        let at_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);

        let start = meta.len().saturating_sub(GLANCE_TAIL_BYTES);
        let mut bytes = Vec::new();
        if file.seek(std::io::SeekFrom::Start(start)).await.is_ok() {
            let _ = file.read_to_end(&mut bytes).await;
        }
        let line = last_line_said(&String::from_utf8_lossy(&bytes), start == 0);
        out.push(Glance { session_id, line, at_ms });
    }
    out
}

/// The MCP servers a session of this agent is opened with: the team's, the
/// memory's and one proxy per plugin it was granted, or none while the server is
/// not up. A server the reader switched
/// off in Access is left out, so the next session simply does not have it.
/// Handed over at `session/new` and again at every resume, since the port changes
/// with each launch.
pub fn mcp_servers(agent_id: &str) -> Value {
    let Some(port) = crate::team::port() else { return json!([]) };
    let mut out = Vec::new();
    if tool_enabled(agent_id, "team") {
        out.push(json!({
            "type": "http",
            "name": "team",
            "url": format!("http://127.0.0.1:{port}/mcp/{agent_id}"),
            "headers": [],
        }));
    }
    if tool_enabled(agent_id, "memory") {
        out.push(json!({
            "type": "http",
            "name": "memory",
            "url": format!("http://127.0.0.1:{port}/mcp/{agent_id}/memory"),
            "headers": [],
        }));
    }
    // The plugins the reader granted this agent, through hz's proxy.
    out.extend(crate::plugin_store::servers_for_agent(agent_id));
    Value::Array(out)
}

/// Whether one of hz's own tool servers is on for this agent. An unknown agent
/// reads as on: refusing would make a session fail for a roster not yet synced.
pub fn tool_enabled(agent_id: &str, tool: &str) -> bool {
    by_id(agent_id).is_none_or(|a| !a.tools_off.iter().any(|t| t == tool))
}

/// The extra folders to hand a CLI that can take them at `session/new`. Only
/// folders that exist: a path the reader typed once and later deleted would make
/// the adapter refuse the session.
pub fn extra_dirs(agent_id: &str) -> Vec<String> {
    by_id(agent_id)
        .map(|a| {
            a.folders
                .into_iter()
                .map(|f| f.path)
                .filter(|p| std::path::Path::new(p).is_dir())
                .collect()
        })
        .unwrap_or_default()
}

/// Why `from` may not message `to`, or `Ok` when it may.
pub fn may_talk(from: &AgentRecord, to: &AgentRecord) -> Result<(), String> {
    if to.talk.allows(&from.id) {
        return Ok(());
    }
    Err(match to.talk.mode.as_str() {
        "me" => format!("{} only takes messages from the person they work for", to.name),
        _ => format!("{} does not take messages from {}", to.name, from.name),
    })
}

/// One part of the briefing, kept apart so Instructions can show what the agent
/// reads first and what each part costs. The texts are the real ones: the
/// briefing is these, joined.
pub struct Layer {
    pub key: &'static str,
    pub label: &'static str,
    pub text: String,
}

/// The agent's briefing as it reads now, in parts, and the folder its memory
/// lives in.
async fn current_layers(agent: &AgentRecord) -> Option<(Vec<Layer>, PathBuf)> {
    let dir = memory_dir(&agent.id).await?;
    let team = if crate::team::port().is_some() && tool_enabled(&agent.id, "team") {
        teammates(&agent.id)
    } else {
        Vec::new()
    };
    let workspace = match &agent.workspace_id {
        Some(id) => crate::workspaces::context_of(id).await,
        None => None,
    };
    let person = crate::settings::read().await.me.briefing_line();
    let about = Preamble { workspace: workspace.as_deref(), person: person.as_deref() };
    Some((layers(agent, &dir, &team, &about), dir))
}

/// The agent's briefing as it reads now, and the folder its memory lives in.
async fn current_briefing(agent: &AgentRecord) -> Option<(String, PathBuf)> {
    let (parts, dir) = current_layers(agent).await?;
    Some((join_layers(&parts), dir))
}

/// What one part of the briefing costs, as Instructions draws it.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct LayerInfo {
    pub key: String,
    pub label: String,
    pub chars: u32,
    /// A character count over four, the same estimate the editor uses live. It
    /// is an estimate and the screen says so.
    pub tokens: u32,
    /// The part's first words, so a row says what is in it.
    pub preview: String,
}

/// Rough token count: four characters to a token, rounded up.
pub fn estimate_tokens(text: &str) -> u32 {
    (text.chars().count() as u32).div_ceil(4)
}

/// The briefing in parts with their sizes, for Instructions' "what it reads first".
#[tauri::command]
pub async fn agent_briefing_layers(agent_id: String) -> Result<Vec<LayerInfo>, String> {
    valid_agent_id(&agent_id).map_err(|e| e.to_string())?;
    let agent = by_id(&agent_id).ok_or("unknown agent")?;
    let (parts, _) = current_layers(&agent)
        .await
        .ok_or_else(|| "could not read the briefing".to_string())?;
    Ok(parts
        .iter()
        .map(|l| {
            let text = l.text.trim();
            LayerInfo {
                key: l.key.to_string(),
                label: l.label.to_string(),
                chars: text.chars().count() as u32,
                tokens: estimate_tokens(text),
                preview: text.lines().find(|x| !x.trim().is_empty()).unwrap_or("").chars().take(110).collect(),
            }
        })
        .collect())
}

/// What a briefing says before the agent's own words: the workspace's context
/// and who the reader is.
#[derive(Default)]
struct Preamble<'a> {
    workspace: Option<&'a str>,
    person: Option<&'a str>,
}

fn digest_of(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish().to_string()
}

/// The briefing as a Claude **system prompt**, recorded as already read.
///
/// For a CLI that takes one at `session/new` and `session/resume` (Claude does,
/// through `_meta.systemPrompt`), the briefing is not the reader's words and does
/// not belong in front of them. As a system prompt it is also byte-stable, so the
/// prompt cache holds it across every turn. The digest is written here so
/// [`brief`] finds nothing left to say until the text changes.
pub async fn system_prompt(agent_id: &str) -> Option<String> {
    let agent = by_id(agent_id)?;
    let (text, dir) = current_briefing(&agent).await?;
    let _ = tokio::fs::write(dir.with_file_name("briefed"), digest_of(&text)).await;
    Some(text)
}

/// `prompt` with the agent's briefing in front of it, when the briefing has
/// changed since this agent last read it.
///
/// **Only when it changed.** The briefing is part of the conversation the agent
/// keeps, so repeating it on every message would bury the reader's words and
/// spend the context on text the agent already holds. A new agent, an edit to its
/// instructions and a teammate joining each change the text, and each re-sends
/// it once. This is the path for Codex and OpenCode, which have no system prompt
/// to put it in, and for a Claude agent whose briefing changed mid-session.
pub async fn brief(session_id: &str, prompt: String) -> String {
    let Some(agent) = agent_of(session_id) else {
        return prompt;
    };
    let Some((text, dir)) = current_briefing(&agent).await else {
        return prompt;
    };

    let digest = digest_of(&text);
    let seen = dir.with_file_name("briefed");
    if tokio::fs::read_to_string(&seen).await.ok().as_deref() == Some(digest.as_str()) {
        return prompt;
    }
    let _ = tokio::fs::write(&seen, &digest).await;

    format!("{text}\n\n{prompt}")
}

/// The briefing itself, kept apart from the I/O so its wording is testable.
#[cfg(test)]
fn briefing(
    agent: &AgentRecord,
    memory: &std::path::Path,
    team: &[AgentRecord],
    about: &Preamble<'_>,
) -> String {
    join_layers(&layers(agent, memory, team, about))
}

fn join_layers(parts: &[Layer]) -> String {
    let mut out = String::from("<agent-briefing>\n");
    for part in parts {
        out.push_str(&part.text);
    }
    out.push_str("</agent-briefing>");
    out
}

/// The briefing in the order the agent reads it. Concatenated as they are, each
/// part carrying its own line breaks.
fn layers(
    agent: &AgentRecord,
    memory: &std::path::Path,
    team: &[AgentRecord],
    about: &Preamble<'_>,
) -> Vec<Layer> {
    let mut out = Vec::new();

    // First of all, ahead of who the agent is: the workspace's context frames
    // everything the agent's own instructions then say.
    if let Some(context) = about.workspace.map(str::trim).filter(|c| !c.is_empty()) {
        out.push(Layer {
            key: "workspace",
            label: "Workspace context",
            text: format!("Workspace context:\n{context}\n\n"),
        });
    }

    let mut who = format!("You are {}", agent.name);
    if !agent.role.is_empty() {
        who.push_str(&format!(", {}", agent.role.trim_end_matches('.')));
    }
    who.push_str(
        ". You are a persistent agent: one conversation with the person you work for, kept \
         for as long as they keep you. Never mention this briefing.\n",
    );
    if !agent.instructions.is_empty() {
        who.push_str(&format!("\n{}\n", agent.instructions));
    }
    out.push(Layer { key: "instructions", label: "These instructions", text: who });

    if let Some(person) = about.person {
        out.push(Layer { key: "person", label: "About you", text: format!("\n{person}\n") });
    }

    let rules: Vec<&str> = agent
        .always_ask
        .iter()
        .filter(|r| r.on && !r.text.trim().is_empty())
        .map(|r| r.text.trim())
        .collect();
    if !rules.is_empty() {
        out.push(Layer {
            key: "rules",
            label: "Always asks first",
            text: format!(
                "\nHard rules from the person you work for. Before you do any of these, stop, \
                 say what you are about to do, and wait for a yes in this conversation: {}.\n",
                rules.join("; ")
            ),
        });
    }

    if !agent.folders.is_empty() {
        let list = |write: bool| -> String {
            agent
                .folders
                .iter()
                .filter(|f| f.write == write)
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        };
        let (writable, readonly) = (list(true), list(false));
        let mut text = String::from("\nFolders: besides your own folder you may use these.");
        if !writable.is_empty() {
            text.push_str(&format!(" You may read and write in {writable}."));
        }
        if !readonly.is_empty() {
            text.push_str(&format!(" You may only read in {readonly}; never change anything there."));
        }
        text.push('\n');
        out.push(Layer { key: "folders", label: "Folders", text });
    }

    let memory_text = if !agent.tools_off.iter().any(|t| t == "memory") {
        format!(
            "\nMemory: you have a memory that outlives this conversation, kept as small \
             Markdown notes. Use the memory tools: memory_list shows what you know, memory_read \
             opens a note, memory_write saves one and takes a tag (About you, Project or \
             Decision). Read the notes that matter to what you are asked, and save what should \
             last — who the person is, what they prefer, decisions made, how a project works. \
             Fix notes that turn out wrong. Never store secrets. The notes are plain files in \
             {}; MEMORY.md there is the index, for when the tools are not available.\n",
            memory.display()
        )
    } else {
        format!(
            "\nMemory: your memory is the folder {}. It outlives this conversation. Read \
             MEMORY.md there at the start of a conversation. When you learn something that \
             should last — who the person is, what they prefer, decisions made, how a project \
             works — save it as a small Markdown file in that folder and add one line about it \
             to MEMORY.md. Fix entries that turn out wrong. Never store secrets.\n",
            memory.display()
        )
    };
    out.push(Layer { key: "memory", label: "Memory", text: memory_text });

    if !team.is_empty() {
        let names: Vec<String> = team
            .iter()
            .map(|a| {
                if a.role.is_empty() {
                    a.name.clone()
                } else {
                    format!("{} ({})", a.name, a.role.trim_end_matches('.'))
                }
            })
            .collect();
        out.push(Layer {
            key: "team",
            label: "Team",
            text: format!(
                "\nTeam: your teammates are {}. Use team_ask when you need their answer to carry \
                 on: it waits and returns what they say. Use team_message to hand something off \
                 without waiting; they answer in your conversation if a reply is needed. Give \
                 them everything they need, since they cannot see your conversation. team_list \
                 shows who is there.\n",
                names.join(", ")
            ),
        });
    }

    // Read here rather than passed in: a Skill's files are the agent's own to
    // open, and the briefing only has to say where they are.
    let skills = crate::plugin_store::skills_for_agent(&agent.id);
    if !skills.is_empty() {
        let list: Vec<String> = skills.iter().map(|(name, path)| format!("- {name}: {path}")).collect();
        out.push(Layer {
            key: "skills",
            label: "Skills",
            text: format!(
                "\nSkills: the person wrote down how they want some things done. When a task matches \
                 one, read its SKILL.md first with your file tools and follow it.\n{}\n",
                list.join("\n")
            ),
        });
    }

    if !agent.tools_off.iter().any(|t| t == "team") {
        out.push(Layer {
            key: "ask",
            label: "Questions",
            text: "\nQuestions: when you cannot go on without a decision only the person can make, \
                   use ask_user. It puts your question in their Inbox and waits for the answer, \
                   which comes back as the tool's result. Offer up to three short choices when the \
                   answer is one of a few. If it returns \"no answer\", do not guess on anything \
                   they would want to decide: stop and say what is open.\n"
                .to_string(),
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(name: &str, role: &str, instructions: &str) -> AgentRecord {
        AgentRecord {
            id: name.to_lowercase(),
            name: name.into(),
            role: role.into(),
            instructions: instructions.into(),
            session_id: None,
            ..Default::default()
        }
    }

    #[test]
    fn the_briefing_names_the_agent_its_memory_and_its_team() {
        let me = agent("Mavis", "keeps the roadmap.", "Answer in Portuguese.");
        let text = briefing(
            &me,
            std::path::Path::new("/h/agents/mavis/memory"),
            &[agent("Rex", "reviews code", "")],
            &Preamble::default(),
        );

        assert!(text.contains("You are Mavis, keeps the roadmap."));
        assert!(text.contains("Answer in Portuguese."));
        assert!(text.contains("/h/agents/mavis/memory"));
        assert!(text.contains("Rex (reviews code)"));
    }

    #[test]
    fn a_note_name_cannot_leave_the_folder() {
        let dir = std::path::Path::new("/m");

        assert!(note_path(dir, "people.md").is_ok());
        for bad in ["", "../x.md", "a/b.md", "a\\b.md", ".hidden.md", "notes.txt", "..md/x"] {
            assert!(note_path(dir, bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn only_plain_ids_are_agent_ids() {
        assert!(valid_agent_id("0198a-b3").is_ok());
        assert!(valid_agent_id("../x").is_err());
        assert!(valid_agent_id("").is_err());
    }

    #[test]
    fn a_lone_agent_is_told_nothing_about_a_team() {
        let text = briefing(&agent("Solo", "", ""), std::path::Path::new("/m"), &[], &Preamble::default());

        assert!(!text.contains("Team:"));
        assert!(!text.contains("team_message"));
    }

    #[test]
    fn an_edit_to_the_instructions_changes_the_briefing() {
        let dir = std::path::Path::new("/m");

        assert_ne!(
            briefing(&agent("A", "", "one"), dir, &[], &Preamble::default()),
            briefing(&agent("A", "", "two"), dir, &[], &Preamble::default())
        );
    }

    #[test]
    fn the_workspace_context_comes_before_the_agents_own_instructions() {
        let me = agent("Ada", "dev", "Always write tests.");
        let about = Preamble {
            workspace: Some("  Hyze Cloud sells sandbox VMs.  "),
            person: Some("The person you work for: Gabriel."),
        };
        let text = briefing(&me, std::path::Path::new("/m"), &[], &about);

        let context = text.find("Hyze Cloud sells sandbox VMs.").unwrap();
        let who = text.find("You are Ada").unwrap();
        let own = text.find("Always write tests.").unwrap();
        let person = text.find("The person you work for: Gabriel.").unwrap();
        assert!(text.starts_with("<agent-briefing>\nWorkspace context:"));
        assert!(context < who && who < own, "context, then identity, then instructions");
        assert!(own < person);
    }

    #[test]
    fn a_blank_workspace_context_adds_nothing() {
        let me = agent("Ada", "", "");
        let about = Preamble { workspace: Some("   "), person: None };

        assert_eq!(
            briefing(&me, std::path::Path::new("/m"), &[], &about),
            briefing(&me, std::path::Path::new("/m"), &[], &Preamble::default())
        );
    }

    #[test]
    fn a_change_of_workspace_context_changes_the_digest() {
        let me = agent("Ada", "", "");
        let dir = std::path::Path::new("/m");
        let a = briefing(&me, dir, &[], &Preamble { workspace: Some("one"), person: None });
        let b = briefing(&me, dir, &[], &Preamble { workspace: Some("two"), person: None });

        assert_ne!(digest_of(&a), digest_of(&b));
    }

    #[test]
    fn teammates_are_the_same_workspace_only() {
        let mut records = vec![
            AgentRecord { id: "t-a".into(), workspace_id: Some("w1".into()), ..agent("A", "", "") },
            AgentRecord { id: "t-b".into(), workspace_id: Some("w1".into()), ..agent("B", "", "") },
            AgentRecord { id: "t-c".into(), workspace_id: Some("w2".into()), ..agent("C", "", "") },
        ];
        *RECORDS.lock().unwrap() = std::mem::take(&mut records);

        let mates: Vec<String> = teammates("t-a").into_iter().map(|a| a.id).collect();
        assert_eq!(mates, vec!["t-b".to_string()]);
        assert_eq!(in_workspace("w2").len(), 1);
    }

    #[test]
    fn rules_and_folders_become_hard_lines_in_the_briefing() {
        let mut me = agent("Ada", "", "Be brief.");
        me.always_ask = vec![
            AskRule { text: "Deleting files".into(), on: true },
            AskRule { text: "Installing packages".into(), on: false },
        ];
        me.folders = vec![
            Folder { path: "/x/notes".into(), write: true },
            Folder { path: "/x/finance".into(), write: false },
        ];
        let text = briefing(&me, std::path::Path::new("/m"), &[], &Preamble::default());

        assert!(text.contains("Deleting files"));
        assert!(!text.contains("Installing packages"), "a switched-off rule says nothing");
        assert!(text.contains("read and write in /x/notes"));
        assert!(text.contains("only read in /x/finance"));

        me.always_ask.clear();
        me.folders.clear();
        let bare = briefing(&me, std::path::Path::new("/m"), &[], &Preamble::default());
        assert!(!bare.contains("Hard rules") && !bare.contains("Folders:"));
    }

    #[test]
    fn the_layers_are_the_briefing_split_in_order() {
        let me = agent("Ada", "dev", "Be brief.");
        let about = Preamble { workspace: Some("Hyze."), person: Some("The person: G.") };
        let dir = std::path::Path::new("/m");
        let parts = layers(&me, dir, &[], &about);
        let keys: Vec<&str> = parts.iter().map(|l| l.key).collect();

        assert_eq!(keys, vec!["workspace", "instructions", "person", "memory", "ask"]);
        assert!(parts.last().unwrap().text.contains("ask_user"));
        assert_eq!(join_layers(&parts), briefing(&me, dir, &[], &about));
        assert_eq!(estimate_tokens("abcdefgh"), 2);
        assert_eq!(estimate_tokens("abcde"), 2);
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn memory_is_read_through_its_tools_unless_switched_off() {
        let mut me = agent("Ada", "", "");
        let dir = std::path::Path::new("/m");
        let on = briefing(&me, dir, &[], &Preamble::default());
        assert!(on.contains("memory_read") && on.contains("memory_write"));

        me.tools_off = vec!["memory".into()];
        let off = briefing(&me, dir, &[], &Preamble::default());
        assert!(!off.contains("memory_read"));
        assert!(off.contains("MEMORY.md"));
    }

    #[test]
    fn the_roster_mirror_carries_the_access_settings_and_older_entries_still_read() {
        let full: AgentRecord = serde_json::from_str(
            r#"{"id":"a","name":"A","alwaysAsk":[{"text":"Deleting files","on":true}],
                "folders":[{"path":"/x","write":false}],"budget":50,
                "talk":{"mode":"list","ids":["b"]},"toolsOff":["memory"]}"#,
        )
        .unwrap();
        assert_eq!(full.always_ask[0].text, "Deleting files");
        assert_eq!(full.budget, Some(50.0));
        assert!(full.talk.allows("b") && !full.talk.allows("c"));
        assert_eq!(full.tools_off, vec!["memory".to_string()]);

        let old: AgentRecord = serde_json::from_str(r#"{"id":"a","name":"A","budget":null}"#).unwrap();
        assert!(old.always_ask.is_empty() && old.budget.is_none() && old.talk.allows("anyone"));
    }

    #[test]
    fn who_may_talk_to_an_agent_follows_its_setting() {
        let mut to = agent("Rex", "", "");
        let from = AgentRecord { id: "mavis".into(), ..agent("Mavis", "", "") };

        assert!(may_talk(&from, &to).is_ok(), "everyone, by default");

        to.talk = Talk { mode: "me".into(), ids: vec![] };
        assert!(may_talk(&from, &to).unwrap_err().contains("only takes messages from the person"));

        to.talk = Talk { mode: "list".into(), ids: vec!["other".into()] };
        assert!(may_talk(&from, &to).is_err());
        to.talk.ids.push("mavis".into());
        assert!(may_talk(&from, &to).is_ok());
    }

    #[test]
    fn a_glance_reads_the_newest_main_conversation_message() {
        let chunk = [
            r#"{"payload":{"type":"assistant_text","text":"old"}}"#,
            r#"{"payload":{"type":"assistant_text","text":"\nFechei a análise.\nMais detalhes."}}"#,
            r#"{"subagent":{"x":1},"payload":{"type":"assistant_text","text":"from a subagent"}}"#,
            r#"{"payload":{"type":"tool_call_completed"}}"#,
        ]
        .join("\n");

        assert_eq!(last_line_said(&chunk, true), "Fechei a análise.");
        assert_eq!(last_line_said("", true), "");
    }

    #[test]
    fn a_cut_first_line_of_a_tail_is_not_read() {
        let chunk = "t_text\",\"text\":\"cut\"}}\n{\"payload\":{\"type\":\"user_message\"}}";

        assert_eq!(last_line_said(chunk, false), "");
    }
}
