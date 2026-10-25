//! Signing in to a remote MCP server: the authorization flow MCP specifies.
//!
//! The server names its authorization server in its protected-resource metadata;
//! that server publishes its endpoints; a client with no ID of its own registers
//! one (RFC 7591); and the person approves access in their browser, which hands a
//! code back to a loopback port this app listens on. PKCE (S256) protects the
//! code, and the token is asked for the server's own URL (RFC 8707) so it is good
//! for that server alone.
//!
//! The result is a [`Tokens`] value. This module never stores it: the caller puts
//! it in the Keychain.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// How long the browser has to come back. A person reading a consent screen takes
/// minutes, not seconds.
const SIGN_IN_LIMIT: Duration = Duration::from_secs(5 * 60);

/// What a sign-in leaves behind. Everything needed to use the token and to renew
/// it later without asking the person again.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Tokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// Epoch milliseconds, when the server said how long the token lives.
    #[serde(default)]
    pub expires_at: Option<u64>,
    pub token_endpoint: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    /// The server URL the token was issued for.
    pub resource: String,
    /// Who the token is for, when the server's ID token says.
    #[serde(default)]
    pub account: Option<String>,
}

/// A client ID the person brought, for servers that register no one.
#[derive(Clone, Debug, Default)]
pub struct OwnClient {
    pub client_id: String,
    pub client_secret: Option<String>,
}

/// An authorization server's endpoints.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthServer {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
    pub scopes: Vec<String>,
    pub auth_methods: Vec<String>,
}

static CANCELS: LazyLock<Mutex<HashMap<String, oneshot::Sender<()>>>> = LazyLock::new(Default::default);

/// Abandons the sign-in waiting under `key`, if there is one.
pub fn cancel(key: &str) {
    if let Some(tx) = CANCELS.lock().expect("cancels poisoned").remove(key) {
        let _ = tx.send(());
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// The PKCE challenge for a verifier.
pub fn challenge_of(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

fn random_token() -> String {
    let mut bytes = Vec::with_capacity(32);
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    b64url(&bytes)
}

/// The URLs to try, in order, for an issuer's metadata (RFC 8414, then OpenID).
pub fn metadata_urls(issuer: &str) -> Vec<String> {
    let issuer = issuer.trim_end_matches('/');
    let Some(rest) = issuer.split_once("://") else { return Vec::new() };
    let (scheme, tail) = rest;
    let (host, path) = tail.split_once('/').map_or((tail, ""), |(h, p)| (h, p));
    let origin = format!("{scheme}://{host}");
    if path.is_empty() {
        vec![
            format!("{origin}/.well-known/oauth-authorization-server"),
            format!("{origin}/.well-known/openid-configuration"),
        ]
    } else {
        vec![
            format!("{origin}/.well-known/oauth-authorization-server/{path}"),
            format!("{origin}/.well-known/openid-configuration/{path}"),
            format!("{issuer}/.well-known/openid-configuration"),
        ]
    }
}

fn origin_of(url: &str) -> Result<String> {
    let u = reqwest::Url::parse(url).with_context(|| format!("`{url}` is not a URL"))?;
    let host = u.host_str().context("a server URL needs a host")?;
    Ok(match u.port() {
        Some(p) => format!("{}://{host}:{p}", u.scheme()),
        None => format!("{}://{host}", u.scheme()),
    })
}

async fn get_json(http: &reqwest::Client, url: &str) -> Option<Value> {
    let resp = http.get(url).header("Accept", "application/json").send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json().await.ok()
}

/// Finds the authorization server behind an MCP server and reads its endpoints.
///
/// `hint` is the metadata URL from a 401's `WWW-Authenticate`, which is the
/// authoritative one when the server sends it.
pub async fn discover(http: &reqwest::Client, resource: &str, hint: Option<&str>) -> Result<AuthServer> {
    let origin = origin_of(resource)?;
    let path = reqwest::Url::parse(resource)?.path().trim_end_matches('/').to_string();

    let mut candidates: Vec<String> = hint.map(str::to_string).into_iter().collect();
    if !path.is_empty() && path != "/" {
        candidates.push(format!("{origin}/.well-known/oauth-protected-resource{path}"));
    }
    candidates.push(format!("{origin}/.well-known/oauth-protected-resource"));

    let mut issuer = origin.clone();
    let mut scopes = Vec::new();
    for url in candidates {
        if let Some(meta) = get_json(http, &url).await {
            if let Some(first) = meta["authorization_servers"].get(0).and_then(Value::as_str) {
                issuer = first.to_string();
            }
            scopes = meta["scopes_supported"]
                .as_array()
                .map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            break;
        }
    }

    for url in metadata_urls(&issuer) {
        if let Some(meta) = get_json(http, &url).await {
            let (Some(authorize), Some(token)) =
                (meta["authorization_endpoint"].as_str(), meta["token_endpoint"].as_str())
            else {
                continue;
            };
            return Ok(AuthServer {
                authorization_endpoint: authorize.to_string(),
                token_endpoint: token.to_string(),
                registration_endpoint: meta["registration_endpoint"].as_str().map(str::to_string),
                scopes,
                auth_methods: meta["token_endpoint_auth_methods_supported"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect())
                    .unwrap_or_default(),
            });
        }
    }
    bail!("could not find how to sign in to {origin}: it published no OAuth metadata")
}

/// Registers this app as a client (RFC 7591) and returns its ID and secret.
async fn register(http: &reqwest::Client, server: &AuthServer, redirect: &str) -> Result<OwnClient> {
    let endpoint = server.registration_endpoint.as_deref().context(
        "this server does not register clients on its own; use a client ID of your own for it",
    )?;
    let public = server.auth_methods.is_empty() || server.auth_methods.iter().any(|m| m == "none");
    let resp = http
        .post(endpoint)
        .json(&json!({
            "client_name": "hz",
            "redirect_uris": [redirect],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": if public { "none" } else { "client_secret_post" },
        }))
        .send()
        .await
        .context("could not reach the registration endpoint")?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        bail!(
            "the server refused to register hz ({status}): {}",
            body["error_description"].as_str().or(body["error"].as_str()).unwrap_or("no reason given")
        );
    }
    Ok(OwnClient {
        client_id: body["client_id"].as_str().context("registration returned no client_id")?.to_string(),
        client_secret: body["client_secret"].as_str().map(str::to_string),
    })
}

/// The URL the person's browser is sent to.
pub fn authorize_url(
    server: &AuthServer,
    client_id: &str,
    redirect: &str,
    state: &str,
    challenge: &str,
    scopes: &[String],
    resource: &str,
) -> Result<String> {
    let mut url = reqwest::Url::parse(&server.authorization_endpoint)?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code")
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect)
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("resource", resource);
        if !scopes.is_empty() {
            q.append_pair("scope", &scopes.join(" "));
        }
    }
    Ok(url.into())
}

/// What the loopback listener took from the browser's redirect.
fn callback_of(request_line: &str) -> Result<(String, String)> {
    let target = request_line.split_whitespace().nth(1).context("an empty request")?;
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}"))?;
    if url.path() != "/callback" {
        bail!("not the callback");
    }
    let get = |k: &str| url.query_pairs().find(|(key, _)| key == k).map(|(_, v)| v.into_owned());
    if let Some(error) = get("error") {
        bail!("{}", get("error_description").unwrap_or(error));
    }
    Ok((get("code").context("the redirect carried no code")?, get("state").unwrap_or_default()))
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>hz</title><body style=\"font:15px -apple-system,sans-serif;background:#161617;color:#ddd;display:grid;place-items:center;height:100vh;margin:0\"><div>You are signed in. You can close this tab and go back to hz.</div>";

async fn wait_for_code(listener: TcpListener, state: &str, mut cancel: oneshot::Receiver<()>) -> Result<String> {
    let accept = async {
        loop {
            let (mut sock, _) = listener.accept().await?;
            let mut buf = vec![0u8; 8192];
            let n = tokio::time::timeout(Duration::from_secs(5), sock.read(&mut buf)).await.unwrap_or(Ok(0))?;
            let head = String::from_utf8_lossy(&buf[..n]).to_string();
            let line = head.lines().next().unwrap_or_default().to_string();
            match callback_of(&line) {
                Ok((code, got)) => {
                    let page = if got == state { DONE_PAGE } else { "State did not match." };
                    let reply = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                        page.len()
                    );
                    let _ = sock.write_all(reply.as_bytes()).await;
                    if got != state {
                        bail!("the sign-in answered a different request; try again");
                    }
                    return Ok::<String, anyhow::Error>(code);
                }
                Err(e) if e.to_string() == "not the callback" => {
                    // A favicon or a stray probe: answer it and keep waiting.
                    let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
                }
                Err(e) => {
                    let _ = sock.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n").await;
                    return Err(e);
                }
            }
        }
    };
    tokio::select! {
        r = accept => r,
        _ = &mut cancel => bail!("sign-in cancelled"),
        _ = tokio::time::sleep(SIGN_IN_LIMIT) => bail!("the sign-in was not finished in time"),
    }
}

/// Runs the whole browser flow and returns the tokens.
///
/// `open` sends the person's browser to the URL; it is a parameter so a test can
/// play the browser. `key` names this sign-in for [`cancel`].
pub async fn sign_in(
    http: &reqwest::Client,
    key: &str,
    resource: &str,
    hint: Option<&str>,
    own: Option<OwnClient>,
    scopes: &[String],
    open: &(dyn Fn(&str) -> Result<()> + Send + Sync),
) -> Result<Tokens> {
    let server = discover(http, resource, hint).await?;

    let listener = TcpListener::bind("127.0.0.1:0").await.context("could not listen for the browser")?;
    let redirect = format!("http://127.0.0.1:{}/callback", listener.local_addr()?.port());

    let client = match own.filter(|c| !c.client_id.trim().is_empty()) {
        Some(c) => c,
        None => register(http, &server, &redirect).await?,
    };

    let verifier = random_token();
    let state = random_token();
    // What was asked for if the caller named nothing: what the server offers, so
    // a consent screen is never empty-handed.
    let wanted: Vec<String> = if scopes.is_empty() { server.scopes.clone() } else { scopes.to_vec() };
    let url = authorize_url(&server, &client.client_id, &redirect, &state, &challenge_of(&verifier), &wanted, resource)?;

    let (tx, rx) = oneshot::channel();
    CANCELS.lock().expect("cancels poisoned").insert(key.to_string(), tx);
    let waited = async {
        open(&url).context("could not open your browser")?;
        wait_for_code(listener, &state, rx).await
    }
    .await;
    CANCELS.lock().expect("cancels poisoned").remove(key);
    let code = waited?;

    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("redirect_uri", redirect),
        ("client_id", client.client_id.clone()),
        ("code_verifier", verifier),
        ("resource", resource.to_string()),
    ];
    if let Some(secret) = &client.client_secret {
        form.push(("client_secret", secret.clone()));
    }
    let tokens = token_request(http, &server.token_endpoint, &form).await?;
    Ok(Tokens {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        token_endpoint: server.token_endpoint,
        client_id: client.client_id,
        client_secret: client.client_secret,
        resource: resource.to_string(),
        account: tokens.account,
    })
}

struct Granted {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
    account: Option<String>,
}

async fn token_request(http: &reqwest::Client, endpoint: &str, form: &[(&str, String)]) -> Result<Granted> {
    let resp = http
        .post(endpoint)
        .header("Accept", "application/json")
        .form(form)
        .send()
        .await
        .context("could not reach the token endpoint")?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() || body.get("error").is_some() {
        bail!(
            "the server refused the sign-in ({status}): {}",
            body["error_description"].as_str().or(body["error"].as_str()).unwrap_or("no reason given")
        );
    }
    Ok(Granted {
        access_token: body["access_token"].as_str().context("the server returned no access token")?.to_string(),
        refresh_token: body["refresh_token"].as_str().map(str::to_string),
        expires_at: body["expires_in"].as_u64().map(|s| now_ms() + s * 1000),
        account: body["id_token"].as_str().and_then(account_of_id_token),
    })
}

/// The email (or name) an ID token states. The token is not verified: it only
/// labels the connection on screen and grants nothing.
pub fn account_of_id_token(jwt: &str) -> Option<String> {
    let payload = jwt.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    ["email", "preferred_username", "name"]
        .iter()
        .find_map(|k| claims[*k].as_str().map(str::to_string))
}

/// Whether the access token is gone or about to be.
pub fn needs_refresh(tokens: &Tokens) -> bool {
    tokens.expires_at.is_some_and(|at| at <= now_ms() + 60_000)
}

/// Renews a token with its refresh token.
pub async fn refresh(http: &reqwest::Client, tokens: &Tokens) -> Result<Tokens> {
    let refresh = tokens.refresh_token.clone().ok_or_else(|| anyhow!("the sign-in has expired; reconnect it"))?;
    let mut form = vec![
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh.clone()),
        ("client_id", tokens.client_id.clone()),
        ("resource", tokens.resource.clone()),
    ];
    if let Some(secret) = &tokens.client_secret {
        form.push(("client_secret", secret.clone()));
    }
    let granted = token_request(http, &tokens.token_endpoint, &form).await?;
    Ok(Tokens {
        access_token: granted.access_token,
        // A server may rotate the refresh token or leave it; keep what works.
        refresh_token: granted.refresh_token.or(Some(refresh)),
        expires_at: granted.expires_at,
        account: granted.account.or_else(|| tokens.account.clone()),
        ..tokens.clone()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issuers_with_a_path_put_it_after_the_well_known_segment() {
        assert_eq!(
            metadata_urls("https://access.stripe.com/mcp")[0],
            "https://access.stripe.com/.well-known/oauth-authorization-server/mcp"
        );
        assert_eq!(
            metadata_urls("https://mcp.linear.app/"),
            vec![
                "https://mcp.linear.app/.well-known/oauth-authorization-server",
                "https://mcp.linear.app/.well-known/openid-configuration",
            ]
        );
    }

    #[test]
    fn the_challenge_is_the_rfc_example() {
        // RFC 7636 appendix B.
        assert_eq!(
            challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn a_redirect_yields_its_code_and_an_error_yields_its_words() {
        let (code, state) = callback_of("GET /callback?code=abc&state=xyz HTTP/1.1").unwrap();
        assert_eq!((code.as_str(), state.as_str()), ("abc", "xyz"));
        let err = callback_of("GET /callback?error=access_denied&error_description=No%20thanks HTTP/1.1").unwrap_err();
        assert_eq!(err.to_string(), "No thanks");
        assert_eq!(callback_of("GET /favicon.ico HTTP/1.1").unwrap_err().to_string(), "not the callback");
    }

    #[test]
    fn the_id_token_labels_the_account() {
        let claims = b64url(br#"{"email":"ada@example.com"}"#);
        assert_eq!(account_of_id_token(&format!("h.{claims}.s")).as_deref(), Some("ada@example.com"));
        assert_eq!(account_of_id_token("nope"), None);
    }

    /// A one-file authorization server: metadata, registration and a token
    /// endpoint that checks the PKCE verifier against the challenge it saw.
    async fn mock_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let b = base.clone();
        let handle = tokio::spawn(async move {
            let challenge = std::sync::Arc::new(Mutex::new(String::new()));
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let (b, challenge) = (b.clone(), challenge.clone());
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 16384];
                    let mut n = 0;
                    loop {
                        let k = sock.read(&mut buf[n..]).await.unwrap_or(0);
                        if k == 0 {
                            break;
                        }
                        n += k;
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        if let Some(at) = text.find("\r\n\r\n") {
                            let len = text
                                .lines()
                                .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                                .unwrap_or(0);
                            if n >= at + 4 + len {
                                break;
                            }
                        }
                    }
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let line = text.lines().next().unwrap_or_default().to_string();
                    let body = text.split("\r\n\r\n").nth(1).unwrap_or_default().to_string();
                    let path = line.split_whitespace().nth(1).unwrap_or_default().to_string();
                    let (status, out) = if path.starts_with("/.well-known/oauth-protected-resource") {
                        ("200 OK", json!({"resource": format!("{b}/mcp"), "authorization_servers": [b], "scopes_supported": ["read"]}))
                    } else if path.starts_with("/.well-known/oauth-authorization-server") {
                        ("200 OK", json!({
                            "authorization_endpoint": format!("{b}/authorize"),
                            "token_endpoint": format!("{b}/token"),
                            "registration_endpoint": format!("{b}/register"),
                            "token_endpoint_auth_methods_supported": ["none"],
                        }))
                    } else if path == "/register" {
                        ("201 Created", json!({"client_id": "client-1"}))
                    } else if path.starts_with("/seen?") {
                        *challenge.lock().unwrap() = path.split("c=").nth(1).unwrap_or_default().to_string();
                        ("200 OK", json!({}))
                    } else if path == "/token" {
                        let verifier = body.split('&').find_map(|p| p.strip_prefix("code_verifier=")).unwrap_or_default().to_string();
                        if body.contains("grant_type=refresh_token") {
                            ("200 OK", json!({"access_token": "tok-2", "expires_in": 3600}))
                        } else if challenge_of(&verifier) == *challenge.lock().unwrap() && body.contains("code=the-code") && body.contains("resource=") {
                            ("200 OK", json!({"access_token": "tok-1", "refresh_token": "ref-1", "expires_in": 3600}))
                        } else {
                            ("400 Bad Request", json!({"error": "invalid_grant", "error_description": "pkce mismatch"}))
                        }
                    } else {
                        ("404 Not Found", json!({}))
                    };
                    let out = out.to_string();
                    let reply = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{out}", out.len());
                    let _ = sock.write_all(reply.as_bytes()).await;
                });
            }
        });
        (base, handle)
    }

    #[tokio::test]
    async fn the_whole_flow_runs_against_a_mock_server() {
        let (base, server) = mock_server().await;
        let http = reqwest::Client::new();

        // The browser: reads the authorize URL, tells the server the challenge it
        // carried (as a real server would remember it), then follows the redirect.
        let b = base.clone();
        let open = move |url: &str| -> Result<()> {
            let u = reqwest::Url::parse(url)?;
            let q: HashMap<_, _> = u.query_pairs().into_owned().collect();
            assert_eq!(q["code_challenge_method"], "S256");
            assert_eq!(q["client_id"], "client-1");
            assert!(q["resource"].ends_with("/mcp"));
            let (redirect, state, challenge) = (q["redirect_uri"].clone(), q["state"].clone(), q["code_challenge"].clone());
            let b = b.clone();
            tokio::spawn(async move {
                let http = reqwest::Client::new();
                let _ = http.get(format!("{b}/seen?c={challenge}")).send().await;
                let _ = http.get(format!("{redirect}?code=the-code&state={state}")).send().await;
            });
            Ok(())
        };

        let tokens = sign_in(&http, "t", &format!("{base}/mcp"), None, None, &[], &open).await.unwrap();
        assert_eq!(tokens.access_token, "tok-1");
        assert_eq!(tokens.refresh_token.as_deref(), Some("ref-1"));
        assert!(tokens.expires_at.is_some());
        assert!(!needs_refresh(&tokens));

        let renewed = refresh(&http, &tokens).await.unwrap();
        assert_eq!(renewed.access_token, "tok-2");
        assert_eq!(renewed.refresh_token.as_deref(), Some("ref-1"), "the old refresh token survives a reply without one");
        server.abort();
    }

    #[tokio::test]
    async fn closing_the_waiting_sign_in_stops_it() {
        let (base, server) = mock_server().await;
        let http = reqwest::Client::new();
        let open = |_: &str| -> Result<()> {
            tokio::spawn(async {
                tokio::time::sleep(Duration::from_millis(150)).await;
                cancel("c");
            });
            Ok(())
        };
        let err = sign_in(&http, "c", &format!("{base}/mcp"), None, None, &[], &open).await.unwrap_err();
        assert!(err.to_string().contains("cancelled"), "{err}");
        server.abort();
    }
}
