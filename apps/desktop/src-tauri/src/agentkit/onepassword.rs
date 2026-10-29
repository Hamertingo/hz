//! Sign-in cards that ask the 1Password `op` CLI for a login. The password is typed into the page by the app and never shown to an agent or logged.

use std::collections::BTreeSet;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Which agents may use 1Password, and whether the feature is on at all.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OpConfig {
    pub enabled: bool,
    pub agents: BTreeSet<String>,
}

impl OpConfig {
    /// Allowed only when the feature is on and this agent was chosen.
    pub fn can_use(&self, agent: &str) -> bool {
        self.enabled && self.agents.contains(agent)
    }
}

/// A secret string whose Debug and Display never show it.
#[derive(Clone, PartialEq, Eq)]
pub struct Password(String);

impl Password {
    /// The real value; call it only at the moment of typing it into the page.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Password {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Password(redacted)")
    }
}

impl std::fmt::Display for Password {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[redacted]")
    }
}

/// A username and password read from an item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Login {
    pub username: String,
    pub password: Password,
}

/// A vault item as the list call shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemSummary {
    pub id: String,
    pub title: String,
    pub urls: Vec<String>,
}

/// Runs the `op` binary with these arguments and returns its stdout; tests plug in a fake.
pub trait OpRunner {
    /// Runs `op <args>`.
    fn run(&self, args: &[String]) -> Result<String>;
}

/// The host part of a site or URL, lowercase and without `www.`; bare hosts work too.
pub fn host_of(site: &str) -> Option<String> {
    let s = site.trim();
    let with_scheme = if s.contains("://") { s.to_string() } else { format!("https://{s}") };
    let u = url::Url::parse(&with_scheme).ok()?;
    let h = u.host_str()?.to_lowercase();
    Some(h.strip_prefix("www.").unwrap_or(&h).to_string())
}

/// Arguments that list login items as JSON; matching to the site is done locally by `pick_item`.
pub fn build_item_lookup_args(site: &str) -> Vec<String> {
    let _ = site;
    ["item", "list", "--categories", "Login", "--format", "json"].iter().map(|s| s.to_string()).collect()
}

/// Arguments that fetch one item as JSON; `--reveal` is needed to get the password field's value.
pub fn build_item_get_args(id: &str) -> Vec<String> {
    ["item", "get", id, "--format", "json", "--reveal"].iter().map(|s| s.to_string()).collect()
}

/// Reads the output of the list call.
pub fn parse_items(json: &str) -> Result<Vec<ItemSummary>> {
    let v: Value = serde_json::from_str(json).map_err(|_| anyhow!("unexpected output from op"))?;
    let arr = v.as_array().ok_or_else(|| anyhow!("unexpected output from op"))?;
    Ok(arr
        .iter()
        .filter_map(|it| {
            let id = it.get("id")?.as_str()?.to_string();
            let title = it.get("title").and_then(Value::as_str).unwrap_or("").to_string();
            let urls = it
                .get("urls")
                .and_then(Value::as_array)
                .map(|u| u.iter().filter_map(|x| x.get("href").and_then(Value::as_str).map(String::from)).collect())
                .unwrap_or_default();
            Some(ItemSummary { id, title, urls })
        })
        .collect())
}

/// Reads username and password from an item fetched as JSON; errors name the problem without echoing any value.
pub fn parse_login(json: &str) -> Result<Login> {
    let v: Value = serde_json::from_str(json).map_err(|_| anyhow!("unexpected output from op"))?;
    let fields = v.get("fields").and_then(Value::as_array).ok_or_else(|| anyhow!("item has no fields"))?;
    let find = |purpose: &str, label: &str| {
        fields.iter().find_map(|f| {
            let p = f.get("purpose").and_then(Value::as_str).unwrap_or("");
            let l = f.get("label").and_then(Value::as_str).unwrap_or("");
            let val = f.get("value").and_then(Value::as_str)?;
            (p.eq_ignore_ascii_case(purpose) || l.eq_ignore_ascii_case(label)).then(|| val.to_string())
        })
    };
    let username = find("USERNAME", "username").ok_or_else(|| anyhow!("item has no username"))?;
    let password = find("PASSWORD", "password").ok_or_else(|| anyhow!("item has no password"))?;
    Ok(Login { username, password: Password(password) })
}

fn score(item: &ItemSummary, host: &str) -> u8 {
    let hosts: Vec<String> = item.urls.iter().filter_map(|u| host_of(u)).collect();
    if hosts.iter().any(|h| h == host) {
        return 4;
    }
    let sub = |a: &str, b: &str| a.ends_with(&format!(".{b}"));
    if hosts.iter().any(|h| sub(host, h) || sub(h, host)) {
        return 3;
    }
    let label = host.rsplit('.').nth(1).unwrap_or(host);
    if label.len() >= 3 && item.title.to_lowercase().contains(label) {
        return 1;
    }
    0
}

/// The best item for a site: exact host, then subdomain either way, then a title mention. Ties keep list order.
pub fn pick_item<'a>(items: &'a [ItemSummary], site: &str) -> Option<&'a ItemSummary> {
    let host = host_of(site)?;
    let mut best: Option<(&ItemSummary, u8)> = None;
    for it in items {
        let s = score(it, &host);
        if s > 0 && best.is_none_or(|(_, b)| s > b) {
            best = Some((it, s));
        }
    }
    best.map(|(i, _)| i)
}

/// Looks up a login for a site; `None` when nothing matches.
pub fn fetch_login(runner: &dyn OpRunner, site: &str) -> Result<Option<Login>> {
    let items = parse_items(&runner.run(&build_item_lookup_args(site))?)?;
    let Some(item) = pick_item(&items, site) else { return Ok(None) };
    parse_login(&runner.run(&build_item_get_args(&item.id))?).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, title: &str, urls: &[&str]) -> ItemSummary {
        ItemSummary { id: id.into(), title: title.into(), urls: urls.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn config_gate() {
        let mut c = OpConfig::default();
        c.agents.insert("leo".into());
        assert!(!c.can_use("leo"));
        c.enabled = true;
        assert!(c.can_use("leo"));
        assert!(!c.can_use("nova"));
    }

    #[test]
    fn password_is_redacted() {
        let l = parse_login(r#"{"fields":[{"purpose":"USERNAME","value":"me"},{"purpose":"PASSWORD","value":"s3cret"}]}"#).unwrap();
        assert_eq!(l.username, "me");
        assert_eq!(l.password.expose(), "s3cret");
        assert!(!format!("{l:?}").contains("s3cret"));
        assert!(!format!("{}", l.password).contains("s3cret"));
    }

    #[test]
    fn login_by_label_and_errors() {
        let l = parse_login(r#"{"fields":[{"label":"Username","value":"u"},{"label":"password","value":"p"}]}"#).unwrap();
        assert_eq!(l.username, "u");
        let e = parse_login(r#"{"fields":[{"purpose":"USERNAME","value":"u"}]}"#).unwrap_err().to_string();
        assert!(e.contains("no password") && !e.contains('u') || e.contains("no password"));
        assert!(parse_login("junk").is_err());
        assert!(parse_login("{}").is_err());
    }

    #[test]
    fn args_ask_for_json() {
        let a = build_item_lookup_args("github.com");
        assert!(a.windows(2).any(|w| w == ["--format", "json"]));
        assert!(build_item_get_args("abc").contains(&"abc".to_string()));
    }

    #[test]
    fn hosts_normalize() {
        assert_eq!(host_of("https://www.GitHub.com/login").as_deref(), Some("github.com"));
        assert_eq!(host_of("github.com").as_deref(), Some("github.com"));
        assert_eq!(host_of("").as_deref(), None);
    }

    #[test]
    fn exact_beats_subdomain_beats_title() {
        let items = vec![
            item("t", "My GitHub account", &[]),
            item("s", "Gh sub", &["https://gist.github.com"]),
            item("e", "Gh exact", &["https://github.com/login"]),
        ];
        assert_eq!(pick_item(&items, "https://github.com").unwrap().id, "e");
        assert_eq!(pick_item(&items[..2], "github.com").unwrap().id, "s");
        assert_eq!(pick_item(&items[..1], "github.com").unwrap().id, "t");
    }

    #[test]
    fn site_subdomain_matches_parent_item() {
        let items = vec![item("a", "Google", &["https://google.com"])];
        assert_eq!(pick_item(&items, "https://accounts.google.com/x").unwrap().id, "a");
    }

    #[test]
    fn no_match_is_none() {
        let items = vec![item("a", "Bank", &["https://bank.example"])];
        assert!(pick_item(&items, "github.com").is_none());
        assert!(pick_item(&items, "").is_none());
        assert!(pick_item(&[], "github.com").is_none());
    }

    #[test]
    fn lookalike_hosts_do_not_match() {
        let items = vec![item("a", "x", &["https://evilgithub.com"])];
        assert!(pick_item(&items, "github.com").is_none());
    }

    #[test]
    fn parse_items_skips_broken_rows() {
        let j = r#"[{"id":"1","title":"A","urls":[{"href":"https://a.com"}]},{"title":"no id"},{"id":"2"}]"#;
        let v = parse_items(j).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].urls, vec!["https://a.com"]);
        assert!(parse_items("{}").is_err());
    }

    #[test]
    fn fetch_login_through_runner() {
        struct R;
        impl OpRunner for R {
            fn run(&self, args: &[String]) -> Result<String> {
                Ok(if args[1] == "list" {
                    r#"[{"id":"i1","title":"GH","urls":[{"href":"https://github.com"}]}]"#.into()
                } else {
                    r#"{"fields":[{"purpose":"USERNAME","value":"me"},{"purpose":"PASSWORD","value":"pw"}]}"#.into()
                })
            }
        }
        let l = fetch_login(&R, "github.com").unwrap().unwrap();
        assert_eq!(l.username, "me");
        assert!(fetch_login(&R, "other.org").unwrap().is_none());
    }
}
