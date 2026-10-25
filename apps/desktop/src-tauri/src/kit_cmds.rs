//! Tauri commands over `agentkit`: thin wrappers that put each feature's state under `~/.hz/agentkit/`
//! and hand the webview plain JSON. The logic and its tests live in `agentkit/`.

use crate::agentkit::{drafts, e2e, pages, payments, reviewer, speech, takeover, usage, watches};
use anyhow::Context;
use chrono::Utc;
use serde_json::{json, Value};
use std::path::PathBuf;

async fn dir(sub: &str) -> Result<PathBuf, String> {
    let d = crate::store::get_home_app_dir()
        .await
        .map_err(|e| e.to_string())?
        .join("agentkit")
        .join(sub);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Reviews a shell command the way the agent's permission mode would.
#[tauri::command]
pub fn kit_review(cmd: String, mode: String, workspace: String) -> Result<Value, String> {
    let mode = match mode.as_str() {
        "auto_review" => reviewer::Mode::AutoReview,
        "allow_all" => reviewer::Mode::AllowAll,
        "off" => reviewer::Mode::Off,
        _ => reviewer::Mode::AlwaysAsk,
    };
    let v = reviewer::review(&cmd, mode, std::path::Path::new(&workspace));
    Ok(match v {
        reviewer::Verdict::Allow => json!({"verdict": "allow"}),
        reviewer::Verdict::Ask(r) => json!({"verdict": "ask", "reason": r}),
        reviewer::Verdict::Refuse(r) => json!({"verdict": "refuse", "reason": r}),
    })
}

/// Text prepared for the voice: numbers, money and dates in words, markdown dropped.
#[tauri::command]
pub fn kit_speech(text: String) -> String {
    speech::prepare(&text)
}

/// Estimated cost of a run in micro-dollars, or null for a model with no known price.
#[tauri::command]
pub fn kit_cost(model: String, input: u64, output: u64) -> Option<u64> {
    usage::cost_microusd(&model, input, output)
}

/// Drafts an agent has written, newest last.
#[tauri::command]
pub async fn kit_drafts_list() -> Result<Vec<drafts::Draft>, String> {
    let p = dir("drafts").await?.join("drafts.json");
    Ok(std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}

async fn save_drafts(all: &[drafts::Draft]) -> Result<(), String> {
    let p = dir("drafts").await?.join("drafts.json");
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(all).map_err(err)?).map_err(err)?;
    std::fs::rename(tmp, p).map_err(err)
}

/// Saves a new draft card from an agent.
#[tauri::command]
pub async fn kit_draft_new(
    to: String,
    subject: String,
    body: String,
    attachments: Vec<String>,
    channel: String,
) -> Result<drafts::Draft, String> {
    let mut all = kit_drafts_list().await?;
    let d = drafts::Draft::new(&uuid::Uuid::new_v4().to_string(), &to, &subject, &body, attachments, &channel);
    all.push(d.clone());
    save_drafts(&all).await?;
    Ok(d)
}

/// Edits, sends or discards a draft; `action` is "edit", "send" or "discard". Sending only
/// requests it: the sender that talks to Gmail or an app marks it sent or failed.
#[tauri::command]
pub async fn kit_draft_act(id: String, action: String, body: Option<String>) -> Result<drafts::Draft, String> {
    let mut all = kit_drafts_list().await?;
    let d = all.iter_mut().find(|d| d.id == id).ok_or("no such draft")?;
    match action.as_str() {
        "edit" => d.edit(&body.unwrap_or_default())?,
        "send" => d.request_send()?,
        "discard" => d.discard()?,
        _ => return Err("unknown action".into()),
    }
    let out = d.clone();
    save_drafts(&all).await?;
    Ok(out)
}

/// A page's history: the versions and when each was made.
#[tauri::command]
pub async fn kit_page_history(id: String) -> Result<Vec<(u32, i64)>, String> {
    let p = dir("pages").await?.join(format!("{}.json", safe(&id)));
    Ok(pages::load(&p).map(|pg| pg.history()).unwrap_or_default())
}

/// Writes a new version of a page; a conflict says which version is current.
#[tauri::command]
pub async fn kit_page_update(id: String, title: String, html: String, base_version: u32) -> Result<Value, String> {
    let p = dir("pages").await?.join(format!("{}.json", safe(&id)));
    let mut page = pages::load(&p).unwrap_or_else(|_| pages::Page::new(&id, &title));
    match page.update(&html, base_version, Utc::now().timestamp()) {
        Ok(u) => {
            pages::save(&page, &p).map_err(err)?;
            Ok(json!({"ok": true, "version": u.version, "changed": u.changed_block_ids}))
        }
        Err(c) => Ok(json!({"ok": false, "current_version": c.current_version})),
    }
}

/// Brings an old version back as a new one.
#[tauri::command]
pub async fn kit_page_restore(id: String, version: u32) -> Result<u32, String> {
    let p = dir("pages").await?.join(format!("{}.json", safe(&id)));
    let mut page = pages::load(&p).map_err(err)?;
    let u = page.restore(version, Utc::now().timestamp())?;
    pages::save(&page, &p).map_err(err)?;
    Ok(u.version)
}

fn safe(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(64).collect()
}

/// Starts watching a process; the agent is woken in its chat when it ends.
#[tauri::command]
pub async fn kit_watch_add(bot: String, pid: u32, label: String, log: Option<String>) -> Result<(), String> {
    let p = dir("watches").await?.join("watches.json");
    let mut s = watches::WatchStore::open(&p);
    s.add(watches::Watch {
        id: uuid::Uuid::new_v4().to_string(),
        bot,
        pid,
        log_path: log.map(PathBuf::from),
        started: Utc::now().timestamp(),
        label,
    })
    .map_err(err)
}

/// Looks at every watch and returns the ones that ended, as messages to wake agents with.
#[tauri::command]
pub async fn kit_watch_poll() -> Result<Vec<Value>, String> {
    let p = dir("watches").await?.join("watches.json");
    let mut s = watches::WatchStore::open(&p);
    let wakes = watches::poll(&mut s, &watches::pid_alive, Utc::now().timestamp());
    Ok(wakes.iter().map(|w| json!({"bot": w.bot, "message": w.message()})).collect())
}

/// The purchase limits, as saved.
#[tauri::command]
pub async fn kit_payments_get() -> Result<Value, String> {
    let p = dir("payments").await?.join("payments.json");
    let pay = payments::Payments::load(&p);
    serde_json::to_value(&pay).map_err(err)
}

/// Whether an end-to-end key exists, without revealing it.
#[tauri::command]
pub async fn kit_e2e_status() -> Result<bool, String> {
    let p = dir("e2e").await?.join("e2e.key");
    Ok(e2e::load_key(&p).map_err(err)?.is_some())
}

/// Makes the account's key if there is none, and returns its recovery code once.
#[tauri::command]
pub async fn kit_e2e_create() -> Result<String, String> {
    let p = dir("e2e").await?.join("e2e.key");
    if e2e::load_key(&p).map_err(err)?.is_some() {
        return Err("a key already exists".into());
    }
    let k = e2e::Key::generate();
    e2e::save_key(&p, &k).context("saving the key").map_err(err)?;
    Ok(k.to_recovery_code())
}

/// Puts you in control of an agent's screen; the agent's next computer command waits.
#[tauri::command]
pub async fn kit_takeover(screen: u32, on: bool) -> Result<(), String> {
    let d = dir("takeover").await?;
    if on {
        takeover::Takeover::take(&d, screen, Utc::now()).map_err(err)
    } else {
        takeover::Takeover::give_back(&d, screen).map_err(err)
    }
}

/// Whether you are in control of that screen right now.
#[tauri::command]
pub async fn kit_takeover_state(screen: u32) -> Result<bool, String> {
    let d = dir("takeover").await?;
    Ok(takeover::Takeover::is_taken(&d, screen, Utc::now()))
}
