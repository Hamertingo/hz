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
    events::TurnStatus,
    orchestration,
};

static PORT: OnceLock<u16> = OnceLock::new();

/// How many hidden asks may wait at once, host-wide.
const MAX_OUTSTANDING: usize = 64;
/// How long a hidden ask waits, queue and approvals included.
const ASK_TIMEOUT: Duration = Duration::from_secs(600);

/// One of hz's own errands to an agent ([`ask_hidden`]), answered by the turn its
/// own prompt starts. Agents talking to each other never wait: see `talk.rs`.
struct Ask {
    id: u64,
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
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Default::default);

fn forget(id: u64) {
    let mut state = STATE.lock().expect("team state poisoned");
    for asks in state.asks.values_mut() {
        asks.retain(|a| a.id != id);
    }
    state.asks.retain(|_, asks| !asks.is_empty());
}

impl State {
    fn outstanding(&self) -> usize {
        self.asks.values().map(Vec::len).sum()
    }
}

/// Called with every message a session logs, so an ask queued behind a turn is
/// marked started the moment its own prompt becomes that session's next turn.
/// `by_reader` is a message the person wrote, which `talk` gives way to.
pub fn observe_user(session_id: &str, text: &str, by_reader: bool) {
    crate::agent_tools::observe_user(session_id);
    crate::talk::observe_user(session_id, text, by_reader);
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
/// lets `talk` route a thread's answer.
///
/// Returns whether the turn was an errand (an ask, a teammate's thread, a
/// `NO_REPLY`), which is nothing for the reader's inbox.
pub fn observe_completed(session_id: &str, status: &TurnStatus, stop_reason: Option<&str>, final_text: Option<&str>) -> bool {
    let talked = crate::talk::observe_completed(session_id, status, stop_reason, final_text);
    let mut state = STATE.lock().expect("team state poisoned");
    let Some(asks) = state.asks.get_mut(session_id) else { return talked };
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
    answered || talked
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
        // `?s=<session>` names the session the team server was opened for
        // (`agents::mcp_servers`), which is where an answer to it comes back.
        let (path, query) = request.path.split_once('?').unwrap_or((request.path.as_str(), ""));
        let session = query
            .split('&')
            .find_map(|kv| kv.strip_prefix("s="))
            .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
            .map(str::to_string);
        let Some(rest) = path.strip_prefix("/mcp/") else {
            respond(&mut stream, "404 Not Found", None).await?;
            continue;
        };
        // `/mcp/<agent>` is the team's server, `/mcp/<agent>/memory` the memory's,
        // `/mcp/<agent>/hz` what it posts (`agent_tools.rs`), and
        // `/mcp/<agent>/plugin/<id>` the proxy in front of a connected plugin.
        // `/mcp/<agent>/safety/<what>` is plain JSON from the `computer` server, not MCP.
        if let Some((id, what)) = rest.split_once("/safety/") {
            let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
            respond(&mut stream, "200 OK", Some(&crate::safety_tools::http(id, what, &body, &app).await)).await?;
            continue;
        }
        let (agent_id, server) = match rest.split_once('/') {
            Some((id, "memory")) => (id.to_string(), Server::Memory),
            Some((id, "hz")) => (id.to_string(), Server::Hz),
            Some((id, tail)) if crate::kit_mcp::route(tail).is_some() => (id.to_string(), Server::Kit(tail.to_string())),
            Some((id, tail)) if tail.starts_with("plugin/") => {
                (id.to_string(), Server::Plugin(tail["plugin/".len()..].to_string()))
            }
            _ => (rest.to_string(), Server::Team),
        };

        match request.method.as_str() {
            "POST" => {
                let message: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
                match handle(&agent_id, session.as_deref(), server, &message, &app).await {
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
    Hz,
    /// Accounts and documents (`kit_mcp`): `google`, `docs`, `apps`.
    Kit(String),
    /// A plugin's proxy, by plugin id.
    Plugin(String),
}

fn tools() -> Value {
    json!([
        {
            "name": "team_message",
            "description": "Send a message to a teammate by name. It returns at once: tell the person in a line or \
                            two what you passed on, then end your turn. Their answer comes back to this chat by \
                            itself. They cannot see your conversation, so write a complete brief. Inside a \
                            channel, this posts an @Name line for a member there.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "The teammate's name; a unique start of it works too."},
                    "text": {"type": "string", "description": "The message, up to 4000 characters."},
                },
                "required": ["to", "text"],
                "additionalProperties": false,
            },
        },
        {
            "name": "team_list",
            "description": "List your teammates: their names, what each one does, and what they are busy with.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        },
        {
            "name": "post_to_channel",
            "description": "Post a message as yourself in a channel you belong to. An @Name in it wakes that \
                            member, who answers in the channel.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "The channel's name, without the #."},
                    "text": {"type": "string", "description": "The message."},
                },
                "required": ["channel", "text"],
                "additionalProperties": false,
            },
        },
        {
            "name": "read_channel",
            "description": "Without a channel: list the channels you belong to. With one: its newest messages.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "description": "The channel's name, without the #."},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "How many messages; 20 if left out."},
                },
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
    ])
}

/// One JSON-RPC message in, the reply out — `None` for a notification.
async fn handle(agent_id: &str, session: Option<&str>, server: Server, message: &Value, app: &AppHandle) -> Option<Value> {
    if let Server::Plugin(plugin_id) = &server {
        return crate::plugin_proxy::handle(agent_id, plugin_id, message, Some(app)).await;
    }
    if let Server::Kit(name) = &server {
        return crate::kit_mcp::handle(name, agent_id, message, app).await;
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
                "serverInfo": {"name": match server { Server::Memory => "memory", Server::Hz => "hz", _ => "team" }, "version": "1"},
            })
        }
        "tools/list" => json!({"tools": match server {
            Server::Memory => crate::memory_mcp::tools(),
            Server::Hz => crate::agent_tools::tools(),
            _ => crate::safety_tools::with_tools(tools()),
        }}),
        "tools/call" => {
            let name = message
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let args = message.pointer("/params/arguments").cloned().unwrap_or(Value::Null);
            let answered = match server {
                Server::Memory => crate::memory_mcp::call(agent_id, name, &args).await,
                Server::Hz => crate::agent_tools::call(agent_id, name, &args, app).await,
                _ => call(agent_id, session, name, &args, app).await,
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

async fn call(agent_id: &str, session: Option<&str>, name: &str, args: &Value, app: &AppHandle) -> Result<String> {
    let me = agents::by_id(agent_id).context("you are not a known agent")?;
    anyhow::ensure!(agents::tool_enabled(agent_id, "team"), "the team tools are switched off for you");
    if let Some(answered) = crate::safety_tools::call(app, &me, name, args).await {
        return answered;
    }

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
            let status = crate::talk::status();
            Ok(team
                .iter()
                .map(|a| {
                    let mut line = if a.role.is_empty() { a.name.clone() } else { format!("{} \u{2014} {}", a.name, a.role) };
                    if let Some(st) = status.iter().find(|s| s.agent_id == a.id) {
                        let names = |ids: &[String]| ids.iter().filter_map(|id| agents::name_of(id)).collect::<Vec<_>>().join(", ");
                        if !st.working_for.is_empty() {
                            line.push_str(&format!(" (working for {})", names(&st.working_for)));
                        } else if !st.waiting_for.is_empty() {
                            line.push_str(&format!(" (waiting for {})", names(&st.waiting_for)));
                        }
                    }
                    line
                })
                .collect::<Vec<_>>()
                .join("\n"))
        }
        // `team_ask` was the blocking ask. Kept as a name so an agent that still
        // knows it gets the same non-blocking send rather than an error.
        "team_message" | "team_ask" => {
            let arg = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or_default().trim();
            anyhow::ensure!(!arg("to").is_empty() && !arg("text").is_empty(), "team_message needs `to` and `text`");
            crate::talk::send(app, &me, session, arg("to"), arg("text")).await
        }
        "post_to_channel" => {
            let arg = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or_default().trim().to_string();
            crate::channels::tool_post(app, agent_id, &arg("channel"), &arg("text")).await
        }
        "read_channel" => {
            let channel = args.get("channel").and_then(Value::as_str).map(str::trim);
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(20) as usize;
            crate::channels::tool_read(app, agent_id, channel, limit).await
        }
        other => anyhow::bail!("no tool {other}"),
    }
}

/// Sends `prompt` to an agent's own conversation as if from nobody and waits for
/// the turn it starts to close, returning what the agent said.
///
/// For hz's own errands (tidying memory) that need the agent's answer: the
/// answer is the final text of the turn that carried this exact prompt.
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
            prompt: prompt.to_string(),
            started: false,
            reply: Some(tx),
        });
        id
    };

    if let Err(e) = orchestration::deliver(&session, None, prompt, app).await {
        forget(id);
        return Err(e);
    }

    match tokio::time::timeout(ASK_TIMEOUT, rx).await {
        Ok(Ok(Ok(answer))) => Ok(answer),
        Ok(Ok(Err(why))) => anyhow::bail!("{} did not finish: {why}", target.name),
        Ok(Err(_)) => anyhow::bail!("{}'s answer was lost", target.name),
        Err(_) => {
            forget(id);
            anyhow::bail!("{} did not answer within ten minutes", target.name)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(id: u64, prompt: &str) -> (Ask, oneshot::Receiver<Result<String, String>>) {
        let (tx, rx) = oneshot::channel();
        (Ask { id, prompt: prompt.into(), started: false, reply: Some(tx) }, rx)
    }

    #[test]
    fn an_ask_is_answered_by_the_turn_its_own_prompt_started() {
        let session = "team-test-session-1";
        let (waiting, mut rx) = ask(10, "the question");
        STATE.lock().unwrap().asks.entry(session.into()).or_default().push(waiting);

        // A turn that closes before this ask's prompt began is somebody else's.
        observe_completed(session, &TurnStatus::Success, None, Some("older answer"));
        assert!(rx.try_recv().is_err(), "the earlier turn must not answer it");

        observe_user(session, "the question", false);
        observe_completed(session, &TurnStatus::Success, None, Some("  forty-two \n"));

        assert_eq!(rx.try_recv().unwrap(), Ok("forty-two".to_string()));
        assert!(!STATE.lock().unwrap().asks.contains_key(session));
    }

    #[test]
    fn a_turn_that_fails_fails_the_ask() {
        let session = "team-test-session-2";
        let (waiting, mut rx) = ask(11, "q");
        STATE.lock().unwrap().asks.entry(session.into()).or_default().push(waiting);

        observe_user(session, "q", false);
        observe_completed(session, &TurnStatus::Error, None, None);

        assert!(rx.try_recv().unwrap().is_err());
    }

    #[test]
    fn a_turn_that_says_no_reply_is_an_errand() {
        assert!(observe_completed("team-test-session-3", &TurnStatus::Success, Some("end_turn"), Some("NO_REPLY")));
        assert!(!observe_completed("team-test-session-3", &TurnStatus::Success, Some("end_turn"), Some("Done.")));
    }

    #[test]
    fn the_blocking_ask_is_gone_from_the_tool_list() {
        let list = tools();
        let names: Vec<&str> = list.as_array().unwrap().iter().filter_map(|t| t["name"].as_str()).collect();
        assert!(!names.contains(&"team_ask"));
        for want in ["team_message", "team_list", "post_to_channel", "read_channel"] {
            assert!(names.contains(&want), "{want} is missing");
        }
    }
}
