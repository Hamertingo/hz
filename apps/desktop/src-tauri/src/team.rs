//! The `team` MCP server: how one agent reaches another.
//!
//! A plain HTTP endpoint on loopback that speaks just enough MCP — `initialize`,
//! `tools/list`, `tools/call` — for Claude, Codex and OpenCode, all of which
//! accept an HTTP server in `session/new`. Each agent is handed its own URL
//! (`/mcp/<agent id>`), so the caller's identity is the path and no tool takes a
//! "who am I" argument an agent could get wrong.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex, OnceLock},
    time::Duration,
};

use anyhow::{Context, Result};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
};

use crate::{
    agents,
    events::{MessageSender, TurnStatus},
    orchestration,
};

static PORT: OnceLock<u16> = OnceLock::new();

/// The workspace's own limits (Settings → Agent defaults), or the built-in ones
/// where it says nothing. Taken from the *asking* agent's workspace.
fn limits_for(agent: &agents::AgentRecord) -> (u32, Duration) {
    let d = match agent.workspace_id.as_deref() {
        Some(id) => crate::workspaces::defaults_of(id),
        None => crate::workspaces::first_defaults(),
    };
    (d.handoffs, Duration::from_secs(u64::from(d.wait_mins) * 60))
}

/// How many hand-offs one request chain may make is the workspace's setting
/// (`limits_for`; 8 unless the reader changed it). Counted along the chain — A asks
/// B, B asks C — so it bounds A → B → A → B even when few requests are open at once.
/// A new message from the reader to an agent starts a fresh allowance.
/// How many asks may wait at once, host-wide.
const MAX_OUTSTANDING: usize = 64;
/// How long an ask waits, queue and approvals included.
const ASK_TIMEOUT: Duration = Duration::from_secs(600);

struct Ask {
    id: u64,
    from: String,
    to: String,
    /// The exact prompt the recipient was sent, which is how its `user_message`
    /// is recognised when the ask was queued behind a turn in flight.
    prompt: String,
    started: bool,
    reply: Option<oneshot::Sender<Result<String, String>>>,
}

#[derive(Default)]
struct State {
    next: u64,
    /// Keyed by the recipient's session, which is where events arrive.
    asks: HashMap<String, Vec<Ask>>,
    /// The hand-off depth of the request each agent is serving right now.
    serving: HashMap<String, u32>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Default::default);

/// Asks to a conversation that does not exist yet, until it is made and they can be
/// filed under its session.
static PENDING_NEW: LazyLock<Mutex<HashMap<u64, Ask>>> = LazyLock::new(Default::default);

/// Drops an ask that will not be answered and frees the recipient's allowance.
fn forget(recipient: &str, ask: Option<u64>) {
    let mut state = STATE.lock().expect("team state poisoned");
    state.serving.remove(recipient);
    if let Some(id) = ask {
        PENDING_NEW.lock().expect("team state poisoned").remove(&id);
        for asks in state.asks.values_mut() {
            asks.retain(|a| a.id != id);
        }
        state.asks.retain(|_, asks| !asks.is_empty());
    }
}

impl State {
    fn outstanding(&self) -> usize {
        self.asks.values().map(Vec::len).sum()
    }

    /// Whether `from` already waits on `to`, directly or through others — a new
    /// edge `from → to` would then close a cycle and neither could ever answer.
    fn would_wait_in_a_circle(&self, from: &str, to: &str) -> bool {
        let edges: Vec<(&str, &str)> = self
            .asks
            .values()
            .flatten()
            .map(|a| (a.from.as_str(), a.to.as_str()))
            .collect();

        let mut frontier = vec![to];
        let mut seen: Vec<&str> = Vec::new();
        while let Some(at) = frontier.pop() {
            if at == from {
                return true;
            }
            if seen.contains(&at) {
                continue;
            }
            seen.push(at);
            frontier.extend(edges.iter().filter(|(f, _)| *f == at).map(|(_, t)| *t));
        }
        false
    }

    fn duplicate(&self, from: &str, to: &str) -> bool {
        self.asks.values().flatten().any(|a| a.from == from && a.to == to)
    }
}

/// Called with every message a session logs, so an ask queued behind a turn is
/// marked started the moment its own prompt becomes that session's next turn.
pub fn observe_user(session_id: &str, text: &str) {
    let mut state = STATE.lock().expect("team state poisoned");
    if let Some(ask) = state
        .asks
        .get_mut(session_id)
        .and_then(|asks| asks.iter_mut().find(|a| !a.started && a.prompt == text))
    {
        ask.started = true;
    }
}

/// Called when a session's turn closes: answers the asks that turn carried and
/// frees the agent's hand-off allowance.
///
/// Returns whether it answered one: a turn that did was a teammate's errand, and
/// nothing in the reader's inbox.
pub fn observe_completed(session_id: &str, status: &TurnStatus, final_text: Option<&str>) -> bool {
    let mut state = STATE.lock().expect("team state poisoned");
    if let Some(agent) = agents::agent_of(session_id) {
        state.serving.remove(&agent.id);
    }

    let Some(asks) = state.asks.get_mut(session_id) else { return false };
    let mut waiting = Vec::new();
    let mut answered = false;
    for ask in std::mem::take(asks) {
        if ask.started {
            answered = true;
            if let Some(tx) = ask.reply {
                let answer = match status {
                    TurnStatus::Success => Ok(final_text.unwrap_or_default().trim().to_string()),
                    TurnStatus::Error => Err("it stopped before answering".to_string()),
                };
                let _ = tx.send(answer);
            }
        } else {
            waiting.push(ask);
        }
    }
    *asks = waiting;
    if asks.is_empty() {
        state.asks.remove(session_id);
    }
    answered
}


/// The port the server is on, once it is up.
pub fn port() -> Option<u16> {
    PORT.get().copied()
}

/// Binds loopback on a free port and serves for the life of the process.
///
/// Loopback only: anything on the machine can reach it, which is the same reach
/// the orchestration socket gives, and the agent ids in the path are not
/// guessable by a page in the reader's browser.
pub async fn serve(app: AppHandle) -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("could not bind the team server")?;
    let _ = PORT.set(listener.local_addr()?.port());

    loop {
        let (stream, _) = listener.accept().await?;
        let app = app.clone();
        tokio::spawn(async move {
            if let Err(e) = connection(stream, app).await {
                eprintln!("[team err] {e:#}");
            }
        });
    }
}

struct Request {
    method: String,
    path: String,
    body: Vec<u8>,
}

/// Reads one HTTP/1.1 request, or `None` when the peer closed between requests.
async fn read_request(stream: &mut TcpStream, buf: &mut Vec<u8>) -> Result<Option<Request>> {
    let head_end = loop {
        if let Some(at) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break at + 4;
        }
        let mut chunk = [0u8; 4096];
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > 1 << 20 {
            anyhow::bail!("request head too large");
        }
    };

    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.lines();
    let mut first = lines.next().unwrap_or_default().split_whitespace();
    let method = first.next().unwrap_or_default().to_string();
    let path = first.next().unwrap_or_default().to_string();
    let length = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse::<usize>().ok())
        .unwrap_or(0);

    while buf.len() < head_end + length {
        let mut chunk = [0u8; 4096];
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            anyhow::bail!("connection closed mid-body");
        }
        buf.extend_from_slice(&chunk[..n]);
    }

    let body = buf[head_end..head_end + length].to_vec();
    buf.drain(..head_end + length);
    Ok(Some(Request { method, path, body }))
}

async fn respond(stream: &mut TcpStream, status: &str, body: Option<&Value>) -> Result<()> {
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let content_type = if body.is_some() {
        "Content-Type: application/json\r\n"
    } else {
        ""
    };
    let head = format!(
        "HTTP/1.1 {status}\r\n{content_type}Content-Length: {}\r\n\r\n",
        payload.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(payload.as_bytes()).await?;
    Ok(())
}

async fn connection(mut stream: TcpStream, app: AppHandle) -> Result<()> {
    let mut buf = Vec::new();

    while let Some(request) = read_request(&mut stream, &mut buf).await? {
        let Some(rest) = request.path.strip_prefix("/mcp/") else {
            respond(&mut stream, "404 Not Found", None).await?;
            continue;
        };
        // `/mcp/<agent>` is the team's server, `/mcp/<agent>/memory` the memory's,
        // and `/mcp/<agent>/plugin/<id>` the proxy in front of a connected plugin.
        let (agent_id, server) = match rest.split_once('/') {
            Some((id, "memory")) => (id.to_string(), Server::Memory),
            Some((id, tail)) if tail.starts_with("plugin/") => {
                (id.to_string(), Server::Plugin(tail["plugin/".len()..].to_string()))
            }
            _ => (rest.to_string(), Server::Team),
        };

        match request.method.as_str() {
            "POST" => {
                let message: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
                match handle(&agent_id, server, &message, &app).await {
                    Some(reply) => respond(&mut stream, "200 OK", Some(&reply)).await?,
                    // A notification has no answer, and MCP wants a bare 202.
                    None => respond(&mut stream, "202 Accepted", None).await?,
                }
            }
            "DELETE" => respond(&mut stream, "200 OK", None).await?,
            _ => respond(&mut stream, "405 Method Not Allowed", None).await?,
        }
    }
    Ok(())
}

/// Which of the servers on this port a request is for.
#[derive(Clone, PartialEq)]
enum Server {
    Team,
    Memory,
    /// A plugin's proxy, by plugin id.
    Plugin(String),
}

fn tools() -> Value {
    json!([
        {
            "name": "team_list",
            "description": "List the other agents on the team: their names and what each one does.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        },
        {
            "name": "team_ask",
            "description": "Ask a teammate by name and wait for their answer, which comes back as this \
                            tool's result. Use it when you need the answer to carry on. Give them \
                            everything they need; they cannot see your conversation. Takes as long as \
                            they do, up to ten minutes.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "The teammate's name, as team_list shows it."},
                    "text": {"type": "string", "description": "The question or request."},
                },
                "required": ["to", "text"],
                "additionalProperties": false,
            },
        },
        {
            "name": "ask_user",
            "description": "Ask the person you work for a question and wait for their answer, which \
                            comes back as this tool's result. It lands in their Inbox. Use it when you \
                            cannot go on without a decision only they can make. Offer up to three \
                            choices when the answer is one of a few; they can always answer in their \
                            own words. If nobody answers within ten minutes the result is \"no answer\".",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The question, in one or two sentences."},
                    "choices": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 3,
                        "description": "Optional short answers to pick from.",
                    },
                },
                "required": ["question"],
                "additionalProperties": false,
            },
        },
        {
            "name": "task_create",
            "description": "Take on a task in a channel you belong to, so it shows as a card in the \
                            channel and in its Tasks list. You own it. Use the channel's name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "The channel's name, without the #."},
                    "title": {"type": "string", "description": "What the task is, in a few words."},
                },
                "required": ["channel", "title"],
                "additionalProperties": false,
            },
        },
        {
            "name": "task_update",
            "description": "Change a task you own in a channel: its status (waiting, writing, done, \
                            waiting_for_you) and, when it is done, a short result.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "The channel's name, without the #."},
                    "task": {"type": "string", "description": "The task's title."},
                    "status": {"type": "string", "enum": ["waiting", "writing", "done", "waiting_for_you"]},
                    "result": {"type": "string", "description": "What came of it, when it is done."},
                },
                "required": ["channel", "task"],
                "additionalProperties": false,
            },
        },
        {
            "name": "team_message",
            "description": "Send a message to a teammate by name. It lands in their conversation and \
                            they answer in yours if a reply is needed. Say what you need and why; they \
                            cannot see your conversation.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "The teammate's name, as team_list shows it."},
                    "text": {"type": "string", "description": "The message."},
                },
                "required": ["to", "text"],
                "additionalProperties": false,
            },
        },
    ])
}

/// One JSON-RPC message in, the reply out — `None` for a notification.
async fn handle(agent_id: &str, server: Server, message: &Value, app: &AppHandle) -> Option<Value> {
    if let Server::Plugin(plugin_id) = &server {
        return crate::plugin_proxy::handle(agent_id, plugin_id, message, Some(app)).await;
    }
    let id = message.get("id")?.clone();
    let method = message.get("method").and_then(Value::as_str).unwrap_or_default();

    let result = match method {
        "initialize" => {
            let version = message
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-03-26");
            json!({
                "protocolVersion": version,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": if server == Server::Memory { "memory" } else { "team" }, "version": "1"},
            })
        }
        "tools/list" => json!({"tools": if server == Server::Memory { crate::memory_mcp::tools() } else { tools() }}),
        "tools/call" => {
            let name = message
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let args = message.pointer("/params/arguments").cloned().unwrap_or(Value::Null);
            let answered = if server == Server::Memory {
                crate::memory_mcp::call(agent_id, name, &args).await
            } else {
                call(agent_id, name, &args, app).await
            };
            let (text, is_error) = match answered {
                Ok(text) => (text, false),
                Err(e) => (format!("{e:#}"), true),
            };
            json!({"content": [{"type": "text", "text": text}], "isError": is_error})
        }
        "ping" => json!({}),
        _ => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": -32601, "message": format!("no method {method}")},
            }))
        }
    };

    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

async fn call(agent_id: &str, name: &str, args: &Value, app: &AppHandle) -> Result<String> {
    let me = agents::by_id(agent_id).context("you are not a known agent")?;
    anyhow::ensure!(agents::tool_enabled(agent_id, "team"), "the team tools are switched off for you");

    match name {
        "ask_user" => {
            let question = args.get("question").and_then(Value::as_str).unwrap_or_default().trim();
            anyhow::ensure!(!question.is_empty(), "ask_user needs a `question`");
            let choices: Vec<String> = args
                .get("choices")
                .and_then(Value::as_array)
                .map(|c| c.iter().filter_map(|x| x.as_str()).map(str::trim).filter(|x| !x.is_empty()).take(3).map(str::to_string).collect())
                .unwrap_or_default();
            crate::inbox::ask_user(app, &me, question, choices).await
        }
        "task_create" => {
            let arg = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or_default().trim().to_string();
            crate::channels::tool_task_create(app, agent_id, &arg("channel"), &arg("title")).await
        }
        "task_update" => {
            let arg = |k: &str| args.get(k).and_then(Value::as_str).map(|v| v.trim().to_string());
            crate::channels::tool_task_update(
                app,
                agent_id,
                &arg("channel").unwrap_or_default(),
                &arg("task").unwrap_or_default(),
                arg("status").as_deref(),
                arg("result").as_deref(),
            )
            .await
        }
        "team_list" => {
            let team: Vec<_> = agents::teammates(agent_id)
                .into_iter()
                .filter(|a| agents::may_talk(&me, a).is_ok())
                .collect();
            if team.is_empty() {
                return Ok("You have no teammates yet.".into());
            }
            Ok(team
                .iter()
                .map(|a| {
                    if a.role.is_empty() {
                        a.name.clone()
                    } else {
                        format!("{} — {}", a.name, a.role)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n"))
        }
        "team_message" | "team_ask" => {
            let asking = name == "team_ask";
            let to = args.get("to").and_then(Value::as_str).unwrap_or_default().trim();
            let text = args.get("text").and_then(Value::as_str).unwrap_or_default().trim();
            if to.is_empty() || text.is_empty() {
                anyhow::bail!("{name} needs `to` and `text`");
            }

            let target = agents::teammates(agent_id)
                .into_iter()
                .find(|a| a.name.eq_ignore_ascii_case(to))
                .with_context(|| format!("no teammate named {to}; team_list shows who is there"))?;
            // The reader's setting for who may reach this agent, kept here at
            // the one door every agent-to-agent message goes through.
            agents::may_talk(&me, &target).map_err(anyhow::Error::msg)?;
            let from = MessageSender {
                session_id: me.session_id.clone().unwrap_or_default(),
                title: me.name.clone(),
            };
            // The wrapper is rebuilt on the webview side (`teamBody` in
            // `lib/relay.ts`) to show only the words; change both together.
            let prompt = if asking {
                format!(
                    "[message from your teammate {}]\n\n{text}\n\n(Answer directly: your answer goes back to {}. Do not use team_message to answer.)",
                    me.name, me.name
                )
            } else {
                format!(
                    "[message from your teammate {}]\n\n{text}\n\n(Answer with team_message to {} if a reply is needed.)",
                    me.name, me.name
                )
            };

            let existing = match target.session_id.as_deref() {
                Some(id) => orchestration::resolved_session(Some(id)).await,
                None => None,
            };

            let (max_handoffs, ask_timeout) = limits_for(&me);
            // Everything that can refuse happens before anything is sent.
            let waiting = {
                let mut state = STATE.lock().expect("team state poisoned");
                let depth = state.serving.get(&me.id).copied().unwrap_or(0) + 1;
                anyhow::ensure!(
                    depth <= max_handoffs,
                    "this chain of requests has already been handed on {max_handoffs} times; \
                     stop and tell the person what is unresolved instead of asking again"
                );

                let waiting = if asking {
                    anyhow::ensure!(
                        !state.duplicate(&me.id, &target.id),
                        "you are already waiting on {}; wait for that answer first",
                        target.name
                    );
                    anyhow::ensure!(
                        !state.would_wait_in_a_circle(&me.id, &target.id),
                        "{} is already waiting, directly or through others, on your answer; \
                         asking back would leave you both waiting forever. Use team_message instead",
                        target.name
                    );
                    anyhow::ensure!(state.outstanding() < MAX_OUTSTANDING, "too many requests are waiting");

                    // For a conversation that exists, registered before the send:
                    // its prompt is logged inside the send, and an ask not yet
                    // known would miss that line.
                    let (tx, rx) = oneshot::channel();
                    state.next += 1;
                    let id = state.next;
                    let ask = Ask {
                        id,
                        from: me.id.clone(),
                        to: target.id.clone(),
                        prompt: prompt.clone(),
                        started: false,
                        reply: Some(tx),
                    };
                    match &existing {
                        Some(item) => state.asks.entry(item.session_id.clone()).or_default().push(ask),
                        None => {
                            PENDING_NEW.lock().expect("team state poisoned").insert(id, ask);
                        }
                    }
                    Some((id, rx))
                } else {
                    None
                };

                state.serving.insert(target.id.clone(), depth);
                waiting
            };

            let delivered = match &existing {
                Some(item) => orchestration::deliver(item, Some(from), &prompt, app).await,
                None => orchestration::start_agent_session(&target, &prompt, Some(from), app)
                    .await
                    .map(|_| false),
            };
            let queued = match delivered {
                Ok(queued) => queued,
                Err(e) => {
                    forget(&target.id, waiting.as_ref().map(|(id, _)| *id));
                    return Err(e);
                }
            };

            let Some((id, rx)) = waiting else {
                return Ok(if queued {
                    format!("Queued for {}: they are mid-turn and will read it next.", target.name)
                } else {
                    format!("Delivered to {}.", target.name)
                });
            };

            // A conversation opened by this very ask has no turn before it: its
            // first turn is the answer, so it is registered as started.
            if existing.is_none() {
                if let Some(mut ask) = PENDING_NEW.lock().expect("team state poisoned").remove(&id) {
                    ask.started = true;
                    if let Some(session) = agents::by_id(&target.id).and_then(|a| a.session_id) {
                        STATE.lock().expect("team state poisoned").asks.entry(session).or_default().push(ask);
                    }
                }
            }

            match tokio::time::timeout(ask_timeout, rx).await {
                Ok(Ok(Ok(answer))) if answer.is_empty() => {
                    Ok(format!("{} finished without writing an answer.", target.name))
                }
                Ok(Ok(Ok(answer))) => Ok(format!("{} answered:\n\n{answer}", target.name)),
                Ok(Ok(Err(why))) => anyhow::bail!("{} did not answer: {why}", target.name),
                Ok(Err(_)) => anyhow::bail!("{}'s answer was lost", target.name),
                Err(_) => {
                    forget(&target.id, Some(id));
                    anyhow::bail!(
                        "{} did not answer within {} minutes",
                        target.name,
                        ask_timeout.as_secs() / 60
                    )
                }
            }
        }
        other => anyhow::bail!("no tool {other}"),
    }
}

/// Sends `prompt` to an agent's own conversation as if from nobody and waits for
/// the turn it starts to close, returning what the agent said.
///
/// For hz's own errands (tidying memory) that need the agent's answer. It rides
/// the same machinery as `team_ask` — the answer is the final text of the turn
/// that carried this exact prompt — but skips the teammate checks, since the
/// reader, not an agent, is asking.
pub async fn ask_hidden(target: &agents::AgentRecord, prompt: &str, app: &AppHandle) -> Result<String> {
    let session = orchestration::resolved_session(target.session_id.as_deref())
        .await
        .with_context(|| format!("{} has no conversation yet; say hello first", target.name))?;

    let (tx, rx) = oneshot::channel();
    let id = {
        let mut state = STATE.lock().expect("team state poisoned");
        anyhow::ensure!(state.outstanding() < MAX_OUTSTANDING, "too many requests are waiting");
        state.next += 1;
        let id = state.next;
        state.asks.entry(session.session_id.clone()).or_default().push(Ask {
            id,
            from: "hz".into(),
            to: target.id.clone(),
            prompt: prompt.to_string(),
            started: false,
            reply: Some(tx),
        });
        id
    };

    if let Err(e) = orchestration::deliver(&session, None, prompt, app).await {
        forget(&target.id, Some(id));
        return Err(e);
    }

    match tokio::time::timeout(ASK_TIMEOUT, rx).await {
        Ok(Ok(Ok(answer))) => Ok(answer),
        Ok(Ok(Err(why))) => anyhow::bail!("{} did not finish: {why}", target.name),
        Ok(Err(_)) => anyhow::bail!("{}'s answer was lost", target.name),
        Err(_) => {
            forget(&target.id, Some(id));
            anyhow::bail!("{} did not answer within ten minutes", target.name)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(id: u64, from: &str, to: &str, prompt: &str) -> (Ask, oneshot::Receiver<Result<String, String>>) {
        let (tx, rx) = oneshot::channel();
        (
            Ask { id, from: from.into(), to: to.into(), prompt: prompt.into(), started: false, reply: Some(tx) },
            rx,
        )
    }

    #[test]
    fn asking_back_along_a_chain_is_a_circle() {
        let mut state = State::default();
        state.asks.entry("sb".into()).or_default().push(ask(1, "a", "b", "p1").0);
        state.asks.entry("sc".into()).or_default().push(ask(2, "b", "c", "p2").0);

        assert!(state.would_wait_in_a_circle("c", "a"), "c asking a closes a -> b -> c -> a");
        assert!(state.would_wait_in_a_circle("b", "a"));
        assert!(!state.would_wait_in_a_circle("c", "d"));
        assert!(state.duplicate("a", "b"));
        assert!(!state.duplicate("b", "a"));
    }

    #[test]
    fn an_ask_is_answered_by_the_turn_its_own_prompt_started() {
        let session = "team-test-session-1";
        let (waiting, mut rx) = ask(10, "a", "b", "the question");
        STATE.lock().unwrap().asks.entry(session.into()).or_default().push(waiting);

        // A turn that closes before this ask's prompt began is somebody else's.
        observe_completed(session, &TurnStatus::Success, Some("older answer"));
        assert!(rx.try_recv().is_err(), "the earlier turn must not answer it");

        observe_user(session, "the question");
        observe_completed(session, &TurnStatus::Success, Some("  forty-two \n"));

        assert_eq!(rx.try_recv().unwrap(), Ok("forty-two".to_string()));
        assert!(!STATE.lock().unwrap().asks.contains_key(session));
    }

    #[test]
    fn a_turn_that_fails_fails_the_ask() {
        let session = "team-test-session-2";
        let (waiting, mut rx) = ask(11, "a", "b", "q");
        STATE.lock().unwrap().asks.entry(session.into()).or_default().push(waiting);

        observe_user(session, "q");
        observe_completed(session, &TurnStatus::Error, None);

        assert!(rx.try_recv().unwrap().is_err());
    }
}
