//! A small MCP client: just enough to connect to a server over stdio or Streamable
//! HTTP, list its tools and call one.
//!
//! Two callers need it. Testing a connection lists a server's real tools before
//! the reader trusts it, and the plugin proxy ([`crate::plugin_proxy`]) keeps one
//! open per plugin to forward an agent's calls. Neither wants a full SDK, and the
//! agent CLIs already speak the protocol to the proxy, so this side stays at the
//! three methods the proxy forwards.

use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use ts_rs::TS;

use crate::proc::HideConsole;

/// The protocol revision this client asks for. A server may answer with an older
/// one, which is accepted as it stands.
const PROTOCOL: &str = "2025-06-18";

/// How long a handshake or a listing may take. `npx` downloading a package for
/// the first time is the slow case this has to cover.
pub const SETUP_TIMEOUT: Duration = Duration::from_secs(90);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// How to reach a server. Secrets are already substituted in: this type lives only
/// as long as a connection and is never stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Spec {
    Stdio { command: String, args: Vec<String>, env: BTreeMap<String, String> },
    Http { url: String, headers: BTreeMap<String, String> },
}

/// One tool as the server describes it. The schema is kept whole because the
/// proxy hands it back to the agent unchanged.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct RemoteTool {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    #[ts(type = "Record<string, unknown> | null")]
    pub input_schema: Option<Value>,
}

/// The server answered 401: it wants a token this client does not hold. Kept as a
/// type so the caller can tell "sign in" from every other failure.
#[derive(Debug)]
pub struct Unauthorized {
    /// Where the server says its OAuth metadata lives, when it says.
    pub resource_metadata: Option<String>,
}

impl fmt::Display for Unauthorized {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "the server wants you to sign in (401)")
    }
}
impl std::error::Error for Unauthorized {}

/// A live connection to one server.
pub struct Client {
    conn: Conn,
}

enum Conn {
    Stdio(StdioConn),
    Http(HttpConn),
}

impl Client {
    /// Connects and completes the MCP handshake, or says why it could not.
    pub async fn connect(spec: &Spec) -> Result<Client> {
        let conn = match spec {
            Spec::Stdio { command, args, env } => Conn::Stdio(StdioConn::spawn(command, args, env).await?),
            Spec::Http { url, headers } => Conn::Http(HttpConn::new(url, headers)?),
        };
        let client = Client { conn };
        let init = client
            .request(
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL,
                    "capabilities": {},
                    "clientInfo": {"name": "hz", "version": env!("CARGO_PKG_VERSION")},
                }),
                SETUP_TIMEOUT,
            )
            .await
            .context("the server did not complete the MCP handshake")?;
        if let Conn::Http(h) = &client.conn {
            h.set_protocol(init["protocolVersion"].as_str().unwrap_or(PROTOCOL));
        }
        client.notify("notifications/initialized", json!({})).await?;
        Ok(client)
    }

    /// Every tool the server offers, following its pagination.
    pub async fn list_tools(&self) -> Result<Vec<RemoteTool>> {
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..20 {
            let params = cursor.as_ref().map_or_else(|| json!({}), |c| json!({"cursor": c}));
            let page = self.request("tools/list", params, SETUP_TIMEOUT).await?;
            let tools: Vec<RemoteTool> = serde_json::from_value(page["tools"].clone()).unwrap_or_default();
            out.extend(tools);
            match page["nextCursor"].as_str() {
                Some(c) if !c.is_empty() => cursor = Some(c.to_string()),
                _ => break,
            }
        }
        Ok(out)
    }

    /// Calls one tool and returns the server's result object whole.
    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<Value> {
        self.request("tools/call", json!({"name": name, "arguments": arguments}), CALL_TIMEOUT).await
    }

    async fn request(&self, method: &str, params: Value, limit: Duration) -> Result<Value> {
        let sent = async {
            match &self.conn {
                Conn::Stdio(s) => s.request(method, params).await,
                Conn::Http(h) => h.request(method, params).await,
            }
        };
        tokio::time::timeout(limit, sent)
            .await
            .map_err(|_| anyhow!("{method} timed out after {}s", limit.as_secs()))?
    }

    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        match &self.conn {
            Conn::Stdio(s) => s.notify(method, params).await,
            Conn::Http(h) => h.notify(method, params).await,
        }
    }
}

/// Reads the `result` of a JSON-RPC reply, or turns its `error` into one.
fn result_of(reply: &Value) -> Result<Value> {
    if let Some(e) = reply.get("error") {
        let message = e["message"].as_str().unwrap_or("the server returned an error");
        bail!("{message}");
    }
    Ok(reply["result"].clone())
}

type Waiters = Arc<StdMutex<HashMap<u64, oneshot::Sender<Value>>>>;

struct StdioConn {
    stdin: Mutex<ChildStdin>,
    waiters: Waiters,
    next: AtomicU64,
    /// Held so dropping the connection kills the child.
    _child: Child,
    /// The tail of the server's stderr, which is where "package not found" lands.
    stderr_tail: Arc<StdMutex<String>>,
}

impl StdioConn {
    async fn spawn(command: &str, args: &[String], env: &BTreeMap<String, String>) -> Result<Self> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .envs(env)
            .env("PATH", crate::binpath::child_path(crate::binpath::resolved_bin_dirs()))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd
            .hide_console()
            .spawn()
            .with_context(|| format!("could not start `{command}`; is it installed?"))?;
        let stdin = child.stdin.take().context("no stdin on the server")?;
        let stdout = child.stdout.take().context("no stdout on the server")?;
        let stderr = child.stderr.take().context("no stderr on the server")?;

        let waiters: Waiters = Arc::default();
        let tail: Arc<StdMutex<String>> = Arc::default();

        let t = tail.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut tail = t.lock().expect("stderr tail poisoned");
                tail.push_str(&line);
                tail.push('\n');
                let len = tail.len();
                if len > 2000 {
                    let cut = tail.ceil_char_boundary(len - 2000);
                    tail.drain(..cut);
                }
            }
        });

        let w = waiters.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
                // Replies carry an id and no method; anything else is the server
                // talking to us, which this client does not serve.
                if msg.get("method").is_none() {
                    if let Some(id) = msg["id"].as_u64() {
                        if let Some(tx) = w.lock().expect("waiters poisoned").remove(&id) {
                            let _ = tx.send(msg);
                        }
                    }
                }
            }
            // The child ended: wake every waiter with an error rather than leave
            // each to its timeout.
            for (_, tx) in w.lock().expect("waiters poisoned").drain() {
                let _ = tx.send(json!({"error": {"message": "the server closed its output"}}));
            }
        });

        Ok(StdioConn { stdin: Mutex::new(stdin), waiters, next: AtomicU64::new(1), _child: child, stderr_tail: tail })
    }

    async fn write(&self, msg: &Value) -> Result<()> {
        let mut line = msg.to_string();
        line.push('\n');
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await.context("could not write to the server")?;
        stdin.flush().await?;
        Ok(())
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.waiters.lock().expect("waiters poisoned").insert(id, tx);
        self.write(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})).await?;
        let reply = rx.await.map_err(|_| anyhow!("the server went away"))?;
        result_of(&reply).map_err(|e| {
            let tail = self.stderr_tail.lock().expect("stderr tail poisoned").trim().to_string();
            if tail.is_empty() {
                e
            } else {
                anyhow!("{e}\n{}", last_lines(&tail, 4))
            }
        })
    }

    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        self.write(&json!({"jsonrpc": "2.0", "method": method, "params": params})).await
    }
}

fn last_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

struct HttpConn {
    http: reqwest::Client,
    url: String,
    headers: BTreeMap<String, String>,
    session: StdMutex<Option<String>>,
    protocol: StdMutex<String>,
    next: AtomicU64,
}

impl HttpConn {
    fn new(url: &str, headers: &BTreeMap<String, String>) -> Result<Self> {
        let parsed = reqwest::Url::parse(url).with_context(|| format!("`{url}` is not a URL"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            bail!("a server URL starts with http:// or https://");
        }
        Ok(HttpConn {
            http: reqwest::Client::builder().timeout(Duration::from_secs(300)).build()?,
            url: url.to_string(),
            headers: headers.clone(),
            session: StdMutex::new(None),
            protocol: StdMutex::new(PROTOCOL.to_string()),
            next: AtomicU64::new(1),
        })
    }

    fn set_protocol(&self, version: &str) {
        *self.protocol.lock().expect("protocol poisoned") = version.to_string();
    }

    fn post(&self, body: &Value) -> reqwest::RequestBuilder {
        let mut req = self
            .http
            .post(&self.url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", self.protocol.lock().expect("protocol poisoned").clone())
            .json(body);
        if let Some(s) = self.session.lock().expect("session poisoned").clone() {
            req = req.header("Mcp-Session-Id", s);
        }
        for (k, v) in &self.headers {
            req = req.header(k, v);
        }
        req
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let resp = self
            .post(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))
            .send()
            .await
            .context("could not reach the server")?;
        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            let meta = resp
                .headers()
                .get("www-authenticate")
                .and_then(|v| v.to_str().ok())
                .and_then(resource_metadata_of);
            return Err(Unauthorized { resource_metadata: meta }.into());
        }
        if let Some(s) = resp.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
            *self.session.lock().expect("session poisoned") = Some(s.to_string());
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            bail!("the server answered {status}: {}", body.chars().take(200).collect::<String>());
        }
        let is_sse = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|t| t.starts_with("text/event-stream"));
        if !is_sse {
            let reply: Value = resp.json().await.context("the server's reply was not JSON")?;
            return result_of(&reply);
        }

        // The reply rides an event stream that may also carry notifications and
        // may stay open: read events until the one for this id arrives.
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        while let Some(chunk) = stream.next().await {
            buf.push_str(&String::from_utf8_lossy(&chunk.context("the event stream broke")?));
            while let Some(event) = take_event(&mut buf) {
                if let Some(reply) = event_data(&event).and_then(|d| serde_json::from_str::<Value>(&d).ok()) {
                    if reply["id"].as_u64() == Some(id) && reply.get("method").is_none() {
                        return result_of(&reply);
                    }
                }
            }
        }
        bail!("the event stream ended without an answer")
    }

    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        let resp = self
            .post(&json!({"jsonrpc": "2.0", "method": method, "params": params}))
            .send()
            .await
            .context("could not reach the server")?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(Unauthorized { resource_metadata: None }.into());
        }
        Ok(())
    }
}

/// The `resource_metadata="…"` value out of a `WWW-Authenticate` header.
pub fn resource_metadata_of(header: &str) -> Option<String> {
    let at = header.find("resource_metadata=\"")? + "resource_metadata=\"".len();
    let end = header[at..].find('"')?;
    Some(header[at..at + end].to_string())
}

/// Cuts the first complete server-sent event (ended by a blank line) off `buf`.
fn take_event(buf: &mut String) -> Option<String> {
    let normalized = buf.replace("\r\n", "\n");
    let end = normalized.find("\n\n")?;
    let event = normalized[..end].to_string();
    *buf = normalized[end + 2..].to_string();
    Some(event)
}

/// The joined `data:` lines of one event.
fn event_data(event: &str) -> Option<String> {
    let data: Vec<&str> = event
        .lines()
        .filter_map(|l| l.strip_prefix("data:"))
        .map(|d| d.strip_prefix(' ').unwrap_or(d))
        .collect();
    (!data.is_empty()).then(|| data.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_are_cut_whole_and_their_data_joined() {
        let mut buf = "event: message\ndata: {\"a\":1}\n\nda".to_string();
        let first = take_event(&mut buf).unwrap();
        assert_eq!(event_data(&first).as_deref(), Some("{\"a\":1}"));
        assert_eq!(buf, "da");
        assert!(take_event(&mut buf).is_none());
        assert_eq!(event_data("data: a\ndata: b").as_deref(), Some("a\nb"));
        assert_eq!(event_data(": ping"), None);
    }

    #[test]
    fn the_resource_metadata_url_is_read_from_the_challenge() {
        let h = r#"Bearer realm="OAuth", resource_metadata="https://x.dev/.well-known/oauth-protected-resource/mcp", scope="a""#;
        assert_eq!(
            resource_metadata_of(h).as_deref(),
            Some("https://x.dev/.well-known/oauth-protected-resource/mcp")
        );
        assert_eq!(resource_metadata_of("Bearer"), None);
    }

    /// A shell script that speaks just enough MCP over stdio.
    #[tokio::test]
    async fn a_stdio_server_is_handshaken_and_listed() {
        let script = r#"
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) id=$(echo "$line" | sed 's/.*"id":\([0-9]*\).*/\1/'); echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"serverInfo\":{\"name\":\"t\",\"version\":\"1\"}}}";;
    *'"method":"tools/list"'*) id=$(echo "$line" | sed 's/.*"id":\([0-9]*\).*/\1/'); echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"tools\":[{\"name\":\"echo\",\"description\":\"Echo\",\"inputSchema\":{\"type\":\"object\"}}]}}";;
  esac
done"#;
        let spec = Spec::Stdio { command: "sh".into(), args: vec!["-c".into(), script.into()], env: BTreeMap::new() };
        let client = Client::connect(&spec).await.unwrap();
        let tools = client.list_tools().await.unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "echo");
        assert_eq!(tools[0].description.as_deref(), Some("Echo"));
    }

    #[tokio::test]
    async fn a_missing_command_is_named() {
        let spec = Spec::Stdio { command: "hz-no-such-command".into(), args: vec![], env: BTreeMap::new() };
        let err = Client::connect(&spec).await.err().unwrap().to_string();
        assert!(err.contains("hz-no-such-command"), "{err}");
    }

    #[tokio::test]
    async fn a_url_must_be_http() {
        let spec = Spec::Http { url: "ftp://x".into(), headers: BTreeMap::new() };
        assert!(Client::connect(&spec).await.is_err());
    }

    /// Against the reference server from npm; needs Node and a network, so it is
    /// run by hand: `cargo test real_stdio -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn real_stdio_server_everything_lists_its_tools() {
        let spec = Spec::Stdio {
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-everything".into()],
            env: BTreeMap::new(),
        };
        let client = Client::connect(&spec).await.unwrap();
        let tools = client.list_tools().await.unwrap();
        eprintln!("{:?}", tools.iter().map(|t| &t.name).collect::<Vec<_>>());
        assert!(tools.iter().any(|t| t.name == "echo"));
        let out = client.call_tool("echo", json!({"message": "hi"})).await.unwrap();
        assert!(out.to_string().contains("hi"), "{out}");
    }

    /// Google's Gmail MCP lists its tools without a sign-in: a real remote
    /// Streamable HTTP server. Run by hand: `cargo test real_http -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn real_http_gmail_server_lists_its_tools() {
        let spec = Spec::Http { url: "https://gmailmcp.googleapis.com/mcp/v1".into(), headers: BTreeMap::new() };
        let client = Client::connect(&spec).await.unwrap();
        let tools = client.list_tools().await.unwrap();
        eprintln!("{:?}", tools.iter().map(|t| &t.name).collect::<Vec<_>>());
        assert!(tools.iter().any(|t| t.name == "search_threads"));
    }

    /// Linear answers 401 with its metadata location, which is what sends a
    /// reader to the browser. Run by hand.
    #[tokio::test]
    #[ignore]
    async fn real_http_linear_asks_for_sign_in() {
        let spec = Spec::Http { url: "https://mcp.linear.app/mcp".into(), headers: BTreeMap::new() };
        let err = Client::connect(&spec).await.err().unwrap();
        let un = err.downcast_ref::<Unauthorized>().expect("a 401");
        assert!(un.resource_metadata.as_deref().unwrap_or_default().contains("oauth-protected-resource"));
        let http = reqwest::Client::new();
        let server = crate::plugin_oauth::discover(&http, "https://mcp.linear.app/mcp", un.resource_metadata.as_deref()).await.unwrap();
        assert!(server.registration_endpoint.is_some());
    }
}
