//! Pushes to the person's phone through Bark when an agent needs them (an approval, a question, a
//! take-over) or finishes, and hz is not the window in front. By default a push names who and what
//! kind and nothing else; with an encrypt key and "full text" on, the text rides AES-encrypted.
//!
//! The banner door (`notifications::deliver`) and the finished-work hook in the inbox call
//! [`on_banner`] and [`finished`]; a push is a side channel, so a failure is logged and dropped.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::agentkit::bark::{self, BarkConfig, Kind, Notice};
use crate::integrations::{self, BARK_KEY};
use crate::keychain;

/// The secret half: the device key and the optional 32-character encrypt key.
#[derive(Serialize, Deserialize)]
struct Keys {
    device_key: String,
    #[serde(default)]
    encrypt_key: Option<String>,
}

fn keys() -> Option<Keys> {
    keychain::get(BARK_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
}

/// Whether pushes can carry encrypted text.
pub fn encrypted() -> bool {
    keys().is_some_and(|k| k.encrypt_key.is_some())
}

/// Takes what Bark shows on the phone's setup screen: a bare key, or a whole `https://api.day.app/<key>/...` URL.
pub fn parse_key(pasted: &str) -> (Option<String>, String) {
    let s = pasted.trim();
    if let Ok(u) = url::Url::parse(s) {
        if matches!(u.scheme(), "http" | "https") {
            let key = u.path_segments().and_then(|mut p| p.next()).unwrap_or_default().to_string();
            let server = format!("{}://{}", u.scheme(), u.host_str().unwrap_or_default())
                + &u.port().map(|p| format!(":{p}")).unwrap_or_default();
            return (Some(server), key);
        }
    }
    (None, s.to_string())
}

/// What kind of push a banner is, from the banner's own kind and title; `None` for one that does not push.
pub fn kind_of(banner_kind: &str, title: &str) -> Option<Kind> {
    match banner_kind {
        "asking" if title.contains("question") => Some(Kind::Question),
        "asking" => Some(Kind::Approval),
        "takeover" => Some(Kind::Takeover),
        "done" | "completed" => Some(Kind::Finished),
        _ => None,
    }
}

fn in_front(app: &AppHandle) -> bool {
    app.webview_windows().values().any(|w| w.is_focused().unwrap_or(false))
}

/// Builds and sends one push when Bark is set up, ignoring whether hz is in front.
async fn push(who: &str, kind: Kind, text: &str) -> Result<()> {
    let Some(k) = keys() else { return Ok(()) };
    let settings = integrations::load().bark;
    let cfg = BarkConfig { server: settings.server, device_key: k.device_key, encrypt_key: k.encrypt_key };
    let req = bark::build_request(&cfg, &Notice { who: who.into(), kind, text: text.into() }, settings.full_text)?;
    let resp = reqwest::Client::new().post(&req.url).json(&req.body_json).send().await.context("could not reach Bark")?;
    if !resp.status().is_success() {
        anyhow::bail!("Bark answered {}", resp.status());
    }
    Ok(())
}

/// Pushes `kind` for `who` when hz is in the background.
pub fn notify(app: &AppHandle, who: &str, kind: Kind, text: &str) {
    if in_front(app) || keys().is_none() {
        return;
    }
    let (who, text) = (who.to_string(), text.to_string());
    tauri::async_runtime::spawn(async move {
        if let Err(e) = push(&who, kind, &text).await {
            eprintln!("[bark err] {e:#}");
        }
    });
}

/// The banner door's hook: names the session's agent and pushes what the banner was about.
pub fn on_banner(app: &AppHandle, session_id: Option<&str>, banner_kind: &str, title: &str, body: &str) {
    let Some(kind) = kind_of(banner_kind, title) else { return };
    let who = session_id
        .and_then(crate::agents::agent_of)
        .map(|a| a.name)
        .unwrap_or_else(|| title.split(' ').next().unwrap_or("An agent").to_string());
    notify(app, &who, kind, body);
}

/// An agent's turn ended out of sight.
pub fn finished(app: &AppHandle, who: &str, text: &str) {
    notify(app, who, Kind::Finished, text);
}

/// Saves the device key (a bare key or the URL Bark shows) and, optionally, the encrypt key.
#[tauri::command]
pub async fn bark_set(key: String, encrypt_key: Option<String>, full_text: bool) -> Result<(), String> {
    let (server, device_key) = parse_key(&key);
    let encrypt_key = encrypt_key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    let server = server.unwrap_or_else(|| integrations::BarkSettings::default().server);
    // The same checks a push makes, so a key that cannot work is refused here and not at the first buzz.
    let cfg = BarkConfig { server: server.clone(), device_key: device_key.clone(), encrypt_key: encrypt_key.clone() };
    let probe = Notice { who: "hz".into(), kind: Kind::Finished, text: String::new() };
    bark::build_request(&cfg, &probe, encrypt_key.is_some()).map_err(|e| e.to_string())?;
    let keys = Keys { device_key, encrypt_key };
    keychain::set(BARK_KEY, &serde_json::to_string(&keys).map_err(|e| e.to_string())?).map_err(|e| format!("{e:#}"))?;
    integrations::update(|v| {
        v.bark.server = server;
        v.bark.full_text = full_text && keys.encrypt_key.is_some();
    })
    .map_err(|e| format!("{e:#}"))
}

/// Turns the pushed text on or off; it can only be on with an encryption key, so it never travels in the clear.
#[tauri::command]
pub async fn bark_full_text(on: bool) -> Result<(), String> {
    let on = on && encrypted();
    integrations::update(|v| v.bark.full_text = on).map_err(|e| format!("{e:#}"))
}

/// Forgets the phone.
#[tauri::command]
pub async fn bark_clear() -> Result<(), String> {
    keychain::delete(BARK_KEY).map_err(|e| format!("{e:#}"))
}

/// Sends a push now, in front or not, so the person sees it arrive.
#[tauri::command]
pub async fn bark_test() -> Result<(), String> {
    if keys().is_none() {
        return Err("Add your Bark key first".into());
    }
    push("hz", Kind::Finished, "This is a test push from hz.").await.map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The JSON a push would post; nothing is sent.
    fn preview(server: &str, device_key: &str, who: &str, kind: Kind, text: &str, full_text: bool) -> Result<serde_json::Value> {
        let cfg = BarkConfig { server: server.into(), device_key: device_key.into(), encrypt_key: None };
        Ok(bark::build_request(&cfg, &Notice { who: who.into(), kind, text: text.into() }, full_text)?.body_json)
    }

    #[test]
    fn a_pasted_url_gives_the_server_and_the_key() {
        assert_eq!(parse_key(" https://api.day.app/AbC123/hello "), (Some("https://api.day.app".into()), "AbC123".into()));
        assert_eq!(parse_key("http://bark.home:8080/k9"), (Some("http://bark.home:8080".into()), "k9".into()));
        assert_eq!(parse_key("AbC123"), (None, "AbC123".into()));
    }

    #[test]
    fn banners_map_to_push_kinds() {
        assert_eq!(kind_of("asking", "Leo has a question"), Some(Kind::Question));
        assert_eq!(kind_of("asking", "Leo wants your ok"), Some(Kind::Approval));
        assert_eq!(kind_of("takeover", "x"), Some(Kind::Takeover));
        assert_eq!(kind_of("done", "x"), Some(Kind::Finished));
        assert_eq!(kind_of("mention", "Leo mentioned you"), None);
        assert_eq!(kind_of("pr", "x"), None);
    }

    #[test]
    fn by_default_a_push_says_only_who_and_what_kind() {
        let v = preview("https://api.day.app", "k1", "Leo", Kind::Approval, "rm -rf ~/secret-project", false).unwrap();
        assert_eq!(v["body"], "Leo needs approval");
        assert!(!v.to_string().contains("secret-project"));
    }

    #[tokio::test]
    async fn a_test_push_without_a_key_says_so() {
        assert!(bark_test().await.unwrap_err().contains("Bark key"));
    }
}
