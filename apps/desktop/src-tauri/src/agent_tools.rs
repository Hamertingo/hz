//! The `hz` MCP tools: what an agent posts into its chat.
//!
//! Served on the team's loopback port at `/mcp/<agent id>/hz`. Each tool keeps its
//! state through `agentkit` and answers in words the agent reads. **The card the
//! person sees is drawn by the webview from the call's own input and this answer**
//! (`lib/hzTools.ts`), so a card is part of the transcript and survives a restart
//! with no event of its own. The ids a card needs ride in the answer as `(id …)`
//! or `(file …)`: that spelling is the whole contract between the two sides, and
//! `hzTools.ts` reads it with the same words.
//!
//! **Each card is kept here, not read back off the call's input.** A CLI draws a
//! call from its first update, and Claude's first update can carry only some of
//! the arguments (seen in a real run: `{"to": …}` alone for a draft), so the
//! logged input is a fallback and the card comes from `kit_post_get`.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};

use anyhow::{anyhow, bail, ensure, Context, Result};
use chrono::Utc;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::agentkit::{bot_factory, drafts, genui, pages, plan, screenshot, watches};
use crate::{agents, hyzevm, kit_cmds};

/// The mark on the prompt that wakes an agent when a watched command ends. The
/// transcript draws it as a quiet line, not as the reader's words. Kept in step
/// with `WAKE_MARK` in `lib/intro.ts`.
pub const WAKE_MARK: &str = "<hz-wake/>";

/// How long a sign-in card waits for the person.
const PERSON_WAIT: Duration = Duration::from_secs(600);
/// How long `create_agent` waits for the window to add the agent to the roster.
const ROSTER_WAIT: Duration = Duration::from_secs(30);
/// Images a widget embeds from the agent's folder, each.
const WIDGET_IMAGE_MAX: u64 = 2 << 20;

pub(crate) fn tools() -> Value {
    let obj = |props: Value, required: &[&str]| {
        json!({"type": "object", "properties": props, "required": required, "additionalProperties": false})
    };
    json!([
        {
            "name": "propose_draft",
            "description": "Post a message for someone else as a draft card: an email, a reply, a post. The person \
                            edits it and sends, copies or discards it. You never send mail or messages yourself; \
                            this is the only way. `via` is gmail for an email, app:<name> for a connected app, \
                            clipboard (the default) for anything the person pastes themselves.",
            "inputSchema": obj(json!({
                "to": {"type": "string", "description": "Who it is for: an address, a handle, a channel."},
                "subject": {"type": "string", "description": "The subject line, or which part this is (\"Post 1 of 7\")."},
                "body": {"type": "string", "description": "The message itself, ready to send."},
                "attachments": {"type": "array", "items": {"type": "string"}, "description": "Paths of files to attach."},
                "via": {"type": "string", "description": "gmail, app:<name> or clipboard."},
            }), &["to", "body"]),
        },
        {
            "name": "draft_status",
            "description": "What became of a draft you posted: still a draft, sent, failed (and why) or discarded.",
            "inputSchema": obj(json!({"id": {"type": "string", "description": "The draft's id, from propose_draft."}}), &["id"]),
        },
        {
            "name": "page_create",
            "description": "Post a live page: a report, a plan, a table, anything worth reading at full size. HTML \
                            body only (no scripts; they are removed). The person opens it from a card and can go \
                            back to any version.",
            "inputSchema": obj(json!({
                "title": {"type": "string"},
                "html": {"type": "string", "description": "The page body as HTML."},
            }), &["title", "html"]),
        },
        {
            "name": "page_update",
            "description": "Write a new version of a page you posted. Send the whole body. `base_version` is the \
                            version you started from; if the page moved on since (the person restored an older \
                            one), the write is refused and you read it again first.",
            "inputSchema": obj(json!({
                "id": {"type": "string"},
                "html": {"type": "string"},
                "base_version": {"type": "integer", "minimum": 0},
                "title": {"type": "string", "description": "A new title, if it changed."},
            }), &["id", "html", "base_version"]),
        },
        {
            "name": "page_read",
            "description": "Read a page you posted as it stands now, with its version number.",
            "inputSchema": obj(json!({"id": {"type": "string"}}), &["id"]),
        },
        {
            "name": "show_chart",
            "description": "Show numbers as a chart card in the chat. Plain data in; the app draws it.",
            "inputSchema": obj(json!({
                "title": {"type": "string"},
                "kind": {"type": "string", "enum": ["bar", "line", "pie"]},
                "points": {
                    "type": "array",
                    "maxItems": genui::MAX_POINTS,
                    "items": obj(json!({"label": {"type": "string"}, "value": {"type": "number"}}), &["label", "value"]),
                },
                "unit": {"type": "string", "description": "Put after each value, such as % or ms."},
                "note": {"type": "string", "description": "One line under the chart: what to read in it."},
            }), &["title", "points"]),
        },
        {
            "name": "show_widget",
            "description": "Show a small interactive HTML widget in the chat: a calculator, a picker, a preview. It \
                            runs sandboxed with no network. Images from your folder go in as src=\"file:name.png\". \
                            A button can call hz.reply(\"text\") to put that answer in the person's message box.",
            "inputSchema": obj(json!({
                "title": {"type": "string"},
                "html": {"type": "string", "description": "HTML with inline <style> and <script>."},
            }), &["title", "html"]),
        },
        {
            "name": "show_plan",
            "description": "Show the steps of long work as a checklist card. Call it again with the whole list each \
                            time a step starts or finishes; the newest list is the one shown.",
            "inputSchema": obj(json!({
                "steps": {
                    "type": "array",
                    "items": obj(json!({
                        "text": {"type": "string"},
                        "status": {"type": "string", "enum": ["pending", "running", "done"]},
                    }), &["text"]),
                },
            }), &["steps"]),
        },
        {
            "name": "share_screenshot",
            "description": "Share a picture of your own computer's screen in the chat; it is also kept in your \
                            Library. Use it when the person should see what you see.",
            "inputSchema": obj(json!({"caption": {"type": "string", "description": "One line on what it shows."}}), &[]),
        },
        {
            "name": "wake_when_done",
            "description": "Start a long command in the background on your computer (for example `nohup make > \
                            /tmp/build.log 2>&1 & echo $!`), then hand its pid here and end your turn. When it \
                            ends you get a message in this chat with how long it took and its last log lines.",
            "inputSchema": obj(json!({
                "pid": {"type": "integer", "minimum": 1},
                "label": {"type": "string", "description": "What it is, in a few words: \"the build\"."},
                "log": {"type": "string", "description": "Path of its log file, for the last lines."},
                "on": {"type": "string", "enum": ["computer", "mac"], "description": "Where it runs; your computer unless it is on the Mac."},
            }), &["pid", "label"]),
        },
        {
            "name": "request_login",
            "description": "Ask the person to sign in to a site on your computer. Open the sign-in page in your \
                            browser first. They type into the page themselves; you never see or type the password. \
                            Waits for them, up to ten minutes.",
            "inputSchema": obj(json!({
                "site": {"type": "string", "description": "The site, such as github.com."},
                "why": {"type": "string", "description": "What you need the sign-in for, in one sentence."},
            }), &["site", "why"]),
        },
        {
            "name": "qr_login",
            "description": "Ask the person to scan a sign-in QR code that is on your screen (WhatsApp Web and the \
                            like). Open the page first. The card shows the code cropped from your screen and keeps \
                            it fresh. Waits for them, up to ten minutes.",
            "inputSchema": obj(json!({
                "site": {"type": "string"},
                "why": {"type": "string"},
                "region": {
                    "description": "Where the code is on the screen, in screen pixels, if you know it.",
                    "type": "object",
                    "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "w": {"type": "number"}, "h": {"type": "number"}},
                },
            }), &["site", "why"]),
        },
        {
            "name": "create_agent",
            "description": "Make a new agent on the person's team, only when they ask for one. Give it a short \
                            name, a role of a few words and its job in plain words. At most five per request.",
            "inputSchema": obj(json!({
                "name": {"type": "string", "maxLength": bot_factory::MAX_NAME},
                "role": {"type": "string", "maxLength": bot_factory::MAX_ROLE},
                "job": {"type": "string", "description": "Its instructions: what it is for and how to work."},
            }), &["name", "role", "job"]),
        },
    ])
}

fn text(args: &Value, key: &str) -> String {
    args.get(key).and_then(Value::as_str).unwrap_or_default().trim().to_string()
}

fn need(args: &Value, key: &str, tool: &str) -> Result<String> {
    let v = text(args, key);
    ensure!(!v.is_empty(), "{tool} needs `{key}`");
    Ok(v)
}

/// A short id, safe as a file name: `p_1a2b3c4d5e`.
fn mint(prefix: &str) -> String {
    format!("{prefix}_{}", &uuid::Uuid::new_v4().simple().to_string()[..10])
}

fn safe_id(id: &str) -> Result<String> {
    let s: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(64).collect();
    ensure!(!s.is_empty() && s == id, "no such id: {id}");
    Ok(s)
}

async fn kit_dir(sub: &str) -> Result<PathBuf> {
    kit_cmds::dir(sub).await.map_err(anyhow::Error::msg)
}

/// One `tools/call` from agent `agent_id`, answered in words.
pub(crate) async fn call(agent_id: &str, name: &str, args: &Value, app: &AppHandle) -> Result<String> {
    let me = agents::by_id(agent_id).context("you are not a known agent")?;
    ensure!(agents::tool_enabled(agent_id, "hz"), "these tools are switched off for you");
    let now = Utc::now().timestamp();

    match name {
        "propose_draft" => {
            let to = need(args, "to", name)?;
            let body = args.get("body").and_then(Value::as_str).unwrap_or_default().trim_end().to_string();
            ensure!(!body.trim().is_empty(), "propose_draft needs `body`");
            let via = Some(text(args, "via")).filter(|v| !v.is_empty()).unwrap_or_else(|| "clipboard".into());
            let attachments: Vec<String> = args
                .get("attachments")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            ensure!(
                drafts::Draft::new("", &to, "", "", vec![], &via).channel_valid(),
                "`via` is gmail, clipboard or app:<name>"
            );
            let d = kit_cmds::kit_draft_new(to, text(args, "subject"), body, attachments, via)
                .await
                .map_err(anyhow::Error::msg)?;
            Ok(format!(
                "Draft posted (id {}). It is a card in the chat now: the person edits it, then sends, copies or \
                 discards it. Never send it yourself by any other route. draft_status with this id says what \
                 became of it.",
                d.id
            ))
        }
        "draft_status" => {
            let id = need(args, "id", name)?;
            let all = kit_cmds::kit_drafts_list().await.map_err(anyhow::Error::msg)?;
            let d = all.iter().find(|d| d.id == id).with_context(|| format!("no draft {id}"))?;
            Ok(format!("Draft {id}: {}.", d.outcome()))
        }
        "page_create" => {
            let title = need(args, "title", name)?;
            let html = need(args, "html", name)?;
            let id = mint("p");
            let mut page = pages::Page::new(&id, &title);
            let u = page.update(&html, 0, now).map_err(|_| anyhow!("a new page cannot conflict"))?;
            pages::save(&page, &page_path(&id).await?)?;
            Ok(format!(
                "Page posted (id {id}, version {v}). The person opens it from its card and can go back to any \
                 version. To change it, call page_update with this id and base_version {v}.",
                v = u.version
            ))
        }
        "page_update" => {
            let id = need(args, "id", name)?;
            let html = need(args, "html", name)?;
            let base = args.get("base_version").and_then(Value::as_u64).context("page_update needs `base_version`")?;
            let path = page_path(&id).await?;
            let mut page = pages::load(&path).with_context(|| format!("no page {id}"))?;
            let title = text(args, "title");
            if !title.is_empty() {
                page.title = title;
            }
            match page.update(&html, u32::try_from(base).unwrap_or(u32::MAX), now) {
                Ok(u) => {
                    pages::save(&page, &path)?;
                    Ok(format!(
                        "Page updated (id {id}, version {v}). {n} block(s) changed. Next base_version is {v}.",
                        v = u.version,
                        n = u.changed_block_ids.len()
                    ))
                }
                Err(c) => bail!(
                    "page {id} is at version {cur} now, not {base}: it changed after you read it. Read it with \
                     page_read and write on top of version {cur}.",
                    cur = c.current_version
                ),
            }
        }
        "page_read" => {
            let id = need(args, "id", name)?;
            let page = pages::load(&page_path(&id).await?).with_context(|| format!("no page {id}"))?;
            let v = page.versions.last().context("the page is empty")?;
            Ok(format!("Page {id}, \"{}\", version {}:\n\n{}", page.title, v.n, v.html))
        }
        "show_chart" => {
            let chart = chart_of(args)?;
            let bars: Vec<Value> = chart.series.iter().map(|(l, v)| json!([l, v])).collect();
            let note = Some(text(args, "note")).filter(|n| !n.is_empty());
            let id = save_post(json!({"type": "chart", "title": chart.title, "kind": chart.kind, "unit": chart.unit, "note": note, "bars": bars})).await?;
            Ok(format!("Chart shown in the chat (id {id}): {} points.", chart.series.len()))
        }
        "show_widget" => {
            let title = need(args, "title", name)?;
            let html = need(args, "html", name)?;
            let html = match me.project_path.as_deref().filter(|p| Path::new(p).is_dir()) {
                Some(dir) => genui::embed_images(&html, Path::new(dir), WIDGET_IMAGE_MAX).map_err(anyhow::Error::msg)?,
                None => html,
            };
            let id = mint("w");
            tokio::fs::write(kit_dir("widgets").await?.join(format!("{id}.html")), genui::sandbox_wrap(&html)).await?;
            Ok(format!(
                "Widget \"{title}\" shown (id {id}). It has no network. A button in it can call \
                 hz.reply(\"text\") to put that answer in the person's message box."
            ))
        }
        "show_plan" => {
            let plan = plan_of(args);
            ensure!(!plan.steps.is_empty(), "show_plan needs `steps`: a list of {{text, status}}");
            let (done, total) = plan.progress();
            let steps: Vec<Value> = plan
                .steps
                .iter()
                .map(|s| {
                    let state = match s.state {
                        plan::StepState::Done => "done",
                        plan::StepState::Running => "run",
                        plan::StepState::Pending => "todo",
                    };
                    json!({"text": s.text, "state": state})
                })
                .collect();
            let id = save_post(json!({"type": "plan", "steps": steps})).await?;
            Ok(format!("Plan shown (id {id}): {done} of {total} done. Send the whole list again as steps change."))
        }
        "share_screenshot" => {
            let agent = me.id.clone();
            let bytes = tokio::task::spawn_blocking(move || hyzevm::screenshot(&hyzevm::Bundled, &agent)).await??;
            // Under `attachments/<session>`: the app may already show that folder, and a
            // deleted conversation takes its pictures with it.
            let owner = me.session_id.clone().unwrap_or_else(|| format!("agent-{}", me.id));
            let base = crate::store::get_home_app_dir().await?.join("attachments").join(owner);
            let path = screenshot::capture_path(&base, &me.id, Utc::now());
            if let Some(dir) = path.parent() {
                tokio::fs::create_dir_all(dir).await?;
            }
            tokio::fs::write(&path, bytes).await?;
            let caption = screenshot::Share::new(path.clone(), &text(args, "caption")).caption;
            let id = save_post(json!({"type": "image", "path": path, "caption": caption})).await?;
            Ok(format!(
                "Screenshot shared (id {id}) (file {}). The person sees it in the chat and in your Library.",
                path.display()
            ))
        }
        "wake_when_done" => wake_when_done(&me, args, now).await,
        "request_login" | "qr_login" => {
            let site = need(args, "site", name)?;
            let mut card = json!({
                "type": "signin",
                "site": site,
                "why": need(args, "why", name)?,
                "qr": name == "qr_login",
                "region": args.get("region").cloned().unwrap_or(Value::Null),
                "state": "waiting",
            });
            let answer = wait_for_person(&me.id, card.clone()).await;
            card["state"] = json!(match answer {
                Some(true) => "done",
                Some(false) => "declined",
                None => "unanswered",
            });
            let id = save_post(card).await?;
            let seen = format!("Sign-in card (id {id}) answered. ");
            match answer {
                Some(true) => {
                    if name == "request_login" {
                        let p = kit_dir("logins").await?.join(format!("{}.json", safe_id(&me.id).unwrap_or_default()));
                        let _ = crate::kit_runtime::login_record(&p, &site, "", &Utc::now().format("%Y-%m-%d").to_string());
                    }
                    Ok(format!(
                        "{seen}The person says they are signed in to {site} on your computer. Look at the page to \
                         check, then carry on. You never saw the password and must never ask for it."
                    ))
                }
                Some(false) => Ok(format!(
                    "{seen}The person chose not to sign in to {site} now. Do not try to sign in yourself; say what \
                     is waiting on it."
                )),
                None => Ok(format!(
                    "{seen}Nobody answered the sign-in card for {site} within ten minutes. Say what is waiting on it."
                )),
            }
        }
        "create_agent" => create_agent(&me, args, app).await,
        other => bail!("no tool {other}"),
    }
}

/// Keeps a card as the webview draws it and returns the id its answer names.
async fn save_post(card: Value) -> Result<String> {
    let id = mint("c");
    tokio::fs::write(kit_dir("posts").await?.join(format!("{id}.json")), serde_json::to_vec(&card)?).await?;
    Ok(id)
}

/// A card a tool kept, by the id its answer named.
#[tauri::command]
pub async fn kit_post_get(id: String) -> Result<Value, String> {
    let id = safe_id(&id).map_err(|e| e.to_string())?;
    let path = kit_dir("posts").await.map_err(|e| e.to_string())?.join(format!("{id}.json"));
    let raw = tokio::fs::read(path).await.map_err(|_| "no such card".to_string())?;
    serde_json::from_slice(&raw).map_err(|e| e.to_string())
}

async fn page_path(id: &str) -> Result<PathBuf> {
    Ok(kit_dir("pages").await?.join(format!("{}.json", safe_id(id)?)))
}

fn chart_of(args: &Value) -> Result<genui::Chart> {
    let kind = match text(args, "kind").as_str() {
        "" | "bar" => genui::Kind::Bar,
        "line" => genui::Kind::Line,
        "pie" => genui::Kind::Pie,
        k => bail!("`kind` is bar, line or pie, not {k}"),
    };
    let series = args
        .get("points")
        .and_then(Value::as_array)
        .context("show_chart needs `points`: a list of {label, value}")?
        .iter()
        .map(|p| {
            let label = p.get("label").map(|l| l.as_str().map_or_else(|| l.to_string(), str::to_string)).unwrap_or_default();
            (label, p.get("value").and_then(Value::as_f64).unwrap_or(f64::NAN))
        })
        .collect();
    let unit = Some(text(args, "unit")).filter(|u| !u.is_empty());
    let chart = genui::Chart { title: text(args, "title"), kind, series, unit };
    genui::validate_chart(&chart).map_err(anyhow::Error::msg)?;
    Ok(chart)
}

fn plan_of(args: &Value) -> plan::Plan {
    plan::Plan::from_todos(&json!({"steps": args.get("steps").cloned().unwrap_or(Value::Null)}))
}

type SharedSender = Arc<dyn drafts::Sender + Send + Sync>;

static SENDERS: LazyLock<Mutex<HashMap<String, SharedSender>>> = LazyLock::new(Default::default);

/// Hands drafts sent through `channel` (`gmail`, `app:Slack`, or `app` for every
/// app) to `sender`. **The hook the Google and app integrations fill**; until one
/// is registered a draft sent that way fails with a reason and stays copyable.
/// Called from a blocking thread, so a sender may block on its own I/O.
pub fn register_sender(channel: &str, sender: SharedSender) {
    SENDERS.lock().expect("senders poisoned").insert(channel.to_string(), sender);
}

/// The webview copies the text before it asks, so the clipboard's send is only
/// the record that it happened.
struct Copied;
impl drafts::Sender for Copied {
    fn send(&self, _: &drafts::Draft) -> Result<String> {
        Ok(chrono::Local::now().format("%H:%M").to_string())
    }
}

struct NotWired(String);
impl drafts::Sender for NotWired {
    fn send(&self, _: &drafts::Draft) -> Result<String> {
        bail!("sending through {} is not connected yet; copy it and send it yourself", self.0)
    }
}

fn sender_for(channel: &str) -> SharedSender {
    if channel == "clipboard" {
        return Arc::new(Copied);
    }
    let senders = SENDERS.lock().expect("senders poisoned");
    let app = channel.starts_with("app:").then(|| senders.get("app")).flatten();
    senders.get(channel).or(app).cloned().unwrap_or_else(|| Arc::new(NotWired(channel.to_string())))
}

/// The person pressed Send on a draft card: saves their last edit, then sends it
/// through its channel and records sent or failed.
#[tauri::command]
pub async fn kit_draft_send(id: String, body: Option<String>) -> Result<drafts::Draft, String> {
    let mut all = kit_cmds::kit_drafts_list().await?;
    let at = all.iter().position(|d| d.id == id).ok_or("no such draft")?;
    let mut draft = all[at].clone();
    if let Some(body) = body {
        draft.edit(&body)?;
    }
    draft.request_send()?;
    let sender = sender_for(&draft.channel);
    let draft = tokio::task::spawn_blocking(move || {
        drafts::process(&mut draft, &*sender);
        draft
    })
    .await
    .map_err(|e| e.to_string())?;
    all[at] = draft.clone();
    kit_cmds::save_drafts(&all).await?;
    Ok(draft)
}

/// A page as stored: its title, the version asked for (the newest when `None`)
/// and the newest version number.
#[tauri::command]
pub async fn kit_page_get(id: String, version: Option<u32>) -> Result<Value, String> {
    let path = page_path(&id).await.map_err(|e| e.to_string())?;
    let page = pages::load(&path).map_err(|_| "no such page".to_string())?;
    let v = match version {
        Some(n) => page.versions.iter().find(|v| v.n == n),
        None => page.versions.last(),
    }
    .ok_or("no such version")?;
    Ok(json!({"id": page.id, "title": page.title, "version": v.n, "current": page.current_version(), "html": v.html}))
}

/// A widget's sandboxed document, as `show_widget` stored it.
#[tauri::command]
pub async fn kit_widget_get(id: String) -> Result<String, String> {
    let id = safe_id(&id).map_err(|e| e.to_string())?;
    let dir = kit_dir("widgets").await.map_err(|e| e.to_string())?;
    tokio::fs::read_to_string(dir.join(format!("{id}.html"))).await.map_err(|_| "no such widget".to_string())
}

/// The card waiting for the person, and the way to answer it.
type Waiting = (Value, oneshot::Sender<bool>);

/// Per agent: one sign-in card at a time.
static WAITING: LazyLock<Mutex<HashMap<String, Waiting>>> = LazyLock::new(Default::default);

/// Waits for the person to answer this agent's sign-in card: `Some(done)`, or
/// `None` when nobody did in time. One card per agent; a newer one replaces an
/// older, whose call then reads as declined, so a cancelled turn's card cannot
/// hold the slot for ten minutes.
async fn wait_for_person(agent_id: &str, card: Value) -> Option<bool> {
    let (tx, rx) = oneshot::channel();
    if let Some((_, old)) = WAITING.lock().expect("waiting poisoned").insert(agent_id.to_string(), (card, tx)) {
        let _ = old.send(false);
    }
    let answer = tokio::time::timeout(PERSON_WAIT, rx).await;
    let mut waiting = WAITING.lock().expect("waiting poisoned");
    if waiting.get(agent_id).is_some_and(|(_, tx)| tx.is_closed()) {
        waiting.remove(agent_id);
    }
    match answer {
        Ok(Ok(done)) => Some(done),
        _ => None,
    }
}

/// The person answered a sign-in or QR card: `done` is "I'm signed in".
#[tauri::command]
pub fn kit_login_answer(agent: String, done: bool) -> Result<(), String> {
    let (_, tx) = WAITING
        .lock()
        .expect("waiting poisoned")
        .remove(&agent)
        .ok_or("this sign-in is no longer waiting")?;
    tx.send(done).map_err(|_| "this sign-in is no longer waiting".to_string())
}

/// The sign-in card this agent is waiting on, if any: what the card shows while
/// the call has no answer yet.
#[tauri::command]
pub fn kit_login_pending(agent: String) -> Option<Value> {
    WAITING.lock().expect("waiting poisoned").get(&agent).map(|(card, _)| card.clone())
}

#[derive(Default)]
struct Factory {
    /// Reader messages seen per session: the request a creation counts against.
    requests: HashMap<String, u64>,
    quota: bot_factory::Quota,
    replies: HashMap<String, oneshot::Sender<Result<String, String>>>,
}

static FACTORY: LazyLock<Mutex<Factory>> = LazyLock::new(Default::default);

/// Called with every message a session logs: each one is a new request, with a
/// fresh allowance of agents to make.
pub fn observe_user(session_id: &str) {
    *FACTORY.lock().expect("factory poisoned").requests.entry(session_id.to_string()).or_default() += 1;
}

async fn create_agent(me: &agents::AgentRecord, args: &Value, app: &AppHandle) -> Result<String> {
    let spec = bot_factory::NewAgentSpec { name: text(args, "name"), role: text(args, "role"), job: text(args, "job") };
    let names: Vec<String> = agents::all().into_iter().map(|a| a.name).collect();
    let spec = bot_factory::make(&spec, &names)?;

    let request = mint("new");
    let rx = {
        let mut f = FACTORY.lock().expect("factory poisoned");
        let turn = me.session_id.as_deref().and_then(|s| f.requests.get(s)).copied().unwrap_or(0);
        f.quota.take(&format!("{}:{turn}", me.id))?;
        let (tx, rx) = oneshot::channel();
        f.replies.insert(request.clone(), tx);
        rx
    };
    // The window owns the roster, so it makes the agent the way its own dialog does
    // and answers with `kit_agent_created`.
    app.emit(
        "agent_create_request",
        json!({"requestId": request, "fromAgentId": me.id, "name": spec.name, "role": spec.role, "job": spec.job}),
    )?;
    let made = tokio::time::timeout(ROSTER_WAIT, rx).await;
    FACTORY.lock().expect("factory poisoned").replies.remove(&request);
    match made {
        Ok(Ok(Ok(agent))) => {
            let id = save_post(json!({"type": "agent", "id": agent, "name": spec.name, "role": spec.role})).await?;
            Ok(format!(
                "Made {} (id {id}), {}. They are on the team and in the person's sidebar. Give them their first \
                 task with team_message; they cannot see this conversation.",
                spec.name,
                if spec.role.is_empty() { "with no role yet" } else { &spec.role }
            ))
        }
        Ok(Ok(Err(why))) => bail!("the agent was not made: {why}"),
        _ => bail!("the app did not make the agent; its window may be closed"),
    }
}

/// The window's answer to `agent_create_request`: the new agent's id, or why not.
#[tauri::command]
pub fn kit_agent_created(request_id: String, agent_id: Option<String>, error: Option<String>) -> Result<(), String> {
    let tx = FACTORY
        .lock()
        .expect("factory poisoned")
        .replies
        .remove(&request_id)
        .ok_or("nothing is waiting on this agent")?;
    let _ = tx.send(agent_id.ok_or_else(|| error.unwrap_or_else(|| "no reason given".into())));
    Ok(())
}

async fn vm_watch_path(agent_id: &str) -> Result<PathBuf> {
    Ok(kit_dir("watches/vm").await?.join(format!("{}.json", safe_id(agent_id)?)))
}

async fn wake_when_done(me: &agents::AgentRecord, args: &Value, now: i64) -> Result<String> {
    let pid = args
        .get("pid")
        .and_then(Value::as_u64)
        .and_then(|p| u32::try_from(p).ok())
        .filter(|p| *p > 0)
        .context("wake_when_done needs the `pid` of the running command")?;
    let label = Some(text(args, "label")).filter(|l| !l.is_empty()).unwrap_or_else(|| "the command".into());
    let log = text(args, "log");
    let on_mac = text(args, "on") == "mac";
    let watch = watches::Watch {
        id: mint("watch"),
        bot: me.id.clone(),
        pid,
        log_path: (!log.is_empty()).then(|| PathBuf::from(&log)),
        started: now,
        label: label.clone(),
    };

    let path = if on_mac {
        ensure!(watches::pid_alive(pid), "nothing with pid {pid} is running on the Mac");
        kit_dir("watches").await?.join("watches.json")
    } else {
        let agent = me.id.clone();
        let alive = tokio::task::spawn_blocking(move || alive_on_computer(&hyzevm::Bundled, &agent, &[pid])).await??;
        ensure!(alive.contains(&pid), "nothing with pid {pid} is running on your computer");
        vm_watch_path(&me.id).await?
    };
    watches::WatchStore::open(&path).add(watch)?;
    let id = save_post(json!({"type": "watch", "label": label, "pid": pid})).await?;
    Ok(format!(
        "Watching pid {pid} (id {id}): {label}. When it ends you get a message in this chat with how long it took{}. \
         End your turn now; nothing needs you to wait.",
        if log.is_empty() { "" } else { " and the last lines of its log" }
    ))
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Runs one shell line on the agent's computer and returns what it printed.
fn on_computer(cli: &dyn hyzevm::Cli, agent: &str, script: &str) -> Result<String> {
    let args: Vec<String> = ["exec", &hyzevm::machine_name(agent), "--", script].iter().map(|s| s.to_string()).collect();
    let out = cli.run(&args)?;
    ensure!(out.code == 0, "{}", out.stderr.trim());
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Which of `pids` are alive on the agent's computer, asked in one round trip.
fn alive_on_computer(cli: &dyn hyzevm::Cli, agent: &str, pids: &[u32]) -> Result<Vec<u32>> {
    let list: Vec<String> = pids.iter().map(u32::to_string).collect();
    // `true` last, so a dead final pid does not fail the whole line.
    let script = format!("for p in {}; do kill -0 $p 2>/dev/null && echo $p; done; true", list.join(" "));
    Ok(on_computer(cli, agent, &script)?.lines().filter_map(|l| l.trim().parse().ok()).collect())
}

/// The watches of one agent's computer that ended (or outlived `MAX_AGE_SECS`),
/// as wakes, with the ids to drop. An error means the computer could not be asked
/// (asleep, off), and every watch waits for the next poll: a paused machine's
/// processes are frozen, so nothing there has ended.
fn ended_on_computer(cli: &dyn hyzevm::Cli, list: &[watches::Watch], now: i64) -> Result<Vec<(String, watches::Wake)>> {
    let Some(agent) = list.first().map(|w| w.bot.clone()) else { return Ok(vec![]) };
    let pids: Vec<u32> = list.iter().map(|w| w.pid).collect();
    let alive = alive_on_computer(cli, &agent, &pids)?;
    let mut out = Vec::new();
    for w in list {
        let running = alive.contains(&w.pid);
        if running && now - w.started < watches::MAX_AGE_SECS {
            continue;
        }
        let log_tail = match &w.log_path {
            Some(p) => on_computer(cli, &agent, &format!("tail -n 20 {}", sh_quote(&p.to_string_lossy())))
                .unwrap_or_default()
                .trim_end()
                .to_string(),
            None => String::new(),
        };
        out.push((
            w.id.clone(),
            watches::Wake {
                bot: w.bot.clone(),
                label: w.label.clone(),
                duration_secs: (now - w.started).max(0),
                log_tail,
                still_running: running,
            },
        ));
    }
    Ok(out)
}

/// Looks at the watches on every agent's computer and wakes the agents whose
/// command ended. Run from the watch poller in `kit_runtime`.
pub async fn poll_computer_watches(app: &AppHandle) {
    let Ok(dir) = kit_dir("watches/vm").await else { return };
    let Ok(files) = std::fs::read_dir(&dir) else { return };
    for path in files.flatten().map(|f| f.path()).filter(|p| p.extension().is_some_and(|e| e == "json")) {
        let list = watches::WatchStore::open(&path).list().to_vec();
        if list.is_empty() {
            continue;
        }
        let now = Utc::now().timestamp();
        let ended = tokio::task::spawn_blocking(move || ended_on_computer(&hyzevm::Bundled, &list, now)).await;
        let Ok(Ok(ended)) = ended else { continue };
        let mut store = watches::WatchStore::open(&path);
        for (id, wake) in ended {
            let _ = store.remove(&id);
            self::wake(app, &wake.bot, &wake.message()).await;
        }
    }
}

/// Sends a wake into the agent's own conversation, as a new turn it answers.
pub async fn wake(app: &AppHandle, agent_id: &str, message: &str) {
    let Some(agent) = agents::by_id(agent_id) else { return };
    let Some(session) = crate::orchestration::resolved_session(agent.session_id.as_deref()).await else { return };
    let prompt = format!(
        "{WAKE_MARK}{message}\n\n(A command you asked to be woken for has ended. Carry on from where you left it, \
         and tell the person what came of it.)"
    );
    if let Err(e) = crate::orchestration::deliver(&session, None, &prompt, app).await {
        eprintln!("[hz tools err] could not wake {}: {e:#}", agent.name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn every_tool_is_named_once_and_has_a_schema() {
        let tools = tools();
        let names: Vec<&str> = tools.as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        let mut sorted = names.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), names.len());
        for t in tools.as_array().unwrap() {
            assert_eq!(t["inputSchema"]["type"], "object", "{}", t["name"]);
        }
        for n in ["propose_draft", "page_create", "page_update", "show_chart", "show_widget", "show_plan", "share_screenshot", "wake_when_done", "request_login", "qr_login", "create_agent"] {
            assert!(names.contains(&n), "{n}");
        }
    }

    #[test]
    fn a_chart_takes_points_and_refuses_what_it_cannot_draw() {
        let c = chart_of(&json!({"title": "Margin", "points": [{"label": "$250", "value": 31}, {"label": 2026, "value": 40.5}], "unit": "%"})).unwrap();
        assert_eq!(c.kind, genui::Kind::Bar);
        assert_eq!(c.series, vec![("$250".to_string(), 31.0), ("2026".to_string(), 40.5)]);
        assert_eq!(c.unit.as_deref(), Some("%"));

        assert!(chart_of(&json!({"title": "x", "points": []})).is_err());
        assert!(chart_of(&json!({"title": "x", "kind": "radar", "points": [{"label": "a", "value": 1}]})).is_err());
        assert!(chart_of(&json!({"title": "x", "points": [{"label": "a", "value": "lots"}]})).is_err());
        assert!(chart_of(&json!({"title": "x", "kind": "pie", "points": [{"label": "a", "value": 0}]})).is_err());
    }

    #[test]
    fn a_plan_reads_text_and_status() {
        let p = plan_of(&json!({"steps": [{"text": "Read", "status": "done"}, {"text": "Write", "status": "running"}, {"text": "Ship"}]}));
        assert_eq!(p.progress(), (1, 3));
        assert_eq!(p.steps[1].state, plan::StepState::Running);
        assert!(plan_of(&json!({})).steps.is_empty());
    }

    #[test]
    fn ids_are_file_safe_and_a_foreign_one_is_refused() {
        let id = mint("p");
        assert!(id.starts_with("p_") && id.len() == 12);
        assert_eq!(safe_id(&id).unwrap(), id);
        assert!(safe_id("../etc/passwd").is_err());
        assert!(safe_id("").is_err());
    }

    struct Rec;
    impl drafts::Sender for Rec {
        fn send(&self, d: &drafts::Draft) -> Result<String> {
            Ok(format!("to {}", d.to))
        }
    }

    #[test]
    fn a_draft_goes_out_only_through_a_wired_channel() {
        let mut d = drafts::Draft::new("1", "a@b.c", "Hi", "body", vec![], "gmail");
        d.request_send().unwrap();
        drafts::process(&mut d, &*sender_for("gmail"));
        assert!(matches!(&d.state, drafts::State::Failed(r) if r.contains("not connected")));

        register_sender("app", Arc::new(Rec));
        let mut s = drafts::Draft::new("2", "#general", "", "hello", vec![], "app:Slack");
        s.request_send().unwrap();
        drafts::process(&mut s, &*sender_for("app:Slack"));
        assert_eq!(s.state, drafts::State::Sent);
        assert_eq!(s.receipt.as_deref(), Some("to #general"));

        let mut c = drafts::Draft::new("3", "x", "", "y", vec![], "clipboard");
        c.request_send().unwrap();
        drafts::process(&mut c, &*sender_for("clipboard"));
        assert_eq!(c.state, drafts::State::Sent);
    }

    /// Answers `exec` from a script of (pid alive?) and a log, and records what was run.
    struct Computer {
        alive: Vec<u32>,
        log: &'static str,
        ran: RefCell<Vec<String>>,
        down: bool,
    }
    impl hyzevm::Cli for Computer {
        fn run(&self, args: &[String]) -> Result<hyzevm::Out> {
            assert_eq!(&args[..3], ["exec", "hz-ada", "--"]);
            let script = args[3].clone();
            self.ran.borrow_mut().push(script.clone());
            if self.down {
                return Ok(hyzevm::Out { code: 1, stderr: "the machine is paused".into(), ..Default::default() });
            }
            let stdout = if script.starts_with("for p in") {
                self.alive.iter().map(|p| format!("{p}\n")).collect::<String>()
            } else {
                self.log.to_string()
            };
            Ok(hyzevm::Out { code: 0, stdout: stdout.into_bytes(), stderr: String::new() })
        }
    }

    fn watch(id: &str, pid: u32, started: i64, log: Option<&str>) -> watches::Watch {
        watches::Watch { id: id.into(), bot: "ada".into(), pid, log_path: log.map(PathBuf::from), started, label: format!("job {id}") }
    }

    #[test]
    fn a_finished_command_wakes_with_its_time_and_log_and_a_running_one_waits() {
        let cli = Computer { alive: vec![20], log: "compiling\ndone in 3m\n", ran: RefCell::default(), down: false };
        let list = [watch("a", 10, 1000, Some("/tmp/it's.log")), watch("b", 20, 1000, None)];
        let ended = ended_on_computer(&cli, &list, 1000 + 185).unwrap();

        assert_eq!(ended.len(), 1);
        let (id, wake) = &ended[0];
        assert_eq!(id, "a");
        assert!(!wake.still_running);
        assert_eq!(wake.duration_secs, 185);
        assert!(wake.message().contains("finished after 3 min") && wake.message().ends_with("done in 3m"));
        let ran = cli.ran.borrow();
        assert_eq!(ran[0], "for p in 10 20; do kill -0 $p 2>/dev/null && echo $p; done; true");
        assert_eq!(ran[1], r"tail -n 20 '/tmp/it'\''s.log'");
    }

    #[test]
    fn a_watch_past_its_lifetime_wakes_even_while_running() {
        let cli = Computer { alive: vec![20], log: "", ran: RefCell::default(), down: false };
        let ended = ended_on_computer(&cli, &[watch("b", 20, 0, None)], watches::MAX_AGE_SECS).unwrap();
        assert!(ended[0].1.still_running && ended[0].1.message().contains("still running"));
    }

    #[test]
    fn a_computer_that_cannot_be_asked_keeps_every_watch() {
        let cli = Computer { alive: vec![], log: "", ran: RefCell::default(), down: true };
        assert!(ended_on_computer(&cli, &[watch("a", 10, 0, None)], 50).is_err());
        assert!(ended_on_computer(&cli, &[], 50).unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_newer_sign_in_card_replaces_the_older_one() {
        let first = tokio::spawn(wait_for_person("mila", json!({"site": "a"})));
        tokio::task::yield_now().await;
        while !WAITING.lock().unwrap().contains_key("mila") {
            tokio::task::yield_now().await;
        }
        let second = tokio::spawn(wait_for_person("mila", json!({"site": "b"})));
        assert_eq!(first.await.unwrap(), Some(false));
        assert_eq!(kit_login_pending("mila".into()).unwrap()["site"], "b");
        kit_login_answer("mila".into(), true).unwrap();
        assert_eq!(second.await.unwrap(), Some(true));
        assert!(kit_login_answer("mila".into(), true).is_err());
    }

    #[test]
    fn a_new_message_is_a_new_request_with_its_own_allowance() {
        let mut f = Factory::default();
        for _ in 0..bot_factory::MAX_PER_REQUEST {
            f.quota.take("ada:0").unwrap();
        }
        assert!(f.quota.take("ada:0").is_err());
        assert!(f.quota.take("ada:1").is_ok());
        observe_user("s-ada");
        observe_user("s-ada");
        assert_eq!(FACTORY.lock().unwrap().requests["s-ada"], 2);
    }
}
