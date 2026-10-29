//! Tauri commands over `agentkit`: thin wrappers that put each feature's state under `~/.hz/agentkit/`
//! and hand the webview plain JSON. The logic and its tests live in `agentkit/`.

use crate::agentkit::{
    accounts, app_api, drafts, e2e, pages, payments, pdf, reviewer, screens, speech, takeover, usage, watches,
};
use crate::hyzevm;
use crate::kit_runtime as rt;
use anyhow::Context;
use chrono::Utc;
use serde_json::{json, Value};
use std::path::PathBuf;

/// `~/.hz/agentkit`, created on first use.
pub(crate) async fn root() -> Result<PathBuf, String> {
    let d = crate::store::get_home_app_dir().await.map_err(|e| e.to_string())?.join("agentkit");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// A folder under `~/.hz/agentkit`, created on first use.
pub(crate) async fn dir(sub: &str) -> Result<PathBuf, String> {
    let d = root().await?.join(sub);
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

pub(crate) async fn save_drafts(all: &[drafts::Draft]) -> Result<(), String> {
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
    poll_watches().await
}

/// The watch poll itself, shared with the background task that emits `agent_wake`.
pub(crate) async fn poll_watches() -> Result<Vec<Value>, String> {
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

/// Where the computers' size choice and the screen numbers live.
async fn vm_dir() -> Result<PathBuf, String> {
    dir("vm").await
}

/// The size new computers are made at: what the reader picked last, "small" before that.
fn saved_size(dir: &std::path::Path) -> String {
    std::fs::read_to_string(dir.join("size.txt")).ok().map(|s| s.trim().to_string()).filter(|s| hyzevm::size_spec(s).is_some()).unwrap_or_else(|| "small".into())
}

/// The agent's computer: "absent", "stopped" (off or paused, both wake on demand) or "running".
#[tauri::command]
pub async fn kit_vm_state(agent: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || hyzevm::state(&hyzevm::Bundled, &agent).to_string()).await.map_err(err)
}

/// Turns the agent's computer on: made from the desktop template the first time (about a minute while the image is
/// built), woken in under a second after that.
#[tauri::command]
pub async fn kit_vm_start(agent: String) -> Result<(), String> {
    let size = saved_size(&vm_dir().await?);
    tokio::task::spawn_blocking(move || hyzevm::start(&hyzevm::Bundled, &agent, &size).map_err(err))
        .await
        .map_err(err)?
}

/// Gives the agent a computer if it has none, and leaves it asleep. Called when an agent is made, so the screen is
/// there the first time anyone looks. Takes about a minute the very first time on a machine, seconds after that.
#[tauri::command]
pub async fn kit_vm_ensure(agent: String) -> Result<(), String> {
    let size = saved_size(&vm_dir().await?);
    tokio::task::spawn_blocking(move || hyzevm::ensure(&hyzevm::Bundled, &agent, &size).map_err(err))
        .await
        .map_err(err)?
}

/// Pauses the agent's computer, keeping everything on it.
#[tauri::command]
pub async fn kit_vm_stop(agent: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || hyzevm::pause(&hyzevm::Bundled, &agent).map_err(err)).await.map_err(err)?
}

/// Sets the size ("small", "medium", "large") for this agent's computer, and for the next ones made. An existing
/// computer is shut down and resized; it wakes at that size.
#[tauri::command]
pub async fn kit_vm_size(agent: String, size: String) -> Result<(), String> {
    hyzevm::size_spec(&size).ok_or("unknown size")?;
    let d = vm_dir().await?;
    std::fs::write(d.join("size.txt"), &size).map_err(err)?;
    tokio::task::spawn_blocking(move || hyzevm::resize(&hyzevm::Bundled, &agent, &size).map_err(err)).await.map_err(err)?
}

/// The agent's screen number, handed out once and kept. It names the takeover mark; the machine has its own address.
#[tauri::command]
pub async fn kit_screen_for(agent: String) -> Result<u32, String> {
    let p = vm_dir().await?.join("screens.json");
    let mut a = screens::Allocator::load(&p);
    let n = a.assign(&agent);
    a.save(&p).map_err(err)?;
    Ok(n)
}

/// Wakes the agent's computer if it sleeps and returns the web address of its screen; the viewer opens a socket on it.
/// It only answers from this Mac.
#[tauri::command]
pub async fn kit_screen_url(agent: String) -> Result<String, String> {
    let size = saved_size(&vm_dir().await?);
    tokio::task::spawn_blocking(move || hyzevm::screen_base(&hyzevm::Bundled, &agent, &size, &hyzevm::port_open).map_err(err))
        .await
        .map_err(err)?
}

/// A picture of the agent's screen as a PNG data URL, for when the live view cannot start.
#[tauri::command]
pub async fn kit_screenshot(agent: String) -> Result<String, String> {
    let bytes = tokio::task::spawn_blocking(move || hyzevm::screenshot(&hyzevm::Bundled, &agent).map_err(err))
        .await
        .map_err(err)??;
    use base64::Engine as _;
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Opens a voice call with an agent; the reply is spoken as it is written through `kit_call_say`.
#[tauri::command]
pub async fn kit_call_start(agent: String) -> Result<(), String> {
    rt::call_start(&agent, Utc::now().timestamp())
}

/// Speaks a piece of the agent's reply, sentence by sentence; `last` flushes the unfinished sentence.
#[tauri::command]
pub async fn kit_call_say(agent: String, delta: String, last: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || rt::call_say(&agent, &delta, last, &rt::SayVoice, &rt::AfPlayer))
        .await
        .map_err(err)?
}

/// What the user said on the call; true means it was "stop" and the speech was cut off.
#[tauri::command]
pub async fn kit_call_heard(agent: String, text: String) -> Result<bool, String> {
    rt::call_heard(&agent, &text, &rt::AfPlayer)
}

/// Hangs up and returns the call's lines, to be posted in the chat.
#[tauri::command]
pub async fn kit_call_end(agent: String) -> Result<Vec<String>, String> {
    rt::call_end(&agent, Utc::now().timestamp(), &rt::AfPlayer)
}

/// Sites an agent is signed in to, never the passwords.
#[tauri::command]
pub async fn kit_logins(agent: String) -> Result<Vec<rt::Login>, String> {
    let p = dir("logins").await?.join(format!("{}.json", safe(&agent)));
    Ok(rt::logins_list(&p))
}

/// Notes that an agent signed in to a site as a user.
#[tauri::command]
pub async fn kit_login_record(agent: String, site: String, user: String) -> Result<(), String> {
    let p = dir("logins").await?.join(format!("{}.json", safe(&agent)));
    rt::login_record(&p, &site, &user, &Utc::now().format("%Y-%m-%d").to_string()).map_err(err)
}

/// Forgets a site's login for an agent.
#[tauri::command]
pub async fn kit_login_remove(agent: String, site: String) -> Result<(), String> {
    let p = dir("logins").await?.join(format!("{}.json", safe(&agent)));
    rt::login_remove(&p, &site).map_err(err)
}

/// An agent's saved versions, newest last, without their snapshots.
#[tauri::command]
pub async fn kit_versions(agent: String) -> Result<Vec<Value>, String> {
    let p = dir("versions").await?.join(format!("{}.json", safe(&agent)));
    Ok(rt::versions_list(&p))
}

/// Saves a snapshot (instructions, model, skills as JSON) of an agent under a title and returns its number.
#[tauri::command]
pub async fn kit_version_record(agent: String, title: String, by: String, snapshot_json: String) -> Result<String, String> {
    let snap: Value = serde_json::from_str(&snapshot_json).map_err(err)?;
    let p = dir("versions").await?.join(format!("{}.json", safe(&agent)));
    rt::version_record(&p, &title, &by, snap, Utc::now().timestamp()).map_err(err)
}

/// The snapshot of version `n`, for the webview to apply to the agent.
#[tauri::command]
pub async fn kit_version_restore(agent: String, n: String) -> Result<Value, String> {
    let p = dir("versions").await?.join(format!("{}.json", safe(&agent)));
    rt::version_snapshot(&p, &n).ok_or_else(|| "no such version".to_string())
}

/// Installed agent CLIs that have a newer release; npm is asked at most every six hours.
#[tauri::command]
pub async fn kit_engine_updates() -> Result<Vec<Value>, String> {
    let cache = root().await?.join("engine-updates.json");
    let found = rt::engine_updates(&cache, Utc::now()).await;
    for u in &found {
        if let (Some(e), Some(v)) = (u["engine"].as_str(), u["latest"].as_str()) {
            crate::clis::note_latest(e, v);
        }
    }
    Ok(found)
}

async fn account_store() -> Result<accounts::AccountStore, String> {
    accounts::AccountStore::open(&root().await?.join("accounts.json")).map_err(err)
}

/// The sign-ins the reader added.
#[tauri::command]
pub async fn kit_accounts() -> Result<Vec<accounts::Account>, String> {
    Ok(account_store().await?.list().to_vec())
}

/// Adds a sign-in for an engine ("claude", "codex", "opencode", "grok", "antigravity").
#[tauri::command]
pub async fn kit_account_add(id: String, engine: String, label: String) -> Result<accounts::Account, String> {
    let e: accounts::Engine = serde_json::from_value(Value::String(engine)).map_err(|_| "unknown engine")?;
    account_store().await?.add(&id, e, &label).map_err(err)
}

/// Removes a sign-in and every agent assignment that used it.
#[tauri::command]
pub async fn kit_account_remove(id: String) -> Result<bool, String> {
    account_store().await?.remove(&id).map_err(err)
}

/// Makes an agent use a sign-in.
#[tauri::command]
pub async fn kit_account_assign(agent: String, account_id: String) -> Result<(), String> {
    account_store().await?.assign(&agent, &account_id).map_err(err)
}

/// Returns an agent to the engine's own sign-in.
#[tauri::command]
pub async fn kit_account_unassign(agent: String) -> Result<(), String> {
    account_store().await?.unassign(&agent).map_err(err)
}

/// The sign-in an agent uses, if one was assigned.
#[tauri::command]
pub async fn kit_account_of(agent: String) -> Result<Option<accounts::Account>, String> {
    Ok(account_store().await?.account_for(&agent).cloned())
}

pub(crate) async fn app_keys_path() -> Result<PathBuf, String> {
    Ok(root().await?.join("app-keys.json"))
}

/// Keys other apps use to read the local API; the keys themselves are never listed.
#[tauri::command]
pub async fn kit_app_keys() -> Result<Vec<Value>, String> {
    let k = app_api::AppKeys::open(&app_keys_path().await?).map_err(err)?;
    Ok(k
        .list()
        .iter()
        .map(|i| json!({"id": i.id, "label": i.label, "created": i.created, "last_used": k.last_used(&i.id).map(|t| t.timestamp())}))
        .collect())
}

/// Makes a key and returns it once; only its hash is kept.
#[tauri::command]
pub async fn kit_app_key_create(label: String) -> Result<Value, String> {
    let mut k = app_api::AppKeys::open(&app_keys_path().await?).map_err(err)?;
    let (id, key) = k.create(&label).map_err(err)?;
    Ok(json!({"id": id, "key": key}))
}

/// Revokes a key so it stops working at once.
#[tauri::command]
pub async fn kit_app_key_revoke(id: String) -> Result<(), String> {
    let mut k = app_api::AppKeys::open(&app_keys_path().await?).map_err(err)?;
    k.revoke(&id).map_err(err)?;
    Ok(())
}

/// Saves the purchase limits; the month's spending is kept.
#[tauri::command]
pub async fn kit_payments_set(limits: payments::Limits) -> Result<(), String> {
    let p = dir("payments").await?.join("payments.json");
    let mut pay = payments::Payments::load(&p);
    pay.limits = limits;
    pay.save(&p).map_err(err)
}

/// Makes a PDF of an agent's page and returns its path; with no browser on the machine it is the HTML file.
#[tauri::command]
pub async fn kit_pdf(title: String, agent: String, html: String) -> Result<String, String> {
    let name = crate::agents::name_of(&agent).unwrap_or(agent);
    let now = Utc::now();
    let page = pdf::wrap_html(&title, &name, &now.format("%B %-d, %Y").to_string(), &html);
    let stem = match safe(&title) {
        s if s.is_empty() => "page".to_string(),
        s => s,
    };
    let out = dir("pdf").await?.join(format!("{stem}-{}.pdf", now.format("%Y%m%d-%H%M%S")));
    Ok(match pdf::render(&page, &out, &pdf::SystemRunner).await.map_err(err)? {
        pdf::Output::Pdf(p) | pdf::Output::HtmlFallback(p) => p.to_string_lossy().into_owned(),
    })
}
