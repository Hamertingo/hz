//! The webhook endpoint: how a service starts a routine.
//!
//! A loopback HTTP listener, on its own port and apart from the team's MCP
//! server, for `POST /hooks/<workspace>/<routine id>`. **It is local on purpose.**
//! A service on the internet cannot reach 127.0.0.1, so the reader points their
//! own tunnel (ngrok, `cloudflared`, Tailscale Funnel) at it; a public relay that
//! does this for them is a later piece. What the tunnel exposes is only this path,
//! and nothing past the signature check starts a run.
//!
//! **The port is stable across launches when it can be**, because the URL is pasted
//! into another service's settings: a port that changed every start would break
//! every webhook after each restart. It falls back to any free port when the
//! preferred one is taken, and the editor shows whichever it got.

use std::{
    collections::HashMap,
    sync::OnceLock,
    time::Duration,
};

use anyhow::{Context, Result};
use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use ts_rs::TS;

use crate::{
    agents,
    automations::{self, Routine, Trigger},
    routines::{self, Fired},
};

const PREFERRED_PORT: u16 = 47831;
/// A payload past this is refused. Real webhooks are a few kilobytes.
const MAX_BODY: usize = 1 << 20;
const MAX_HEAD: usize = 32 << 10;
/// How far a Stripe timestamp may be from now. Stripe's own default.
const STRIPE_TOLERANCE: i64 = 300;
/// A connection that sends nothing for this long is dropped.
const READ_TIMEOUT: Duration = Duration::from_secs(15);

static PORT: OnceLock<u16> = OnceLock::new();

/// Where the listener is, for the editor to print.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct HookInfo {
    /// `None` until the listener is up.
    pub port: Option<u16>,
    /// `http://127.0.0.1:<port>`, or empty before the listener is up.
    pub base: String,
}

pub fn info() -> HookInfo {
    let port = PORT.get().copied();
    HookInfo { port, base: port.map(|p| format!("http://127.0.0.1:{p}")).unwrap_or_default() }
}

/// Binds and serves for the life of the process.
pub async fn serve(app: AppHandle) -> Result<()> {
    let listener = match TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).await {
        Ok(l) => l,
        Err(_) => TcpListener::bind("127.0.0.1:0").await.context("could not bind the webhook listener")?,
    };
    let _ = PORT.set(listener.local_addr()?.port());

    loop {
        let (stream, _) = listener.accept().await?;
        let app = app.clone();
        tokio::spawn(async move {
            if let Err(e) = connection(stream, app).await {
                eprintln!("[hooks err] {e:#}");
            }
        });
    }
}

// --- Signatures ---------------------------------------------------------------

/// HMAC-SHA256 (RFC 2104), written out because `sha2` is already a dependency and
/// a second crate for fifteen lines is the wrong trade.
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut k = [0u8; BLOCK];
    if key.len() > BLOCK {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(k.map(|b| b ^ 0x36));
    inner.update(message);
    let mut outer = Sha256::new();
    outer.update(k.map(|b| b ^ 0x5c));
    outer.update(inner.finalize());
    outer.finalize().into()
}

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Equality that takes the same time wherever two strings differ, so a signature
/// cannot be guessed a byte at a time from how fast the refusal comes back.
fn same(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn signed_hex(secret: &str, body: &[u8]) -> String {
    to_hex(&hmac_sha256(secret.as_bytes(), body))
}

/// Whether the request carries a valid signature for this source's scheme.
/// `header` reads a lower-cased header name. The error is the reason, for the log;
/// the response says only that the signature is wrong.
pub fn verify(
    source: &str,
    secret: &str,
    header: &dyn Fn(&str) -> Option<String>,
    body: &[u8],
    now_unix: i64,
) -> Result<(), &'static str> {
    let ok = match source {
        "GitHub" => {
            let sent = header("x-hub-signature-256").ok_or("no X-Hub-Signature-256")?;
            same(sent.trim_start_matches("sha256="), &signed_hex(secret, body))
        }
        "Stripe" => {
            let sent = header("stripe-signature").ok_or("no Stripe-Signature")?;
            let mut stamp = None;
            let mut sigs = Vec::new();
            for part in sent.split(',') {
                match part.trim().split_once('=') {
                    Some(("t", v)) => stamp = v.parse::<i64>().ok(),
                    Some(("v1", v)) => sigs.push(v.to_string()),
                    _ => {}
                }
            }
            let stamp = stamp.ok_or("no timestamp in Stripe-Signature")?;
            if (now_unix - stamp).abs() > STRIPE_TOLERANCE {
                return Err("timestamp too old");
            }
            let mut signed = format!("{stamp}.").into_bytes();
            signed.extend_from_slice(body);
            let want = signed_hex(secret, &signed);
            sigs.iter().any(|s| same(s, &want))
        }
        "Linear" => same(&header("linear-signature").ok_or("no Linear-Signature")?, &signed_hex(secret, body)),
        "Sentry" => same(&header("sentry-hook-signature").ok_or("no Sentry-Hook-Signature")?, &signed_hex(secret, body)),
        _ => {
            let sent = header("x-hz-signature")
                .or_else(|| header("x-hub-signature-256"))
                .ok_or("no X-Hz-Signature")?;
            same(sent.trim_start_matches("sha256="), &signed_hex(secret, body))
        }
    };
    if ok { Ok(()) } else { Err("signature does not match") }
}

// --- Payloads -----------------------------------------------------------------

fn text<'a>(v: &'a Value, pointer: &str) -> Option<&'a str> {
    v.pointer(pointer).and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// The event name the source gave this call, spelled the way the editor offers it.
pub fn event_of(source: &str, header: &dyn Fn(&str) -> Option<String>, payload: &Value) -> String {
    let action = text(payload, "/action");
    match source {
        "GitHub" => {
            let kind = header("x-github-event").unwrap_or_default();
            match action {
                Some(a) => format!("{kind}.{a}"),
                None => kind,
            }
        }
        "Stripe" => text(payload, "/type").unwrap_or_default().to_string(),
        "Linear" => {
            let kind = text(payload, "/type").unwrap_or_default().to_lowercase();
            let action = match text(payload, "/action") {
                Some("create") => "created",
                Some("update") => "updated",
                Some("remove") => "removed",
                Some(other) => other,
                None => "",
            };
            format!("{kind}.{action}")
        }
        "Sentry" => {
            let resource = header("sentry-hook-resource").unwrap_or_default();
            let resource = if resource.ends_with("alert") { "alert".to_string() } else { resource };
            format!("{resource}.{}", action.unwrap_or_default())
        }
        _ => "custom".into(),
    }
}

/// A few lines the agent can act on, then the payload itself, cut to size.
pub fn summarize(source: &str, payload: &Value) -> String {
    const WANT: &[(&str, &str)] = &[
        ("repository", "/repository/full_name"),
        ("pull request", "/pull_request/title"),
        ("issue", "/issue/title"),
        ("by", "/sender/login"),
        ("link", "/pull_request/html_url"),
        ("link", "/issue/html_url"),
        ("release", "/release/tag_name"),
        ("ref", "/ref"),
        ("object", "/data/object/id"),
        ("reason", "/data/object/reason"),
        ("status", "/data/object/status"),
        ("customer", "/data/object/customer"),
        ("title", "/data/title"),
        ("identifier", "/data/identifier"),
        ("link", "/url"),
        ("project", "/data/issue/project/slug"),
        ("issue", "/data/issue/title"),
        ("link", "/data/issue/web_url"),
    ];
    let mut lines: Vec<String> = Vec::new();
    for (label, pointer) in WANT {
        let value = payload.pointer(pointer).and_then(|v| match v {
            Value::String(s) if !s.is_empty() => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        });
        if let Some(v) = value {
            let line = format!("{label}: {v}");
            if !lines.contains(&line) {
                lines.push(line);
            }
        }
    }
    if let Some(amount) = payload.pointer("/data/object/amount").and_then(Value::as_i64) {
        let currency = text(payload, "/data/object/currency").unwrap_or("").to_uppercase();
        lines.push(format!("amount: {:.2} {currency}", amount as f64 / 100.0));
    }
    if lines.is_empty() {
        lines.push(format!("{source} sent no fields this app knows how to summarise."));
    }

    let raw = payload.to_string();
    let raw: String = raw.chars().take(1500).collect();
    format!("{}\n\nPayload (cut to 1500 characters):\n{raw}", lines.join("\n"))
}

// --- HTTP ---------------------------------------------------------------------

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

/// Reads one request, headers lower-cased. `None` when the peer closes first.
async fn read_request(stream: &mut TcpStream) -> Result<Option<Request>> {
    let mut buf = Vec::new();
    let head_end = loop {
        if let Some(at) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break at + 4;
        }
        if buf.len() > MAX_HEAD {
            anyhow::bail!("request head too large");
        }
        let mut chunk = [0u8; 4096];
        let n = tokio::time::timeout(READ_TIMEOUT, stream.read(&mut chunk)).await??;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.lines();
    let mut first = lines.next().unwrap_or_default().split_whitespace();
    let method = first.next().unwrap_or_default().to_string();
    let path = first.next().unwrap_or_default().to_string();
    let headers: HashMap<String, String> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))
        .collect();

    let length = headers.get("content-length").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
    if length > MAX_BODY {
        anyhow::bail!("body too large");
    }
    let mut body = buf[head_end..].to_vec();
    while body.len() < length {
        let mut chunk = [0u8; 4096];
        let n = tokio::time::timeout(READ_TIMEOUT, stream.read(&mut chunk)).await??;
        if n == 0 {
            anyhow::bail!("connection closed mid-body");
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    Ok(Some(Request { method, path, headers, body }))
}

async fn respond(stream: &mut TcpStream, status: &str, body: &Value) -> Result<()> {
    let payload = body.to_string();
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(payload.as_bytes()).await?;
    Ok(())
}

async fn connection(mut stream: TcpStream, app: AppHandle) -> Result<()> {
    let Some(request) = read_request(&mut stream).await? else { return Ok(()) };
    let (status, body) = if request.method != "POST" {
        ("405 Method Not Allowed", json!({"error": "POST only"}))
    } else {
        handle(&request, |id, via, extra| routines::fire(app.clone(), id, via, extra)).await
    };
    respond(&mut stream, status, &body).await
}

/// `/hooks/<workspace>/<id>` to its two parts.
fn parse_path(path: &str) -> Option<(&str, &str)> {
    let parts: Vec<&str> = path.split('?').next().unwrap_or("").trim_matches('/').split('/').collect();
    match parts[..] {
        ["hooks", workspace, id] => Some((workspace, id)),
        _ => None,
    }
}

/// Looks the routine up and decides. The lookup is the only part that touches the
/// reader's files; [`decide`] holds every rule.
async fn handle(
    request: &Request,
    start: impl FnOnce(String, String, Option<String>) -> Fired,
) -> (&'static str, Value) {
    let Some((workspace, id)) = parse_path(&request.path) else {
        return not_found();
    };
    let routine = automations::get(id).await.ok().flatten();
    let home = routine
        .as_ref()
        .and_then(|r| agents::by_id(&r.agent_id))
        .and_then(|a| a.workspace_id)
        .unwrap_or_else(|| "_".into());
    decide(request, workspace, routine, &home, Utc::now().timestamp(), start)
}

fn not_found() -> (&'static str, Value) {
    ("404 Not Found", json!({"error": "no such hook"}))
}

/// Maps one request to a status and a body, starting a run through `start` when
/// it should.
///
/// Every refusal before the signature is the same 404, so the endpoint does not
/// confirm which ids exist to anyone who cannot sign.
fn decide(
    request: &Request,
    workspace: &str,
    routine: Option<Routine>,
    home: &str,
    now: i64,
    start: impl FnOnce(String, String, Option<String>) -> Fired,
) -> (&'static str, Value) {
    let Some(routine) = routine.filter(|r| r.deleted_at.is_none()) else { return not_found() };
    let Trigger::Webhook { source, event } = &routine.trigger else { return not_found() };
    if home != workspace {
        return not_found();
    }
    let Some(secret) = routine.secret.as_deref() else { return not_found() };

    let header = |name: &str| request.headers.get(name).cloned();
    if let Err(reason) = verify(source, secret, &header, &request.body, now) {
        eprintln!("[hooks] {}: refused ({reason})", routine.id);
        return ("401 Unauthorized", json!({"error": "bad signature"}));
    }
    if !routine.on {
        return ("200 OK", json!({"status": "ignored", "reason": "paused"}));
    }

    let payload: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
    let got = event_of(source, &header, &payload);
    if source != "Custom" && !got.eq_ignore_ascii_case(event) {
        return ("200 OK", json!({"status": "ignored", "reason": "event", "event": got}));
    }

    let via = format!("webhook: {}", if got.is_empty() { event.as_str() } else { got.as_str() });
    match start(routine.id.clone(), via, Some(summarize(source, &payload))) {
        Fired::Started => ("202 Accepted", json!({"status": "started"})),
        Fired::Queued => ("202 Accepted", json!({"status": "queued"})),
        Fired::Full => ("429 Too Many Requests", json!({"error": "too many events waiting"})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> =
            pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |name| map.get(name).cloned()
    }

    #[test]
    fn hmac_matches_the_rfc_4231_vectors() {
        // Test case 1.
        let mac = hmac_sha256(&[0x0b; 20], b"Hi There");
        assert_eq!(to_hex(&mac), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
        // Test case 2.
        let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(to_hex(&mac), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
        // Test case 6: a key longer than the block is hashed first.
        let mac = hmac_sha256(
            &[0xaa; 131],
            b"Test Using Larger Than Block-Size Key - Hash Key First",
        );
        assert_eq!(to_hex(&mac), "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
    }

    #[test]
    fn github_signatures_are_checked_against_the_body() {
        let body = br#"{"action":"opened"}"#;
        let good = format!("sha256={}", signed_hex("s3cret", body));
        let h = headers(&[("x-hub-signature-256", &good)]);
        assert!(verify("GitHub", "s3cret", &h, body, 0).is_ok());
        assert!(verify("GitHub", "other", &h, body, 0).is_err(), "wrong secret");
        assert!(verify("GitHub", "s3cret", &h, b"{}", 0).is_err(), "body changed");
        assert!(verify("GitHub", "s3cret", &headers(&[]), body, 0).is_err(), "unsigned");
    }

    #[test]
    fn stripe_signs_the_timestamp_with_the_body_and_expires() {
        let body = br#"{"type":"charge.dispute.created"}"#;
        let t = 1_700_000_000;
        let mut signed = format!("{t}.").into_bytes();
        signed.extend_from_slice(body);
        let v1 = signed_hex("whsec_x", &signed);
        let sig = format!("t={t},v1=deadbeef,v1={v1}");
        let h = headers(&[("stripe-signature", &sig)]);
        assert!(verify("Stripe", "whsec_x", &h, body, t + 10).is_ok(), "any v1 may match");
        assert!(verify("Stripe", "whsec_x", &h, body, t + 4000).is_err(), "replayed");
        assert!(verify("Stripe", "nope", &h, body, t).is_err());
    }

    #[test]
    fn linear_sentry_and_custom_use_their_own_headers() {
        let body = b"{}";
        let hex = signed_hex("k", body);
        assert!(verify("Linear", "k", &headers(&[("linear-signature", &hex)]), body, 0).is_ok());
        assert!(verify("Sentry", "k", &headers(&[("sentry-hook-signature", &hex)]), body, 0).is_ok());
        assert!(verify("Custom", "k", &headers(&[("x-hz-signature", &hex)]), body, 0).is_ok());
        assert!(verify("Custom", "k", &headers(&[("x-hz-signature", &format!("sha256={hex}"))]), body, 0).is_ok());
        assert!(verify("Linear", "k", &headers(&[("sentry-hook-signature", &hex)]), body, 0).is_err());
    }

    #[test]
    fn the_comparison_rejects_a_different_length_without_panicking() {
        assert!(!same("abc", "abcd"));
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
    }

    #[test]
    fn events_are_spelled_the_way_the_editor_offers_them() {
        let pr = json!({"action": "opened"});
        let gh = headers(&[("x-github-event", "pull_request")]);
        assert_eq!(event_of("GitHub", &gh, &pr), "pull_request.opened");
        let push = headers(&[("x-github-event", "push")]);
        assert_eq!(event_of("GitHub", &push, &json!({})), "push");
        assert_eq!(
            event_of("Stripe", &headers(&[]), &json!({"type": "invoice.payment_failed"})),
            "invoice.payment_failed"
        );
        assert_eq!(
            event_of("Linear", &headers(&[]), &json!({"type": "Issue", "action": "create"})),
            "issue.created"
        );
        let sentry = headers(&[("sentry-hook-resource", "event_alert")]);
        assert_eq!(event_of("Sentry", &sentry, &json!({"action": "triggered"})), "alert.triggered");
        let issue = headers(&[("sentry-hook-resource", "issue")]);
        assert_eq!(event_of("Sentry", &issue, &json!({"action": "created"})), "issue.created");
    }

    #[test]
    fn a_summary_names_what_to_act_on_and_is_bounded() {
        let pr = json!({
            "action": "opened",
            "repository": {"full_name": "hyze/app"},
            "pull_request": {"title": "Fix billing", "html_url": "https://github.com/hyze/app/pull/4"},
            "sender": {"login": "ada"},
        });
        let s = summarize("GitHub", &pr);
        assert!(s.contains("repository: hyze/app") && s.contains("pull request: Fix billing"));
        assert!(s.contains("link: https://github.com/hyze/app/pull/4") && s.contains("by: ada"));

        let dispute = json!({"data": {"object": {"id": "dp_1", "amount": 4900, "currency": "usd"}}});
        assert!(summarize("Stripe", &dispute).contains("amount: 49.00 USD"));

        let huge = json!({"blob": "x".repeat(10_000)});
        assert!(summarize("Custom", &huge).len() < 1800);
        assert!(summarize("Custom", &json!({})).contains("no fields"));
    }

    fn request(headers: &[(&str, &str)], body: &[u8]) -> Request {
        Request {
            method: "POST".into(),
            path: "/hooks/w1/r1".into(),
            headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            body: body.to_vec(),
        }
    }

    fn routine(source: &str, event: &str) -> Routine {
        serde_json::from_value(json!({
            "id": "r1", "name": "Review", "agentId": "a", "prompt": "review",
            "trigger": {"kind": "webhook", "source": source, "event": event},
            "secret": "k",
        }))
        .unwrap()
    }

    fn signed_pr(body: &[u8]) -> Request {
        let sig = format!("sha256={}", signed_hex("k", body));
        request(&[("x-hub-signature-256", &sig), ("x-github-event", "pull_request")], body)
    }

    #[test]
    fn paths_split_into_workspace_and_id() {
        assert_eq!(parse_path("/hooks/w1/r1"), Some(("w1", "r1")));
        assert_eq!(parse_path("/hooks/w1/r1/?x=1"), Some(("w1", "r1")));
        assert_eq!(parse_path("/mcp/agent"), None);
        assert_eq!(parse_path("/hooks/only"), None);
    }

    #[test]
    fn a_signed_matching_call_starts_the_routine_with_the_payload_summary() {
        let body = br#"{"action":"opened","repository":{"full_name":"hyze/app"}}"#;
        let mut started = None;
        let (status, reply) = decide(&signed_pr(body), "w1", Some(routine("GitHub", "pull_request.opened")), "w1", 0, |id, via, extra| {
            started = Some((id, via, extra));
            Fired::Started
        });
        assert!(status.starts_with("202"), "{reply}");
        let (id, via, extra) = started.unwrap();
        assert_eq!(id, "r1");
        assert_eq!(via, "webhook: pull_request.opened");
        assert!(extra.unwrap().contains("repository: hyze/app"));
    }

    #[test]
    fn a_bad_or_missing_signature_never_starts_anything() {
        let body = br#"{"action":"opened"}"#;
        let r = request(&[("x-hub-signature-256", "sha256=00"), ("x-github-event", "pull_request")], body);
        let (status, _) = decide(&r, "w1", Some(routine("GitHub", "pull_request.opened")), "w1", 0, |_, _, _| panic!("ran"));
        assert!(status.starts_with("401"));
        let (status, _) = decide(&request(&[], body), "w1", Some(routine("GitHub", "pull_request.opened")), "w1", 0, |_, _, _| panic!("ran"));
        assert!(status.starts_with("401"));
    }

    #[test]
    fn another_event_a_paused_routine_and_a_wrong_address_are_not_runs() {
        let body = br#"{"action":"closed"}"#;
        let (status, reply) = decide(&signed_pr(body), "w1", Some(routine("GitHub", "pull_request.opened")), "w1", 0, |_, _, _| panic!("ran"));
        assert!(status.starts_with("200") && reply["reason"] == "event");

        let mut paused = routine("GitHub", "pull_request.closed");
        paused.on = false;
        let (status, reply) = decide(&signed_pr(body), "w1", Some(paused), "w1", 0, |_, _, _| panic!("ran"));
        assert!(status.starts_with("200") && reply["reason"] == "paused");

        let (status, _) = decide(&signed_pr(body), "other", Some(routine("GitHub", "pull_request.closed")), "w1", 0, |_, _, _| panic!("ran"));
        assert!(status.starts_with("404"), "the workspace in the path must be the agent's");
        let (status, _) = decide(&signed_pr(body), "w1", None, "_", 0, |_, _, _| panic!("ran"));
        assert!(status.starts_with("404"));
    }

    #[test]
    fn a_custom_hook_runs_on_any_signed_call_and_a_full_queue_says_so() {
        let body = br#"{"anything":true}"#;
        let sig = signed_hex("k", body);
        let r = request(&[("x-hz-signature", &sig)], body);
        let (status, _) = decide(&r, "w1", Some(routine("Custom", "POST /hooks/your-name")), "w1", 0, |_, _, _| Fired::Queued);
        assert!(status.starts_with("202"));
        let (status, _) = decide(&r, "w1", Some(routine("Custom", "x")), "w1", 0, |_, _, _| Fired::Full);
        assert!(status.starts_with("429"));
    }
}
