//! Composio tool-router sessions from one pasted key: apps connect through a link card the agent shows.
//!
//! Network is behind [`Poller`] and [`Sleeper`], so the wait for a connection is a pure state
//! machine ([`Waiter`]) with a thin async driver. The key is wrapped in [`ApiKey`] so it can never
//! reach a log through `Debug`.

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt;
use std::future::Future;
use std::time::Duration;

pub const API_BASE: &str = "https://backend.composio.dev/api/v3";

/// The pasted key; Debug and Display show nothing of it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ApiKey(String);

impl ApiKey {
    /// Wraps a pasted key, trimming whitespace; an empty key is refused.
    pub fn new(raw: &str) -> Result<ApiKey> {
        let k = raw.trim();
        if k.is_empty() {
            bail!("the Composio key is empty");
        }
        if k.chars().any(char::is_whitespace) {
            bail!("the Composio key has spaces in it");
        }
        Ok(ApiKey(k.to_string()))
    }

    /// The raw key, for the one header that needs it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiKey(<redacted>)")
    }
}

/// URL that creates a tool-router session.
pub fn session_url() -> String {
    format!("{API_BASE}/tool_router/session")
}

/// URL that asks a session for a connect link.
pub fn link_url(session_id: &str) -> String {
    format!("{API_BASE}/tool_router/session/{}/link", enc(session_id))
}

/// URL that lists a session's apps with their connection state.
pub fn toolkits_url(session_id: &str) -> String {
    format!("{API_BASE}/tool_router/session/{}/toolkits", enc(session_id))
}

fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Body that opens a session for one reader.
pub fn session_request_body(user_id: &str) -> Value {
    json!({ "user_id": user_id })
}

/// Body that asks for a link to connect `app`, returning to `callback`.
pub fn link_request_body(app: &str, callback: &str) -> Value {
    json!({ "toolkit": app.trim().to_ascii_lowercase(), "callback_url": callback })
}

/// A live tool-router session and the MCP endpoint that serves its tools.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComposioSession {
    pub id: String,
    pub mcp_url: String,
}

/// Reads the session reply; accepts `session_id` or `id`, and `mcp.url` or `mcp_url`.
pub fn parse_session(json: &str) -> Result<ComposioSession> {
    let v: Value = serde_json::from_str(json).map_err(|e| anyhow!("session reply is not JSON: {e}"))?;
    if let Some(msg) = v.pointer("/error/message").and_then(Value::as_str) {
        bail!("composio refused: {msg}");
    }
    let id = v
        .get("session_id")
        .or_else(|| v.get("id"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("session reply has no id"))?;
    let mcp_url = v
        .pointer("/mcp/url")
        .or_else(|| v.get("mcp_url"))
        .and_then(Value::as_str)
        .filter(|s| s.starts_with("https://") || s.starts_with("http://127.0.0.1") || s.starts_with("http://localhost"))
        .ok_or_else(|| anyhow!("session reply has no usable mcp url"))?;
    Ok(ComposioSession { id: id.to_string(), mcp_url: mcp_url.to_string() })
}

/// A link the reader opens to connect one app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectLink {
    pub app: String,
    pub url: String,
}

/// Reads the link reply (`redirect_url` or `url`); only https links are accepted.
pub fn parse_connect_link(app: &str, json: &str) -> Result<ConnectLink> {
    let v: Value = serde_json::from_str(json).map_err(|e| anyhow!("link reply is not JSON: {e}"))?;
    let u = v
        .get("redirect_url")
        .or_else(|| v.get("url"))
        .or_else(|| v.get("link"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("link reply has no url"))?;
    let parsed = url::Url::parse(u).map_err(|_| anyhow!("link is not a url"))?;
    if parsed.scheme() != "https" {
        bail!("connect links must be https");
    }
    Ok(ConnectLink { app: app.trim().to_ascii_lowercase(), url: u.to_string() })
}

/// The card an agent shows in chat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectCard {
    pub app: String,
    pub title: String,
    pub button: String,
    pub url: String,
}

/// Display name for an app slug.
pub fn app_label(app: &str) -> String {
    match app.trim().to_ascii_lowercase().as_str() {
        "github" => "GitHub".into(),
        "gmail" => "Gmail".into(),
        "googlecalendar" => "Google Calendar".into(),
        "googledrive" => "Google Drive".into(),
        "googlesheets" => "Google Sheets".into(),
        "linkedin" => "LinkedIn".into(),
        "hubspot" => "HubSpot".into(),
        "" => "app".into(),
        other => {
            let mut c = other.chars();
            c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
        }
    }
}

/// Card data for "Connect GitHub" style buttons.
pub fn connect_card(app: &str, url: &str) -> ConnectCard {
    let name = app_label(app);
    ConnectCard {
        app: app.trim().to_ascii_lowercase(),
        title: format!("Connect {name}"),
        button: format!("Connect {name}"),
        url: url.to_string(),
    }
}

/// Where an app's connection stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnStatus {
    Connected,
    Pending,
    Failed,
    NotLinked,
}

/// Finds `app` in a toolkits reply and reads its connection state; unknown words count as pending.
pub fn parse_connection_status(app: &str, json: &str) -> Result<ConnStatus> {
    let v: Value = serde_json::from_str(json)?;
    let items = v
        .get("items")
        .or_else(|| v.get("toolkits"))
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("toolkits reply has no list"))?;
    let want = app.trim().to_ascii_lowercase();
    let Some(item) = items.iter().find(|i| {
        ["slug", "name", "toolkit"]
            .iter()
            .any(|k| i.get(*k).and_then(Value::as_str).is_some_and(|s| s.eq_ignore_ascii_case(&want)))
    }) else {
        return Ok(ConnStatus::NotLinked);
    };
    if item.get("is_connected").and_then(Value::as_bool) == Some(true) {
        return Ok(ConnStatus::Connected);
    }
    let status = item
        .pointer("/connected_account/status")
        .or_else(|| item.get("status"))
        .and_then(Value::as_str)
        .map(str::to_ascii_uppercase);
    Ok(match status.as_deref() {
        Some("ACTIVE" | "CONNECTED") => ConnStatus::Connected,
        Some("FAILED" | "EXPIRED" | "ERROR" | "REVOKED") => ConnStatus::Failed,
        Some(_) => ConnStatus::Pending,
        None if item.get("connected_account").is_some_and(|c| !c.is_null()) => ConnStatus::Pending,
        None => ConnStatus::NotLinked,
    })
}

/// The URL the browser returns to after the reader approves; `app` rides along so the page can say which.
pub fn callback_url(base: &str, app: &str) -> Result<String> {
    let mut u = url::Url::parse(base).map_err(|_| anyhow!("callback base is not a url"))?;
    u.query_pairs_mut().append_pair("app", &app.trim().to_ascii_lowercase()).append_pair("source", "hz");
    Ok(u.into())
}

/// Reads the app back out of a callback url.
pub fn parse_callback(url_text: &str) -> Option<String> {
    let u = url::Url::parse(url_text).ok()?;
    u.query_pairs().find(|(k, _)| k == "app").map(|(_, v)| v.into_owned()).filter(|v| !v.is_empty())
}

/// Poll timing: attempts and a capped exponential delay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Schedule {
    pub max_attempts: u32,
    pub first: Duration,
    pub cap: Duration,
}

impl Default for Schedule {
    fn default() -> Self {
        Schedule { max_attempts: 40, first: Duration::from_secs(2), cap: Duration::from_secs(10) }
    }
}

impl Schedule {
    /// Delay before the poll that follows attempt number `n` (1-based): doubles each time up to the cap.
    pub fn delay_after(&self, n: u32) -> Duration {
        let shift = n.saturating_sub(1).min(16);
        self.first.saturating_mul(1u32 << shift).min(self.cap)
    }
}

/// What to do after a poll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Connected,
    Failed,
    Wait(Duration),
    GiveUp,
}

/// The wait as a pure state machine: feed it each poll result, it says what comes next.
#[derive(Debug)]
pub struct Waiter {
    schedule: Schedule,
    attempts: u32,
}

impl Waiter {
    pub fn new(schedule: Schedule) -> Waiter {
        Waiter { schedule, attempts: 0 }
    }

    /// Records one poll result and returns the next step.
    pub fn next(&mut self, status: ConnStatus) -> Step {
        self.attempts += 1;
        match status {
            ConnStatus::Connected => Step::Connected,
            ConnStatus::Failed => Step::Failed,
            ConnStatus::Pending | ConnStatus::NotLinked => {
                if self.attempts >= self.schedule.max_attempts {
                    Step::GiveUp
                } else {
                    Step::Wait(self.schedule.delay_after(self.attempts))
                }
            }
        }
    }

    pub fn attempts(&self) -> u32 {
        self.attempts
    }
}

/// The network seam: one status check.
pub trait Poller {
    fn poll(&self, app: &str) -> impl Future<Output = Result<ConnStatus>> + Send;
}

/// Real poller: asks Composio for the session's toolkits with the pasted key.
pub struct ReqwestPoller {
    pub client: reqwest::Client,
    pub key: ApiKey,
    pub session_id: String,
}

impl Poller for ReqwestPoller {
    async fn poll(&self, app: &str) -> Result<ConnStatus> {
        let resp: reqwest::Response = self
            .client
            .get(toolkits_url(&self.session_id))
            .header("x-api-key", self.key.expose())
            .send()
            .await?;
        let text: String = resp.text().await?;
        parse_connection_status(app, &text)
    }
}

/// The clock seam, so tests do not sleep.
pub trait Sleeper {
    fn sleep(&self, d: Duration) -> impl Future<Output = ()> + Send;
}

/// Sleeps on the tokio timer.
pub struct TokioSleeper;

impl Sleeper for TokioSleeper {
    async fn sleep(&self, d: Duration) {
        tokio::time::sleep(d).await;
    }
}

/// Polls until the app connects, fails, or the schedule runs out. A poll that errors counts as pending
/// (a flaky network must not end the wait), but the last error is kept for the give-up message.
pub async fn wait_for_connection<P: Poller, S: Sleeper>(
    poller: &P,
    sleeper: &S,
    app: &str,
    schedule: Schedule,
) -> Result<()> {
    let mut w = Waiter::new(schedule);
    let mut last_err: Option<anyhow::Error> = None;
    loop {
        let status = match poller.poll(app).await {
            Ok(s) => s,
            Err(e) => {
                last_err = Some(e);
                ConnStatus::Pending
            }
        };
        match w.next(status) {
            Step::Connected => return Ok(()),
            Step::Failed => bail!("{} refused the connection", app_label(app)),
            Step::Wait(d) => sleeper.sleep(d).await,
            Step::GiveUp => {
                let why = last_err.map(|e| format!(" (last error: {e})")).unwrap_or_default();
                bail!("gave up waiting for {} after {} checks{why}", app_label(app), w.attempts());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn key_is_redacted_everywhere() {
        let k = ApiKey::new("  ck_secret123 \n").unwrap();
        assert_eq!(k.expose(), "ck_secret123");
        assert!(!format!("{k:?}").contains("secret"));
        #[derive(Debug)]
        struct Holder {
            _k: ApiKey,
        }
        assert!(!format!("{:?}", Holder { _k: k }).contains("secret"));
        assert!(ApiKey::new("   ").is_err());
        assert!(ApiKey::new("a b").is_err());
    }

    #[test]
    fn urls_escape_session_id() {
        assert!(session_url().ends_with("/tool_router/session"));
        assert!(link_url("a/b c").ends_with("/session/a%2Fb+c/link"));
        assert!(toolkits_url("s1").ends_with("/session/s1/toolkits"));
    }

    #[test]
    fn request_bodies() {
        assert_eq!(session_request_body("hz-user")["user_id"], "hz-user");
        let b = link_request_body(" GitHub ", "https://x/cb");
        assert_eq!(b["toolkit"], "github");
        assert_eq!(b["callback_url"], "https://x/cb");
    }

    #[test]
    fn session_parses_both_shapes() {
        let a = parse_session(r#"{"session_id":"s1","mcp":{"url":"https://mcp.example/s1"}}"#).unwrap();
        assert_eq!(a, ComposioSession { id: "s1".into(), mcp_url: "https://mcp.example/s1".into() });
        let b = parse_session(r#"{"id":"s2","mcp_url":"https://m/2"}"#).unwrap();
        assert_eq!(b.id, "s2");
    }

    #[test]
    fn session_rejects_bad_replies() {
        assert!(parse_session(r#"{"error":{"message":"bad key"}}"#).unwrap_err().to_string().contains("bad key"));
        assert!(parse_session(r#"{"mcp":{"url":"https://a"}}"#).is_err());
        assert!(parse_session(r#"{"session_id":"s","mcp":{"url":"ftp://a"}}"#).is_err());
        assert!(parse_session(r#"{"session_id":"s","mcp":{"url":"http://evil.example"}}"#).is_err());
        assert!(parse_session("<html>").is_err());
    }

    #[test]
    fn link_parses_and_requires_https() {
        let l = parse_connect_link("GitHub", r#"{"redirect_url":"https://connect.example/x?y=1"}"#).unwrap();
        assert_eq!(l, ConnectLink { app: "github".into(), url: "https://connect.example/x?y=1".into() });
        assert!(parse_connect_link("a", r#"{"url":"http://x"}"#).is_err());
        assert!(parse_connect_link("a", r#"{"url":"javascript:alert(1)"}"#).is_err());
        assert!(parse_connect_link("a", r#"{}"#).is_err());
        assert!(parse_connect_link("a", r#"{"url":"not a url"}"#).is_err());
    }

    #[test]
    fn card_names_apps() {
        let c = connect_card("github", "https://x");
        assert_eq!(c.title, "Connect GitHub");
        assert_eq!(c.button, "Connect GitHub");
        assert_eq!(connect_card("googlecalendar", "u").title, "Connect Google Calendar");
        assert_eq!(connect_card("notion", "u").title, "Connect Notion");
        assert_eq!(app_label(""), "app");
    }

    #[test]
    fn status_reading() {
        let j = r#"{"items":[
            {"slug":"github","connected_account":{"status":"ACTIVE"}},
            {"slug":"slack","connected_account":{"status":"INITIATED"}},
            {"slug":"notion","connected_account":{"status":"EXPIRED"}},
            {"slug":"linear","is_connected":true},
            {"slug":"gmail","connected_account":null}]}"#;
        let s = |a| parse_connection_status(a, j).unwrap();
        assert_eq!(s("github"), ConnStatus::Connected);
        assert_eq!(s("SLACK"), ConnStatus::Pending);
        assert_eq!(s("notion"), ConnStatus::Failed);
        assert_eq!(s("linear"), ConnStatus::Connected);
        assert_eq!(s("gmail"), ConnStatus::NotLinked);
        assert_eq!(s("missing"), ConnStatus::NotLinked);
        assert!(parse_connection_status("a", "{}").is_err());
    }

    #[test]
    fn callback_round_trip() {
        let u = callback_url("https://hz.local/done", "GitHub").unwrap();
        assert!(u.contains("app=github") && u.contains("source=hz"));
        assert_eq!(parse_callback(&u).as_deref(), Some("github"));
        assert_eq!(parse_callback("https://x/?other=1"), None);
        assert_eq!(parse_callback("garbage"), None);
        assert!(callback_url("nope", "a").is_err());
        assert!(callback_url("https://h/p?keep=1", "a").unwrap().contains("keep=1"));
    }

    #[test]
    fn schedule_backs_off_and_caps() {
        let s = Schedule::default();
        let d: Vec<u64> = (1..=6).map(|n| s.delay_after(n).as_secs()).collect();
        assert_eq!(d, vec![2, 4, 8, 10, 10, 10]);
        assert_eq!(s.delay_after(1000).as_secs(), 10);
    }

    #[test]
    fn waiter_state_machine() {
        let mut w = Waiter::new(Schedule { max_attempts: 3, first: Duration::from_secs(1), cap: Duration::from_secs(5) });
        assert_eq!(w.next(ConnStatus::Pending), Step::Wait(Duration::from_secs(1)));
        assert_eq!(w.next(ConnStatus::NotLinked), Step::Wait(Duration::from_secs(2)));
        assert_eq!(w.next(ConnStatus::Pending), Step::GiveUp);
        assert_eq!(w.attempts(), 3);
        assert_eq!(Waiter::new(Schedule::default()).next(ConnStatus::Connected), Step::Connected);
        assert_eq!(Waiter::new(Schedule::default()).next(ConnStatus::Failed), Step::Failed);
    }

    struct Script {
        replies: Mutex<Vec<Result<ConnStatus>>>,
    }
    impl Poller for Script {
        async fn poll(&self, _app: &str) -> Result<ConnStatus> {
            self.replies.lock().unwrap().remove(0)
        }
    }
    struct Rec(Mutex<Vec<Duration>>);
    impl Sleeper for Rec {
        async fn sleep(&self, d: Duration) {
            self.0.lock().unwrap().push(d);
        }
    }
    fn sched(n: u32) -> Schedule {
        Schedule { max_attempts: n, first: Duration::from_secs(1), cap: Duration::from_secs(3) }
    }

    #[tokio::test]
    async fn driver_connects_after_pending_and_errors() {
        let p = Script { replies: Mutex::new(vec![Ok(ConnStatus::Pending), Err(anyhow!("net")), Ok(ConnStatus::Connected)]) };
        let s = Rec(Mutex::new(vec![]));
        wait_for_connection(&p, &s, "github", sched(10)).await.unwrap();
        assert_eq!(*s.0.lock().unwrap(), vec![Duration::from_secs(1), Duration::from_secs(2)]);
    }

    #[tokio::test]
    async fn driver_gives_up_with_last_error() {
        let p = Script { replies: Mutex::new(vec![Err(anyhow!("boom")), Err(anyhow!("boom2"))]) };
        let e = wait_for_connection(&p, &Rec(Mutex::new(vec![])), "slack", sched(2)).await.unwrap_err();
        let m = e.to_string();
        assert!(m.contains("Slack") && m.contains("2 checks") && m.contains("boom2"), "{m}");
    }

    #[tokio::test]
    async fn driver_stops_on_failure() {
        let p = Script { replies: Mutex::new(vec![Ok(ConnStatus::Failed)]) };
        let s = Rec(Mutex::new(vec![]));
        assert!(wait_for_connection(&p, &s, "github", sched(5)).await.is_err());
        assert!(s.0.lock().unwrap().is_empty());
    }
}
