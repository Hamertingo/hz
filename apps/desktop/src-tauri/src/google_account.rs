//! The person's Google account: sign-in in the system browser, the refresh token in the Keychain,
//! and the one authenticated door every Gmail, Calendar and Drive call goes through.
//!
//! The browser flow is the plugin sign-in's (`plugin_oauth`): a loopback port takes the redirect,
//! PKCE guards the code, and the same wait and cancel are used. Google publishes its endpoints, so
//! nothing is discovered. hz ships no OAuth client of its own: the person brings a "Desktop app"
//! client from their Google Cloud project, unless the build was given one (`HZ_GOOGLE_CLIENT_ID`).
//!
//! Nothing here can send mail. The scopes come from `agentkit::google::scopes_for`, which has no
//! sending scope, and a Gmail "draft" is created in the person's Drafts folder, unsent.

use std::future::Future;
use std::sync::LazyLock;

use anyhow::{anyhow, bail, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

use crate::agentkit::drafts::{self, Draft};
use crate::agentkit::google::{self, Feature, GoogleAuth, ReqwestClient, TokenCache};
use crate::integrations::{self, GOOGLE_AUTH, GOOGLE_CLIENT};
use crate::{keychain, plugin_oauth};

pub const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const CANCEL_KEY: &str = "google";

/// The OAuth client the person brought.
#[derive(Clone, Serialize, Deserialize)]
struct OwnClient {
    client_id: String,
    client_secret: String,
}

/// The client to sign in with: the person's own, else one built into this binary, else none.
pub fn client() -> Option<(String, String)> {
    if let Some(c) = keychain::get(GOOGLE_CLIENT).ok().flatten().and_then(|s| serde_json::from_str::<OwnClient>(&s).ok()) {
        return Some((c.client_id, c.client_secret));
    }
    match (option_env!("HZ_GOOGLE_CLIENT_ID"), option_env!("HZ_GOOGLE_CLIENT_SECRET")) {
        (Some(id), Some(secret)) if !id.is_empty() => Some((id.to_string(), secret.to_string())),
        _ => None,
    }
}

/// The features behind the services the person ticked; an unknown name is refused.
pub fn features_for(services: &[String]) -> Result<Vec<Feature>> {
    let mut out = Vec::new();
    for s in services {
        out.extend_from_slice(match s.as_str() {
            "gmail" => &[Feature::GmailRead, Feature::GmailDraft][..],
            "calendar" => &[Feature::CalendarRead, Feature::CalendarCreate],
            "drive" => &[Feature::DriveRead],
            "organize" => &[Feature::GmailRead, Feature::GmailOrganize],
            other => bail!("unknown Google service {other}"),
        });
    }
    if out.is_empty() {
        bail!("pick at least one of Gmail, Calendar or Drive");
    }
    Ok(out)
}

/// Where the browser goes. `access_type=offline` and `prompt=consent` are what make Google hand back
/// a refresh token every time, including on a second sign-in with the same account.
pub fn authorize_url(client_id: &str, redirect: &str, state: &str, challenge: &str, scopes: &[&str]) -> String {
    let mut u = url::Url::parse(AUTH_URL).expect("constant url");
    let mut all = vec!["openid", "email"];
    all.extend_from_slice(scopes);
    u.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("include_granted_scopes", "true")
        .append_pair("scope", &all.join(" "));
    u.into()
}

/// The refresh token and the account's address out of the code exchange's answer.
pub fn parse_exchange(body: &Value) -> Result<(String, Option<String>)> {
    if let Some(e) = body.get("error").and_then(Value::as_str) {
        bail!("Google refused the sign-in: {} {}", e, body["error_description"].as_str().unwrap_or(""));
    }
    let refresh = body["refresh_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .context("Google gave no refresh token; remove hz from your Google account's third-party access and sign in again")?;
    let email = body["id_token"].as_str().and_then(plugin_oauth::account_of_id_token);
    Ok((refresh.to_string(), email))
}

/// Saves the person's own OAuth client. Both halves are kept in the Keychain.
#[tauri::command]
pub async fn google_set_client(client_id: String, client_secret: String) -> Result<(), String> {
    let (id, secret) = (client_id.trim(), client_secret.trim());
    if !id.ends_with(".apps.googleusercontent.com") {
        return Err("That is not a Google client ID: it ends in .apps.googleusercontent.com".into());
    }
    if secret.is_empty() {
        return Err("Paste the client secret too".into());
    }
    let c = OwnClient { client_id: id.into(), client_secret: secret.into() };
    keychain::set(GOOGLE_CLIENT, &serde_json::to_string(&c).map_err(|e| e.to_string())?).map_err(|e| format!("{e:#}"))
}

/// Runs the browser sign-in for the ticked services and keeps the refresh token. May wait minutes;
/// [`google_cancel`] ends the wait.
#[tauri::command]
pub async fn google_sign_in(app: AppHandle, services: Vec<String>) -> Result<Value, String> {
    sign_in(&app, services).await.map_err(|e| format!("{e:#}"))
}

async fn sign_in(app: &AppHandle, services: Vec<String>) -> Result<Value> {
    let (client_id, client_secret) = client().context("Add your Google OAuth client first")?;
    let features = features_for(&services)?;
    let scopes = google::scopes_for(&features);

    let listener = TcpListener::bind("127.0.0.1:0").await.context("could not listen for the browser")?;
    let redirect = format!("http://127.0.0.1:{}/callback", listener.local_addr()?.port());
    let verifier = plugin_oauth::random_token();
    let state = plugin_oauth::random_token();
    let url = authorize_url(&client_id, &redirect, &state, &plugin_oauth::challenge_of(&verifier), &scopes);

    let (tx, rx) = oneshot::channel();
    plugin_oauth::CANCELS.lock().expect("cancels poisoned").insert(CANCEL_KEY.into(), tx);
    let waited = async {
        app.opener().open_url(&url, None::<&str>).map_err(|e| anyhow!("could not open your browser: {e}"))?;
        plugin_oauth::wait_for_code(listener, &state, rx).await
    }
    .await;
    plugin_oauth::CANCELS.lock().expect("cancels poisoned").remove(CANCEL_KEY);
    let code = waited?;

    let resp = reqwest::Client::new()
        .post(google::TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("client_id", &client_id),
            ("client_secret", &client_secret),
            ("code_verifier", &verifier),
        ])
        .send()
        .await
        .context("could not reach Google")?;
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let (refresh_token, email) = parse_exchange(&body)?;

    let auth = GoogleAuth { client_id, client_secret, refresh_token };
    keychain::set(GOOGLE_AUTH, &serde_json::to_string(&auth)?)?;
    CACHE.lock().await.invalidate();
    integrations::update(|v| {
        v.google.email = email.clone();
        v.google.services = services.clone();
    })?;
    Ok(json!({"email": email, "services": services}))
}

/// Ends a sign-in that is waiting on the browser.
#[tauri::command]
pub fn google_cancel() {
    plugin_oauth::cancel(CANCEL_KEY);
}

/// Forgets the account: the token goes from the Keychain; the person's own client and the grants stay,
/// so signing in again puts everything back as it was.
#[tauri::command]
pub async fn google_sign_out() -> Result<(), String> {
    keychain::delete(GOOGLE_AUTH).map_err(|e| format!("{e:#}"))?;
    CACHE.lock().await.invalidate();
    integrations::update(|v| {
        v.google.email = None;
        v.google.services.clear();
    })
    .map_err(|e| format!("{e:#}"))
}

/// Lets one agent use the Google account, or stops it. Its next session gets (or loses) the tools.
#[tauri::command]
pub async fn google_grant(agent: String, on: bool) -> Result<(), String> {
    integrations::update(|v| integrations::set_grant(&mut v.google.agents, &agent, on)).map_err(|e| format!("{e:#}"))
}

/// The services an agent may use: those signed in for, when the person granted it the account.
pub fn services_for(agent_id: &str) -> Vec<String> {
    let v = integrations::load();
    if v.google.email.is_none() || !v.google.agents.iter().any(|a| a == agent_id) {
        return Vec::new();
    }
    v.google.services
}

static CACHE: LazyLock<Mutex<TokenCache>> = LazyLock::new(|| Mutex::new(TokenCache::new()));

fn auth() -> Result<GoogleAuth> {
    let raw = keychain::get(GOOGLE_AUTH)?.context("Google is not connected. The person connects it in Settings → Privacy.")?;
    Ok(serde_json::from_str(&raw)?)
}

/// The authenticated calls the tools make; a trait so the tools' tests run against canned replies.
pub trait Api: Sync {
    fn get(&self, url: &str) -> impl Future<Output = Result<String>> + Send;
    fn post(&self, url: &str, body: Value) -> impl Future<Output = Result<String>> + Send;
}

/// The real account, through the token cache. A 401 drops the cached token and tries once more.
pub struct Live;

impl Live {
    async fn send(&self, url: &str, body: Option<&Value>) -> Result<String> {
        let http = reqwest::Client::new();
        for attempt in 0..2 {
            let auth = auth()?;
            let token = CACHE.lock().await.get(&ReqwestClient(http.clone()), &auth, Utc::now()).await?;
            let req = match body {
                Some(b) => http.post(url).json(b),
                None => http.get(url),
            };
            let resp = req.bearer_auth(token).send().await.context("could not reach Google")?;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if status.as_u16() == 401 && attempt == 0 {
                CACHE.lock().await.invalidate();
                continue;
            }
            if !status.is_success() {
                bail!("Google answered {status}: {}", error_message(&text));
            }
            return Ok(text);
        }
        unreachable!("the loop returns on its second pass")
    }
}

impl Api for Live {
    async fn get(&self, url: &str) -> Result<String> {
        self.send(url, None).await
    }
    async fn post(&self, url: &str, body: Value) -> Result<String> {
        self.send(url, Some(&body)).await
    }
}

/// Google's own sentence out of an error body, or the start of the body.
pub fn error_message(text: &str) -> String {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(String::from))
        .unwrap_or_else(|| text.chars().take(200).collect())
}

/// A file's type from its name, for an attachment; anything unknown goes as bytes.
pub fn mime_of(name: &str) -> &'static str {
    match name.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("pdf") => "application/pdf",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("txt" | "md") => "text/plain",
        Some("csv") => "text/csv",
        Some("html" | "htm") => "text/html",
        Some("json") => "application/json",
        Some("zip") => "application/zip",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }
}

/// Creates an unsent draft in the person's Gmail and returns its id.
pub async fn create_draft<A: Api>(api: &A, to: &str, subject: &str, body: &str, files: &[google::Attachment]) -> Result<String> {
    let raw = google::draft_body(to, subject, body, files)?;
    let reply = api.post(google::DRAFTS_ENDPOINT, google::draft_request_json(&raw)).await?;
    let v: Value = serde_json::from_str(&reply)?;
    v["id"].as_str().map(String::from).context("Gmail made no draft")
}

fn attachments_of(paths: &[String]) -> Result<Vec<google::Attachment>> {
    paths
        .iter()
        .map(|p| {
            let path = std::path::Path::new(p);
            let filename = path.file_name().and_then(|n| n.to_str()).context("an attachment has no file name")?.to_string();
            let data = std::fs::read(path).with_context(|| format!("could not read the attachment {filename}"))?;
            Ok(google::Attachment { mime: mime_of(&filename).into(), filename, data })
        })
        .collect()
}

/// What pressing Send on a `gmail` draft card does: the draft lands in Gmail's Drafts folder, with
/// its attachments, for the person to send from there. Returns the receipt the card shows.
pub async fn send_draft_to_gmail<A: Api>(api: &A, d: &Draft) -> Result<String> {
    if d.channel != "gmail" {
        bail!("this draft is for {}, not Gmail", d.channel);
    }
    let id = create_draft(api, &d.to, &d.subject, &d.body, &attachments_of(&d.attachments)?).await?;
    Ok(format!("{} in Gmail drafts ({id})", chrono::Local::now().format("%H:%M")))
}

/// The `drafts::Sender` for channel `gmail`. The trait is synchronous, so the call runs on a runtime of
/// its own on a scoped thread: safe from inside the app's runtime and from a plain thread alike.
pub struct GmailSender;

impl drafts::Sender for GmailSender {
    fn send(&self, draft: &Draft) -> Result<String> {
        std::thread::scope(|s| {
            s.spawn(|| tokio::runtime::Builder::new_current_thread().enable_all().build()?.block_on(send_draft_to_gmail(&Live, draft)))
                .join()
                .map_err(|_| anyhow!("the Gmail sender stopped"))?
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use std::sync::Mutex as StdMutex;

    #[test]
    fn the_authorize_url_asks_for_offline_access_and_no_sending() {
        let scopes = google::scopes_for(&features_for(&["gmail".into(), "calendar".into()]).unwrap());
        let u = authorize_url("cid.apps.googleusercontent.com", "http://127.0.0.1:5/callback", "st", "ch", &scopes);
        let q: std::collections::HashMap<_, _> = url::Url::parse(&u).unwrap().query_pairs().into_owned().collect();
        assert!(u.starts_with(AUTH_URL));
        assert_eq!(q["access_type"], "offline");
        assert_eq!(q["prompt"], "consent");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5/callback");
        assert!(q["scope"].starts_with("openid email "));
        assert!(q["scope"].contains("gmail.compose") && q["scope"].contains("calendar.events"));
        assert!(!q["scope"].contains("send") && !q["scope"].contains("mail.google.com"));
    }

    #[test]
    fn services_map_to_features() {
        assert_eq!(features_for(&["drive".into()]).unwrap(), vec![Feature::DriveRead]);
        assert!(features_for(&[]).is_err());
        assert!(features_for(&["photos".into()]).is_err());
        assert!(features_for(&["organize".into()]).unwrap().contains(&Feature::GmailOrganize));
    }

    #[test]
    fn the_exchange_needs_a_refresh_token_and_reads_the_address() {
        let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"email":"ada@example.com"}"#);
        let (r, e) = parse_exchange(&json!({"access_token": "a", "refresh_token": "r1", "id_token": format!("h.{claims}.s")})).unwrap();
        assert_eq!((r.as_str(), e.as_deref()), ("r1", Some("ada@example.com")));
        assert!(parse_exchange(&json!({"access_token": "a"})).unwrap_err().to_string().contains("refresh token"));
        assert!(parse_exchange(&json!({"error": "invalid_grant"})).is_err());
    }

    #[test]
    fn errors_say_googles_words() {
        assert_eq!(error_message(r#"{"error":{"code":403,"message":"Insufficient Permission"}}"#), "Insufficient Permission");
        assert_eq!(error_message("plain"), "plain");
        assert_eq!(mime_of("Report.PDF"), "application/pdf");
        assert_eq!(mime_of("x"), "application/octet-stream");
    }

    /// A fake account that records what was posted and answers in Gmail's shape.
    pub(crate) struct Fake {
        pub posts: StdMutex<Vec<(String, Value)>>,
        pub replies: std::collections::HashMap<String, String>,
    }
    impl Api for Fake {
        async fn get(&self, url: &str) -> Result<String> {
            self.replies
                .iter()
                .find(|(k, _)| url.starts_with(k.as_str()))
                .map(|(_, v)| v.clone())
                .ok_or_else(|| anyhow!("no fake reply for {url}"))
        }
        async fn post(&self, url: &str, body: Value) -> Result<String> {
            self.posts.lock().unwrap().push((url.into(), body));
            Ok(r#"{"id":"r-1","message":{"id":"m-1"}}"#.into())
        }
    }

    #[tokio::test]
    async fn a_gmail_draft_card_becomes_an_unsent_gmail_draft_with_its_file() {
        let dir = std::env::temp_dir().join(format!("hz-gd-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("report.pdf");
        std::fs::write(&file, b"%PDF").unwrap();
        let fake = Fake { posts: StdMutex::new(vec![]), replies: Default::default() };
        let mut d = Draft::new("1", "bo@example.com", "Report", "Here it is", vec![file.to_string_lossy().into()], "gmail");
        d.request_send().unwrap();
        let receipt = send_draft_to_gmail(&fake, &d).await.unwrap();
        assert!(receipt.contains("Gmail drafts (r-1)"));
        let posts = fake.posts.lock().unwrap();
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].0, google::DRAFTS_ENDPOINT);
        let raw = posts[0].1["message"]["raw"].as_str().unwrap();
        let text = String::from_utf8(base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(raw).unwrap()).unwrap();
        assert!(text.starts_with("To: bo@example.com\r\n") && text.contains("filename=\"report.pdf\"") && text.contains("application/pdf"));
    }

    #[tokio::test]
    async fn the_sender_refuses_other_channels_and_missing_files() {
        let fake = Fake { posts: StdMutex::new(vec![]), replies: Default::default() };
        let d = Draft::new("1", "a@b.c", "s", "b", vec![], "clipboard");
        assert!(send_draft_to_gmail(&fake, &d).await.is_err());
        let d = Draft::new("1", "a@b.c", "s", "b", vec!["/nope/gone.pdf".into()], "gmail");
        assert!(send_draft_to_gmail(&fake, &d).await.unwrap_err().to_string().contains("gone.pdf"));
        assert!(fake.posts.lock().unwrap().is_empty());
    }

    #[test]
    fn the_sync_sender_reports_no_account_as_a_failed_draft() {
        let mut d = Draft::new("1", "a@b.c", "s", "b", vec![], "gmail");
        d.request_send().unwrap();
        drafts::process(&mut d, &GmailSender);
        assert!(matches!(&d.state, drafts::State::Failed(r) if r.contains("not connected")), "{:?}", d.state);
    }
}
