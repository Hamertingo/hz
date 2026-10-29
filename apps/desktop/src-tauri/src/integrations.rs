//! The accounts and services the person connected: Google, Composio, Bark and 1Password.
//!
//! What is safe on disk (who is signed in, which agents may use what) lives in
//! `~/.hz/agentkit/integrations.json`; every key and token lives in the Keychain under the
//! names below, so nothing a process can read from the home folder signs in as the person.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agentkit::onepassword::OpConfig;

pub const GOOGLE_CLIENT: &str = "google.client";
pub const GOOGLE_AUTH: &str = "google.auth";
pub const COMPOSIO_KEY: &str = "composio.key";
pub const BARK_KEY: &str = "bark.key";

/// The Google account: who it is, which services were asked for, and the agents granted it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct GoogleConfig {
    #[serde(default)]
    pub email: Option<String>,
    /// Services the sign-in covered: `gmail`, `calendar`, `drive`, `organize`.
    #[serde(default)]
    pub services: Vec<String>,
    #[serde(default)]
    pub agents: Vec<String>,
}

/// A Composio tool-router session and the plugin it was saved as, per workspace.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ComposioConfig {
    /// Who hz is to Composio, minted once so every session finds the same connected apps.
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub mcp_url: Option<String>,
    /// `(workspace id, plugin id)` pairs the session was added to.
    #[serde(default)]
    pub plugins: Vec<(String, String)>,
}

/// Where Bark pushes go; the device key itself is in the Keychain.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BarkSettings {
    #[serde(default = "default_bark_server")]
    pub server: String,
    /// Off by default: a push names who and what kind and nothing else.
    #[serde(default)]
    pub full_text: bool,
}

fn default_bark_server() -> String {
    "https://api.day.app".into()
}

impl Default for BarkSettings {
    fn default() -> Self {
        BarkSettings { server: default_bark_server(), full_text: false }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Integrations {
    #[serde(default)]
    pub google: GoogleConfig,
    #[serde(default)]
    pub composio: ComposioConfig,
    #[serde(default)]
    pub bark: BarkSettings,
    #[serde(default)]
    pub onepassword: OpConfig,
}

/// The file, or `None` in tests, which must never read the developer's own grants.
fn path() -> Option<PathBuf> {
    if cfg!(test) {
        return None;
    }
    Some(std::env::home_dir()?.join(".hz").join("agentkit").join("integrations.json"))
}

pub fn load_from(p: &Path) -> Integrations {
    std::fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save_to(p: &Path, v: &Integrations) -> Result<()> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v)?)?;
    std::fs::rename(&tmp, p)?;
    Ok(())
}

static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// What is saved now; an empty set where nothing is (or in tests).
pub fn load() -> Integrations {
    path().map(|p| load_from(&p)).unwrap_or_default()
}

/// Reads, changes and writes the file under one lock, so two settings saved at once both land.
pub fn update<R>(change: impl FnOnce(&mut Integrations) -> R) -> Result<R> {
    let _g = LOCK.lock().expect("integrations lock poisoned");
    let p = path().ok_or_else(|| anyhow::anyhow!("no home folder"))?;
    let mut v = load_from(&p);
    let out = change(&mut v);
    save_to(&p, &v)?;
    Ok(out)
}

/// Adds or removes `agent` in a grant list, keeping it sorted and without repeats.
pub fn set_grant(list: &mut Vec<String>, agent: &str, on: bool) {
    list.retain(|a| a != agent);
    if on {
        list.push(agent.to_string());
        list.sort();
    }
}

/// Hands the draft cards' Send for channel `gmail` to the Google account.
pub fn start() {
    crate::agent_tools::register_sender("gmail", std::sync::Arc::new(crate::google_account::GmailSender));
}

fn has_secret(account: &str) -> bool {
    crate::keychain::get(account).ok().flatten().is_some_and(|s| !s.is_empty())
}

/// Everything the Settings rows and the Apps sheet draw, without a single secret.
#[tauri::command]
pub async fn integrations_status() -> Value {
    let v = load();
    let google_signed_in = has_secret(GOOGLE_AUTH);
    json!({
        "google": {
            "connected": google_signed_in,
            "hasClient": crate::google_account::client().is_some(),
            "email": v.google.email,
            "services": v.google.services,
            "agents": v.google.agents,
        },
        "composio": {
            "connected": has_secret(COMPOSIO_KEY) && v.composio.mcp_url.is_some(),
            "workspaces": v.composio.plugins.iter().map(|(w, _)| w.clone()).collect::<Vec<_>>(),
        },
        "bark": {
            "connected": has_secret(BARK_KEY),
            "server": v.bark.server,
            "fullText": v.bark.full_text,
            "encrypted": crate::bark_push::encrypted(),
        },
        "onepassword": {
            "installed": crate::op_login::installed(),
            "enabled": v.onepassword.enabled,
            "agents": v.onepassword.agents,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_round_trips_and_a_missing_one_is_empty() {
        let d = std::env::temp_dir().join(format!("hz-int-{}", uuid::Uuid::new_v4().simple()));
        let p = d.join("integrations.json");
        assert_eq!(load_from(&p).google, GoogleConfig::default());
        assert_eq!(load_from(&p).bark.server, "https://api.day.app");
        let mut v = Integrations::default();
        v.google.email = Some("ada@example.com".into());
        set_grant(&mut v.google.agents, "b", true);
        set_grant(&mut v.google.agents, "a", true);
        set_grant(&mut v.google.agents, "a", true);
        save_to(&p, &v).unwrap();
        let back = load_from(&p);
        assert_eq!(back.google.agents, vec!["a", "b"]);
        assert_eq!(back.google.email.as_deref(), Some("ada@example.com"));
        let mut list = back.google.agents;
        set_grant(&mut list, "a", false);
        assert_eq!(list, vec!["b"]);
        assert!(!std::fs::read_to_string(&p).unwrap().contains("token"));
    }

    #[test]
    fn tests_never_see_the_real_file() {
        assert!(path().is_none());
        assert!(load().google.agents.is_empty());
        assert!(update(|_| ()).is_err());
    }
}
