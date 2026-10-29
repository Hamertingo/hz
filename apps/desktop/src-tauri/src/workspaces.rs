//! Workspaces: a team of agents with a context of its own.
//!
//! A workspace is the unit a reader switches between. Its agents never see
//! another workspace's (the team tools filter on it), and its `context` goes in
//! front of every one of those agents' briefings. The records live in
//! `~/.hz/workspaces.json`; a logo, when one is uploaded, is a file under
//! `~/.hz/workspaces/<id>/`.

use std::{
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex as StdMutex},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::store::{get_home_app_dir, read_json, write_atomic};

/// Someone who can talk to a workspace's agents besides its owner. Held so the
/// record has its shape before invites exist (they wait on team sync).
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub name: String,
    #[serde(default)]
    pub pending: bool,
}

/// What a workspace's agents start with and how they behave together: the
/// Settings → Agent defaults and Usage & limits pages.
///
/// One struct so the page writes it whole and every reader (the new-agent card,
/// the team server, the nightly tidy, the limit fallback, the budget) takes the
/// same snapshot. Every field defaults, so a workspace written by an older build
/// reads as the defaults.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceDefaults {
    /// The CLI a new agent runs on, by harness wire name. `None` is "the first
    /// one installed".
    pub harness: Option<String>,
    /// The stance a new agent starts in (`plan`, `manual`, `auto`,
    /// `bypassPermissions`). `None` is `auto`.
    pub permission: Option<String>,
    /// Where a new agent works unless the card says otherwise.
    pub folder: Option<String>,
    pub say_hello: bool,
    /// Ask every agent to tidy its memory once a night.
    pub tidy: bool,
    /// `HH:MM`, local time.
    pub tidy_time: String,
    /// A memory folder every agent in the workspace can read and write.
    pub shared_memory: bool,
    /// How many hops one conversation between agents may take: each message and
    /// each answer is one (`talk.rs`).
    pub handoffs: u32,
    /// Kept so saved files still read. Nothing waits on a teammate any more:
    /// `team_message` returns at once and the answer wakes the sender.
    pub wait_mins: u32,
    /// `wait`, `move` (resend on the fallback CLI) or `ask` (raise a question).
    pub on_limit: String,
    /// The CLI `move` resends to, by harness wire name.
    pub fallback_harness: String,
    /// The month's budget for the whole workspace, in US dollars.
    pub budget_usd: Option<f64>,
    /// `pause`, `ask` or `go`: what happens when the month reaches the budget.
    pub budget_action: String,
    /// The percentage of the budget that raises a warning.
    pub alert_pct: u32,
    /// Above this one turn stops the agent and asks.
    pub task_cap_usd: Option<f64>,
    /// The plan the reader says each CLI is on, by harness wire name. Only used
    /// to size an *estimated* window where the CLI reports no real one.
    pub plans: std::collections::BTreeMap<String, String>,
}

impl Default for WorkspaceDefaults {
    fn default() -> Self {
        Self {
            harness: None,
            permission: None,
            folder: None,
            say_hello: true,
            tidy: false,
            tidy_time: "03:00".into(),
            shared_memory: false,
            handoffs: 4,
            wait_mins: 10,
            on_limit: "ask".into(),
            fallback_harness: "codex-acp".into(),
            budget_usd: None,
            budget_action: "ask".into(),
            alert_pct: 80,
            task_cap_usd: None,
            plans: Default::default(),
        }
    }
}

/// One workspace as stored.
#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// The letter (or two) drawn on the generated logo.
    pub mark: String,
    pub color: String,
    /// Absolute path of the uploaded logo, or `None` for the generated one.
    #[serde(default)]
    pub logo: Option<String>,
    /// Put in front of every agent's briefing, ahead of the agent's own words.
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub members: Vec<Member>,
    #[serde(default)]
    pub defaults: WorkspaceDefaults,
    /// Agent ids in the order the reader dragged the sidebar into. Ids it does
    /// not name keep their natural place after these.
    #[serde(default)]
    pub agent_order: Vec<String>,
    /// The same for the channels list.
    #[serde(default)]
    pub channel_order: Vec<String>,
    /// Which sidebar section comes first: a permutation of `channels` and
    /// `agents`. A workspace from before this field reads as channels first.
    #[serde(default = "default_sections")]
    pub section_order: Vec<String>,
}

fn default_sections() -> Vec<String> {
    vec!["channels".into(), "agents".into()]
}

/// A section order as stored: it must name `channels` and `agents` once each,
/// else the default stands, so a bad write cannot hide a section.
pub fn normalize_sections(order: Vec<String>) -> Vec<String> {
    let mut sorted = order.clone();
    sorted.sort();
    if sorted == ["agents", "channels"] { order } else { default_sections() }
}

/// The fields an edit may change. A field left out is left alone.
#[derive(Clone, Debug, Default, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePatch {
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub color: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub context: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct File {
    #[serde(default)]
    workspaces: Vec<Workspace>,
}

/// What the briefing and the team tools read, so neither waits on the disk.
static CACHE: LazyLock<StdMutex<Vec<Workspace>>> = LazyLock::new(Default::default);

/// Serializes writers: the file is rewritten whole.
static WRITE: Mutex<()> = Mutex::const_new(());

const COLORS: [&str; 8] = [
    "#e2a440", "#e2814a", "#df6f86", "#9a87ea", "#6a8cf0", "#4fb0c4", "#55b884", "#9198a8",
];

/// Images only, and small: the logo is drawn at 72px at most.
const LOGO_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];
const LOGO_MAX_BYTES: u64 = 5 * 1024 * 1024;

fn file_path(home: &Path) -> PathBuf {
    home.join("workspaces.json")
}

fn dir_of(home: &Path, id: &str) -> PathBuf {
    home.join("workspaces").join(id)
}

/// A workspace id that is only an id, since it ends up in a path.
fn valid_id(id: &str) -> Result<(), String> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        Ok(())
    } else {
        Err("not a workspace id".into())
    }
}

fn mark_of(name: &str) -> String {
    name.trim()
        .chars()
        .next()
        .map_or_else(|| "W".to_string(), |c| c.to_uppercase().collect())
}

fn valid_color(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// The name for the workspace an existing install is moved into: the folder most
/// of its agents work in, or "My workspace" when none names one.
///
/// A reader who made agents before workspaces existed has no workspace to put
/// them in, and a bare "Default" would say nothing about whose team it is.
pub fn default_name(project_paths: &[String]) -> String {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for path in project_paths {
        let Some(name) = Path::new(path.trim_end_matches('/'))
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .filter(|n| !n.is_empty())
        else {
            continue;
        };
        match counts.iter_mut().find(|(n, _)| *n == name) {
            Some((_, c)) => *c += 1,
            None => counts.push((name, 1)),
        }
    }
    // `max_by_key` keeps the last of equal maxima; reversing makes the first
    // folder seen win a tie, which is the oldest agent's.
    counts
        .into_iter()
        .rev()
        .max_by_key(|(_, c)| *c)
        .map_or_else(|| "My workspace".to_string(), |(n, _)| n)
}

/// Gives every agent without a workspace to `default_id`, and drops the roster's
/// old `space` field from all of them. Answers whether anything changed.
///
/// The roster is raw JSON because the webview owns its shape; only these two
/// keys are this file's business.
pub fn migrate_agents(agents: &mut [Value], default_id: &str) -> bool {
    let mut changed = false;
    for agent in agents {
        let Some(map) = agent.as_object_mut() else { continue };
        if map.remove("space").is_some() {
            changed = true;
        }
        let missing = map
            .get("workspaceId")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty);
        if missing {
            map.insert("workspaceId".into(), Value::String(default_id.to_string()));
            changed = true;
        }
    }
    changed
}

fn new_workspace(name: &str, color: &str, context: &str) -> Workspace {
    Workspace {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        mark: mark_of(name),
        color: color.to_string(),
        logo: None,
        context: context.to_string(),
        members: Vec::new(),
        defaults: WorkspaceDefaults::default(),
        agent_order: Vec::new(),
        channel_order: Vec::new(),
        section_order: default_sections(),
    }
}

/// An order as stored: blanks and repeats dropped, first mention wins, capped so
/// a bad caller cannot grow the file without bound.
pub fn normalize_order(order: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    order
        .into_iter()
        .filter(|id| !id.trim().is_empty() && seen.insert(id.clone()))
        .take(1000)
        .collect()
}

async fn read_all(home: &Path) -> anyhow::Result<Vec<Workspace>> {
    Ok(read_json::<File>(&file_path(home)).await?.workspaces)
}

async fn write_all(home: &Path, workspaces: &[Workspace]) -> anyhow::Result<()> {
    let file = File { workspaces: workspaces.to_vec() };
    write_atomic(&file_path(home), serde_json::to_string_pretty(&file)?).await?;
    *CACHE.lock().expect("workspace cache poisoned") = workspaces.to_vec();
    Ok(())
}

/// Reads the file once, making the default workspace (and moving the roster on
/// disk into it) on an install that has none.
async fn load(home: &Path) -> anyhow::Result<Vec<Workspace>> {
    let mut all = read_all(home).await?;
    if !all.is_empty() {
        *CACHE.lock().expect("workspace cache poisoned") = all.clone();
        return Ok(all);
    }

    let roster_path = home.join("agents.json");
    let mut roster: Vec<Value> = tokio::fs::read_to_string(&roster_path)
        .await
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let folders: Vec<String> = roster
        .iter()
        .filter_map(|a| a.get("projectPath").and_then(Value::as_str).map(str::to_string))
        .collect();

    let ws = new_workspace(&default_name(&folders), COLORS[4], "");
    if migrate_agents(&mut roster, &ws.id) {
        write_atomic(&roster_path, serde_json::to_string_pretty(&roster)?).await?;
    }
    all.push(ws);
    write_all(home, &all).await?;
    Ok(all)
}

/// The workspaces as the briefing sees them, or none before the first load.
pub fn cached() -> Vec<Workspace> {
    CACHE.lock().expect("workspace cache poisoned").clone()
}

/// A workspace's defaults from the cache, or the stock ones for an id nobody
/// loaded. Sync, because the team server and the budget read it mid-request.
pub fn defaults_of(id: &str) -> WorkspaceDefaults {
    cached().into_iter().find(|w| w.id == id).map(|w| w.defaults).unwrap_or_default()
}

/// The defaults of the first workspace, for the places that run before any
/// agent says which one it belongs to.
pub fn first_defaults() -> WorkspaceDefaults {
    cached().into_iter().next().map(|w| w.defaults).unwrap_or_default()
}

/// Replaces a workspace's defaults. The page sends the whole struct, so a field
/// it does not know about cannot be half-written.
#[tauri::command]
pub async fn workspace_set_defaults(id: String, defaults: WorkspaceDefaults) -> Result<Workspace, String> {
    valid_id(&id)?;
    let _guard = WRITE.lock().await;
    let home = get_home_app_dir().await.map_err(|e| format!("{e:#}"))?;
    let mut all = load(&home).await.map_err(|e| format!("{e:#}"))?;
    let ws = all.iter_mut().find(|w| w.id == id).ok_or("no such workspace")?;

    let mut next = defaults;
    next.handoffs = next.handoffs.clamp(1, 50);
    next.wait_mins = next.wait_mins.clamp(1, 240);
    next.alert_pct = next.alert_pct.clamp(1, 100);
    if crate::studio::parse_hhmm(&next.tidy_time).is_none() {
        next.tidy_time = "03:00".into();
    }
    ws.defaults = next;
    let out = ws.clone();
    write_all(&home, &all).await.map_err(|e| format!("{e:#}"))?;
    Ok(out)
}

/// Saves the sidebar order a drag (or Pin to top, or Move up) produced: `kind`
/// is `agents` or `channels`. The webview sends the whole list, so a move is one
/// write and two quick drags cannot interleave into a half order.
#[tauri::command]
pub async fn workspace_set_order(id: String, kind: String, order: Vec<String>) -> Result<Workspace, String> {
    valid_id(&id)?;
    let _guard = WRITE.lock().await;
    let home = get_home_app_dir().await.map_err(|e| format!("{e:#}"))?;
    let mut all = load(&home).await.map_err(|e| format!("{e:#}"))?;
    let ws = all.iter_mut().find(|w| w.id == id).ok_or("no such workspace")?;

    if kind == "sections" {
        ws.section_order = normalize_sections(order);
        let out = ws.clone();
        write_all(&home, &all).await.map_err(|e| format!("{e:#}"))?;
        return Ok(out);
    }
    let order = normalize_order(order);
    match kind.as_str() {
        "agents" => ws.agent_order = order,
        "channels" => ws.channel_order = order,
        _ => return Err("order is for agents, channels or sections".into()),
    }
    let out = ws.clone();
    write_all(&home, &all).await.map_err(|e| format!("{e:#}"))?;
    Ok(out)
}

/// The context of one workspace, for the front of an agent's briefing.
pub async fn context_of(id: &str) -> Option<String> {
    if cached().is_empty() {
        let home = get_home_app_dir().await.ok()?;
        load(&home).await.ok()?;
    }
    cached()
        .into_iter()
        .find(|w| w.id == id)
        .map(|w| w.context)
        .filter(|c| !c.trim().is_empty())
}

/// Every workspace, making the first one on a fresh or pre-workspace install.
#[tauri::command]
pub async fn workspaces_list() -> Result<Vec<Workspace>, String> {
    let _guard = WRITE.lock().await;
    let home = get_home_app_dir().await.map_err(|e| format!("{e:#}"))?;
    load(&home).await.map_err(|e| format!("{e:#}"))
}

/// Makes a workspace. An empty name is refused; a colour that is not `#rrggbb`
/// falls back to the first of the palette.
#[tauri::command]
pub async fn workspace_create(
    name: String,
    color: String,
    context: String,
) -> Result<Workspace, String> {
    if name.trim().is_empty() {
        return Err("a workspace needs a name".into());
    }
    let _guard = WRITE.lock().await;
    let home = get_home_app_dir().await.map_err(|e| format!("{e:#}"))?;
    let mut all = load(&home).await.map_err(|e| format!("{e:#}"))?;

    let color = if valid_color(&color) { color } else { COLORS[0].to_string() };
    let ws = new_workspace(&name, &color, &context);
    all.push(ws.clone());
    write_all(&home, &all).await.map_err(|e| format!("{e:#}"))?;
    Ok(ws)
}

/// Changes a workspace's name, colour or context. A rename also moves the mark,
/// so the generated logo keeps spelling the name.
#[tauri::command]
pub async fn workspace_update(id: String, patch: WorkspacePatch) -> Result<Workspace, String> {
    valid_id(&id)?;
    let _guard = WRITE.lock().await;
    let home = get_home_app_dir().await.map_err(|e| format!("{e:#}"))?;
    let mut all = load(&home).await.map_err(|e| format!("{e:#}"))?;
    let ws = all.iter_mut().find(|w| w.id == id).ok_or("no such workspace")?;

    if let Some(name) = patch.name {
        let name = name.trim();
        if !name.is_empty() {
            ws.name = name.to_string();
            ws.mark = mark_of(name);
        }
    }
    if let Some(color) = patch.color.filter(|c| valid_color(c)) {
        ws.color = color;
    }
    if let Some(context) = patch.context {
        ws.context = context;
    }
    let out = ws.clone();
    write_all(&home, &all).await.map_err(|e| format!("{e:#}"))?;
    Ok(out)
}

/// Deletes a workspace, its logo and the memory of the agents in it.
///
/// The last workspace cannot go: with none, there is nowhere to put the next
/// agent. Conversation files are never touched; they belong to the sessions.
#[tauri::command]
pub async fn workspace_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    valid_id(&id)?;
    let _guard = WRITE.lock().await;
    let home = get_home_app_dir().await.map_err(|e| format!("{e:#}"))?;
    let mut all = load(&home).await.map_err(|e| format!("{e:#}"))?;

    if all.len() <= 1 {
        return Err("keep at least one workspace".into());
    }
    if !all.iter().any(|w| w.id == id) {
        return Err("no such workspace".into());
    }

    for agent in crate::agents::in_workspace(&id) {
        let _ = tokio::fs::remove_dir_all(home.join("agents").join(&agent.id)).await;
    }
    all.retain(|w| w.id != id);
    write_all(&home, &all).await.map_err(|e| format!("{e:#}"))?;
    let _ = tokio::fs::remove_dir_all(dir_of(&home, &id)).await;
    crate::channels::drop_workspace(&app, &id).await;
    Ok(())
}

/// Copies an image the reader picked in as the workspace's logo.
///
/// The file is copied rather than referenced, so moving or deleting the original
/// leaves the logo alone. Each upload gets its own name, which is what lets the
/// webview cache a logo by path without ever showing a stale one.
#[tauri::command]
pub async fn workspace_set_logo(id: String, source: String) -> Result<Workspace, String> {
    valid_id(&id)?;
    let ext = logo_extension(&source)?;
    let meta = tokio::fs::metadata(&source).await.map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > LOGO_MAX_BYTES {
        return Err("a logo is an image under 5 MB".into());
    }

    let _guard = WRITE.lock().await;
    let home = get_home_app_dir().await.map_err(|e| format!("{e:#}"))?;
    let mut all = load(&home).await.map_err(|e| format!("{e:#}"))?;
    let ws = all.iter_mut().find(|w| w.id == id).ok_or("no such workspace")?;

    let dir = dir_of(&home, &id);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let stamp = chrono_ms();
    let target = dir.join(format!("logo-{stamp}.{ext}"));
    tokio::fs::copy(&source, &target).await.map_err(|e| e.to_string())?;
    if let Some(old) = ws.logo.replace(target.to_string_lossy().into_owned()) {
        let _ = tokio::fs::remove_file(old).await;
    }
    let out = ws.clone();
    write_all(&home, &all).await.map_err(|e| format!("{e:#}"))?;
    Ok(out)
}

/// Goes back to the generated logo, deleting the uploaded file.
#[tauri::command]
pub async fn workspace_clear_logo(id: String) -> Result<Workspace, String> {
    valid_id(&id)?;
    let _guard = WRITE.lock().await;
    let home = get_home_app_dir().await.map_err(|e| format!("{e:#}"))?;
    let mut all = load(&home).await.map_err(|e| format!("{e:#}"))?;
    let ws = all.iter_mut().find(|w| w.id == id).ok_or("no such workspace")?;

    if let Some(old) = ws.logo.take() {
        let _ = tokio::fs::remove_file(old).await;
    }
    let out = ws.clone();
    write_all(&home, &all).await.map_err(|e| format!("{e:#}"))?;
    Ok(out)
}

/// The lower-cased extension of an image path, or why it is not one.
pub fn logo_extension(path: &str) -> Result<String, String> {
    let ext = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if LOGO_EXTENSIONS.contains(&ext.as_str()) {
        Ok(ext)
    } else {
        Err("pick a png, jpg, webp or gif".into())
    }
}

/// Milliseconds since the epoch, for file names that never repeat.
pub fn chrono_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn the_default_workspace_is_named_after_the_busiest_folder() {
        let folders = vec![
            "/Users/a/code/hz".to_string(),
            "/Users/a/code/site/".to_string(),
            "/Users/a/code/hz".to_string(),
        ];

        assert_eq!(default_name(&folders), "hz");
        assert_eq!(default_name(&[]), "My workspace");
        assert_eq!(default_name(&["/".to_string()]), "My workspace");
    }

    #[test]
    fn a_tie_goes_to_the_first_folder_seen() {
        let folders = vec!["/a/one".to_string(), "/a/two".to_string()];

        assert_eq!(default_name(&folders), "one");
    }

    #[test]
    fn migration_files_orphans_and_drops_space() {
        let mut agents = vec![
            json!({"id": "a", "name": "A", "space": "old"}),
            json!({"id": "b", "name": "B", "workspaceId": "keep"}),
            json!({"id": "c", "name": "C", "workspaceId": ""}),
        ];

        assert!(migrate_agents(&mut agents, "ws-1"));
        assert_eq!(agents[0]["workspaceId"], "ws-1");
        assert!(agents[0].get("space").is_none());
        assert_eq!(agents[1]["workspaceId"], "keep");
        assert_eq!(agents[2]["workspaceId"], "ws-1");
    }

    #[test]
    fn migration_is_a_no_op_once_done() {
        let mut agents = vec![json!({"id": "a", "name": "A", "workspaceId": "ws-1"})];

        assert!(!migrate_agents(&mut agents, "ws-2"));
        assert_eq!(agents[0]["workspaceId"], "ws-1");
    }

    #[test]
    fn an_order_loses_blanks_and_repeats() {
        let order = vec!["b".into(), "".into(), "a".into(), "b".into(), " ".into()];

        assert_eq!(normalize_order(order), vec!["b".to_string(), "a".to_string()]);
    }

    #[test]
    fn section_order_must_name_both_sections_once() {
        let flipped = vec!["agents".to_string(), "channels".to_string()];

        assert_eq!(normalize_sections(flipped.clone()), flipped);
        assert_eq!(normalize_sections(vec!["agents".into()]), default_sections());
        assert_eq!(normalize_sections(vec!["agents".into(), "agents".into()]), default_sections());
        assert_eq!(normalize_sections(vec![]), default_sections());
    }

    #[test]
    fn an_old_workspace_reads_channels_first() {
        let old = r##"{"id":"w","name":"W","mark":"W","color":"#6a8cf0"}"##;
        let ws: Workspace = serde_json::from_str(old).unwrap();

        assert_eq!(ws.section_order, default_sections());
    }

    #[test]
    fn a_workspace_from_before_orders_reads_with_none() {
        let old = r##"{"id":"w","name":"W","mark":"W","color":"#6a8cf0"}"##;
        let ws: Workspace = serde_json::from_str(old).unwrap();

        assert!(ws.agent_order.is_empty() && ws.channel_order.is_empty());
        let back = serde_json::to_value(&ws).unwrap();
        assert_eq!(back["agentOrder"], json!([]));
    }

    #[tokio::test]
    async fn an_order_is_saved_per_kind_and_survives_a_reload() {
        let home = std::env::temp_dir().join(format!("hz-ws-order-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&home).unwrap();
        let mut all = load(&home).await.unwrap();
        all[0].agent_order = normalize_order(vec!["z".into(), "y".into(), "z".into()]);
        all[0].channel_order = vec!["c1".into()];
        write_all(&home, &all).await.unwrap();

        let again = load(&home).await.unwrap();

        assert_eq!(again[0].agent_order, vec!["z".to_string(), "y".to_string()]);
        assert_eq!(again[0].channel_order, vec!["c1".to_string()]);
    }

    #[test]
    fn ids_and_logo_files_cannot_walk_out() {
        assert!(valid_id("0198-ab").is_ok());
        assert!(valid_id("../x").is_err());
        assert!(valid_id("").is_err());
        assert_eq!(logo_extension("/x/Logo.PNG").unwrap(), "png");
        assert!(logo_extension("/x/logo.svg").is_err());
        assert!(logo_extension("/x/logo").is_err());
    }

    #[test]
    fn the_mark_is_the_first_letter_upper_cased() {
        assert_eq!(mark_of("  hyze cloud"), "H");
        assert_eq!(mark_of(""), "W");
        assert!(valid_color("#6a8cf0"));
        assert!(!valid_color("blue"));
    }

    #[tokio::test]
    async fn a_first_load_makes_one_workspace_and_files_the_roster_in_it() {
        let home = std::env::temp_dir().join(format!("hz-ws-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(
            home.join("agents.json"),
            json!([
                {"id": "a", "name": "A", "projectPath": "/code/hz", "space": "x"},
                {"id": "b", "name": "B", "projectPath": "/code/hz"}
            ])
            .to_string(),
        )
        .unwrap();

        let all = load(&home).await.unwrap();

        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "hz");
        let roster: Vec<Value> =
            serde_json::from_str(&std::fs::read_to_string(home.join("agents.json")).unwrap()).unwrap();
        assert!(roster.iter().all(|a| a["workspaceId"] == all[0].id.as_str()));
        assert!(roster[0].get("space").is_none());

        // A second load reads the file and invents nothing.
        assert_eq!(load(&home).await.unwrap(), all);
    }
}
