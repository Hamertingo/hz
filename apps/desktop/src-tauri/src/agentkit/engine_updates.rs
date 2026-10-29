//! Finds which installed agent CLIs have a newer release and the command that updates each.

use std::collections::HashMap;

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::accounts::Engine;

/// Hours between checks.
pub const CHECK_EVERY_HOURS: i64 = 6;

/// A version ordered by number first; a pre-release sorts below the same number released.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    stable: bool,
}

/// Finds the first dotted number in the text ("v1.2", "claude 2.0.5 (Code)") and reads it; `None` when there is none.
pub fn parse_version(s: &str) -> Option<Version> {
    let re = Regex::new(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?").ok()?;
    let c = re.captures(s)?;
    let n = |i: usize| c.get(i).map_or(Some(0), |m| m.as_str().parse::<u64>().ok());
    let end = c.get(0)?.end();
    let rest = &s[end..];
    let pre = rest.strip_prefix('-').is_some_and(|r| r.starts_with(|ch: char| ch.is_ascii_alphabetic()));
    Some(Version { major: n(1)?, minor: n(2)?, patch: n(3)?, stable: !pre })
}

/// True when `latest` is a higher version than `installed`; unreadable input is never newer.
pub fn is_newer(installed: &str, latest: &str) -> bool {
    match (parse_version(installed), parse_version(latest)) {
        (Some(a), Some(b)) => b > a,
        _ => false,
    }
}

/// An engine that can be updated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub engine: Engine,
    pub installed: String,
    pub latest: String,
    pub update_command: Vec<String>,
}

/// The command that updates an engine, or `None` for engines we do not update.
pub fn update_command(engine: Engine) -> Option<Vec<String>> {
    let parts: &[&str] = match engine {
        Engine::Claude => &["claude", "update"],
        Engine::Codex => &["codex", "update"],
        Engine::OpenCode => &["opencode", "upgrade"],
        Engine::Grok => &["grok", "update"],
        Engine::Antigravity => return None,
    };
    Some(parts.iter().map(|s| s.to_string()).collect())
}

/// The npm package that publishes an engine, for engines checked through the registry.
pub fn npm_package(engine: Engine) -> Option<&'static str> {
    match engine {
        Engine::Claude => Some("@anthropic-ai/claude-code"),
        Engine::Codex => Some("@openai/codex"),
        Engine::OpenCode => Some("opencode-ai"),
        Engine::Grok => Some("@vibe-kit/grok-cli"),
        Engine::Antigravity => None,
    }
}

/// The registry URL that answers with a package's dist-tags.
pub fn npm_latest_url(package: &str) -> String {
    format!("https://registry.npmjs.org/-/package/{}/dist-tags", package.replace('/', "%2f"))
}

/// Reads `latest` from a dist-tags document, or from a full packument's `dist-tags.latest`.
pub fn parse_npm_latest(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let s = v.get("dist-tags").and_then(|d| d.get("latest")).or_else(|| v.get("latest"))?;
    s.as_str().map(str::to_string)
}

/// Where a latest version comes from; tests plug in a fake instead of the network.
pub trait Source {
    /// The engine this source answers for.
    fn engine(&self) -> Engine;
    /// The newest released version string.
    fn latest(&self) -> Result<String>;
}

/// Asks every source and returns the engines that are behind; failed lookups and engines with no update command are skipped.
pub fn check_all(sources: &[&dyn Source], installed: &HashMap<Engine, String>) -> Vec<UpdateInfo> {
    let mut out = Vec::new();
    for s in sources {
        let engine = s.engine();
        let (Some(cmd), Some(have)) = (update_command(engine), installed.get(&engine)) else {
            continue;
        };
        let Ok(latest) = s.latest() else { continue };
        if is_newer(have, &latest) {
            out.push(UpdateInfo { engine, installed: have.clone(), latest, update_command: cmd });
        }
    }
    out
}

/// Whether six hours passed since the last check (or there was none); a clock that moved backwards counts as due.
pub fn should_check(last_checked: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    match last_checked {
        None => true,
        Some(t) => now < t || now - t >= Duration::hours(CHECK_EVERY_HOURS),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;

    struct Fake(Engine, Result<&'static str, &'static str>);
    impl Source for Fake {
        fn engine(&self) -> Engine {
            self.0
        }
        fn latest(&self) -> Result<String> {
            self.1.map(str::to_string).map_err(|e| anyhow!(e))
        }
    }

    #[test]
    fn parses_tolerantly() {
        let v = parse_version("v1.2.3").unwrap();
        assert_eq!((v.major, v.minor, v.patch), (1, 2, 3));
        let v = parse_version("claude 2.0.5 (Claude Code)").unwrap();
        assert_eq!((v.major, v.minor, v.patch), (2, 0, 5));
        assert_eq!(parse_version("3").unwrap().major, 3);
        assert!(parse_version("no digits").is_none());
        assert!(parse_version("").is_none());
    }

    #[test]
    fn newer_comparisons() {
        assert!(is_newer("1.2.3", "1.2.4"));
        assert!(is_newer("v1.9.0", "1.10.0"));
        assert!(!is_newer("1.2.3", "1.2.3"));
        assert!(!is_newer("2.0.0", "1.9.9"));
        assert!(!is_newer("junk", "1.0.0"));
        assert!(!is_newer("1.0.0", "junk"));
    }

    #[test]
    fn prerelease_is_older_than_release() {
        assert!(is_newer("1.0.0-beta.1", "1.0.0"));
        assert!(!is_newer("1.0.0", "1.0.0-beta.2"));
    }

    #[test]
    fn huge_numbers_do_not_panic() {
        assert!(parse_version("99999999999999999999999.1").is_none());
    }

    #[test]
    fn npm_parsing() {
        assert_eq!(parse_npm_latest(r#"{"dist-tags":{"latest":"1.4.0","next":"2.0.0-rc"}}"#), Some("1.4.0".into()));
        assert_eq!(parse_npm_latest(r#"{"latest":"0.9.1"}"#), Some("0.9.1".into()));
        assert_eq!(parse_npm_latest("not json"), None);
        assert_eq!(parse_npm_latest(r#"{"dist-tags":{}}"#), None);
    }

    #[test]
    fn commands_and_packages() {
        assert_eq!(update_command(Engine::OpenCode).unwrap(), vec!["opencode", "upgrade"]);
        assert_eq!(update_command(Engine::Claude).unwrap(), vec!["claude", "update"]);
        assert!(update_command(Engine::Antigravity).is_none());
        assert!(npm_package(Engine::Antigravity).is_none());
        assert!(npm_latest_url("@openai/codex").contains("%2f"));
    }

    #[test]
    fn check_all_reports_only_behind_engines() {
        let a = Fake(Engine::Claude, Ok("2.1.0"));
        let b = Fake(Engine::Codex, Ok("0.5.0"));
        let c = Fake(Engine::Grok, Err("offline"));
        let d = Fake(Engine::OpenCode, Ok("9.9.9"));
        let mut inst = HashMap::new();
        inst.insert(Engine::Claude, "2.0.0".to_string());
        inst.insert(Engine::Codex, "0.5.0".to_string());
        inst.insert(Engine::Grok, "1.0.0".to_string());
        let r = check_all(&[&a, &b, &c, &d], &inst);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].engine, Engine::Claude);
        assert_eq!(r[0].update_command, vec!["claude", "update"]);
    }

    #[test]
    fn check_all_skips_engines_without_command() {
        let a = Fake(Engine::Antigravity, Ok("9.0.0"));
        let mut inst = HashMap::new();
        inst.insert(Engine::Antigravity, "1.0.0".to_string());
        assert!(check_all(&[&a], &inst).is_empty());
    }

    #[test]
    fn six_hour_rule() {
        let now = Utc::now();
        assert!(should_check(None, now));
        assert!(!should_check(Some(now - Duration::hours(5)), now));
        assert!(should_check(Some(now - Duration::hours(6)), now));
        assert!(should_check(Some(now + Duration::hours(1)), now));
    }
}
