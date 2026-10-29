//! Sign-in cards that fill from 1Password, through the `op` CLI and its Touch ID prompt. Off until
//! the person turns it on, and then only for the agents they pick. The password goes from `op`
//! to the page filler as a `site_login::Secret`; it never reaches the agent, the webview or a log.

use std::path::PathBuf;
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use crate::agentkit::onepassword::{self, OpRunner};
use crate::agentkit::site_login::{LoginFields, Secret};
use crate::integrations;
use crate::proc::HideConsole;

/// Where `op` usually lives: Homebrew on either chip, the installer's own place, then `PATH`.
fn op_path() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].iter().map(PathBuf::from).collect();
    dirs.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    dirs.into_iter().map(|d| d.join(if cfg!(windows) { "op.exe" } else { "op" })).find(|p| p.is_file())
}

/// Whether the 1Password CLI is installed on this Mac.
pub fn installed() -> bool {
    op_path().is_some()
}

/// The real `op`: stdin closed so it can never wait on a prompt in a terminal nobody sees.
pub struct SystemOp;

impl OpRunner for SystemOp {
    fn run(&self, args: &[String]) -> Result<String> {
        let bin = op_path().context("the 1Password CLI (op) is not installed")?;
        let out = Command::new(bin)
            .hide_console()
            .args(args)
            .stdin(Stdio::null())
            .output()
            .context("could not run op")?;
        if !out.status.success() {
            // op's own words say "not signed in" or "authorization prompt dismissed"; they hold no secret.
            bail!("1Password said: {}", String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }
}

/// The login for `site`, for the page filler alone, when this agent may use 1Password. The seam the
/// sign-in card's "Fill from 1Password" calls once something can type a secret into the agent's
/// browser without putting it on a command line; until then only its tests call it.
#[cfg_attr(not(test), allow(dead_code))]
pub fn login_fields(runner: &dyn OpRunner, agent_id: &str, site: &str) -> Result<Option<LoginFields>> {
    if !integrations::load().onepassword.can_use(agent_id) {
        bail!("1Password is not switched on for this agent");
    }
    Ok(onepassword::fetch_login(runner, site)?
        .map(|l| LoginFields { username: Secret::new(l.username), password: Secret::new(l.password.expose()) }))
}

/// Whether there is a login for the site, and its username, for the card's "Fill from 1Password"
/// line. Lists items only: the item itself (and its password) is not fetched until the fill.
pub fn lookup(runner: &dyn OpRunner, site: &str) -> Result<Value> {
    let items = onepassword::parse_items(&runner.run(&onepassword::build_item_lookup_args(site))?)?;
    Ok(match onepassword::pick_item(&items, site) {
        Some(i) => json!({"available": true, "title": i.title}),
        None => json!({"available": false}),
    })
}

/// Switches 1Password on or off and sets which agents may use it.
#[tauri::command]
pub async fn op_set(enabled: bool, agents: Vec<String>) -> Result<(), String> {
    integrations::update(|v| {
        v.onepassword.enabled = enabled;
        v.onepassword.agents = agents.into_iter().collect();
    })
    .map_err(|e| format!("{e:#}"))
}

/// What a sign-in card for `site` can offer this agent from 1Password. Never a password.
#[tauri::command]
pub async fn op_lookup(agent: String, site: String) -> Result<Value, String> {
    if !integrations::load().onepassword.can_use(&agent) {
        return Ok(json!({"available": false, "reason": "off"}));
    }
    tokio::task::spawn_blocking(move || lookup(&SystemOp, &site).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Vault;
    impl OpRunner for Vault {
        fn run(&self, args: &[String]) -> Result<String> {
            Ok(if args[1] == "list" {
                r#"[{"id":"i1","title":"GitHub","urls":[{"href":"https://github.com/login"}]}]"#.into()
            } else {
                r#"{"fields":[{"purpose":"USERNAME","value":"ada"},{"purpose":"PASSWORD","value":"pw-123"}]}"#.into()
            })
        }
    }

    #[test]
    fn a_lookup_names_the_item_and_never_the_password() {
        let v = lookup(&Vault, "https://github.com").unwrap();
        assert_eq!(v, json!({"available": true, "title": "GitHub"}));
        assert!(!v.to_string().contains("pw-123"));
        assert_eq!(lookup(&Vault, "bank.example").unwrap()["available"], false);
    }

    #[test]
    fn the_fill_is_refused_unless_the_agent_was_picked() {
        // Tests see an empty settings file, which is the default: off for everyone.
        assert!(login_fields(&Vault, "leo", "github.com").unwrap_err().to_string().contains("not switched on"));
    }
}
