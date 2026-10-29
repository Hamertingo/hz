//! Spending limits for agents: per purchase, per month, and a short window once a purchase is cleared.

use anyhow::{anyhow, bail, Result};
use chrono::{DateTime, Datelike, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// How long a cleared purchase stays open for its agent.
pub const WINDOW_MINUTES: i64 = 10;

/// What the reader allows. Off until switched on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Limits {
    pub enabled: bool,
    pub per_purchase_cents: u64,
    pub per_month_cents: u64,
    pub agents: BTreeSet<String>,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { enabled: false, per_purchase_cents: 6000, per_month_cents: 20000, agents: BTreeSet::new() }
    }
}

/// The answer to a purchase request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Go ahead until `window_until` (epoch seconds).
    Within { window_until: i64 },
    /// A person must approve; the string says why.
    Ask(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Window {
    until: i64,
    purpose: String,
    place: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Spend {
    agent: String,
    cents: u64,
    at: i64,
    purpose: String,
    place: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Ledger {
    month: String,
    spent_cents: u64,
    windows: BTreeMap<String, Window>,
    history: Vec<Spend>,
}

/// Limits plus what has been spent under them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Payments {
    pub limits: Limits,
    ledger: Ledger,
}

fn month_key(now: DateTime<Utc>) -> String {
    format!("{:04}-{:02}", now.year(), now.month())
}

/// Reads "12", "12.5" or "12.50" as cents; rejects signs, extra digits and overflow.
pub fn parse_amount_cents(s: &str) -> Result<i64> {
    let s = s.trim();
    let (whole, frac) = s.split_once('.').unwrap_or((s, ""));
    if whole.is_empty() || !whole.chars().all(|c| c.is_ascii_digit()) || !frac.chars().all(|c| c.is_ascii_digit()) || frac.len() > 2 {
        bail!("not an amount: {s:?}");
    }
    let frac_cents: i64 = format!("{frac:0<2}").parse().unwrap_or(0);
    let whole: i64 = whole.parse().map_err(|_| anyhow!("amount too large"))?;
    whole
        .checked_mul(100)
        .and_then(|w| w.checked_add(frac_cents))
        .ok_or_else(|| anyhow!("amount too large"))
}

impl Payments {
    /// Loads state from `path`; a missing or unreadable file gives the defaults (disabled).
    pub fn load(path: &Path) -> Payments {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    /// Writes state atomically.
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    fn roll(&mut self, now: DateTime<Utc>) {
        let key = month_key(now);
        if self.ledger.month != key {
            self.ledger.month = key;
            self.ledger.spent_cents = 0;
        }
    }

    /// Spent so far in the month that `now` falls in.
    pub fn spent_this_month(&mut self, now: DateTime<Utc>) -> u64 {
        self.roll(now);
        self.ledger.spent_cents
    }

    fn check(&self, agent: &str, cents: i64) -> std::result::Result<u64, String> {
        if !self.limits.enabled {
            return Err("agent payments are switched off".into());
        }
        if !self.limits.agents.contains(agent) {
            return Err(format!("{agent} is not allowed to spend"));
        }
        if cents <= 0 {
            return Err("the amount must be above zero".into());
        }
        let cents = cents as u64;
        if cents > self.limits.per_purchase_cents {
            return Err(format!("{} is over the per-purchase limit of {}", fmt(cents), fmt(self.limits.per_purchase_cents)));
        }
        match self.ledger.spent_cents.checked_add(cents) {
            Some(t) if t <= self.limits.per_month_cents => Ok(cents),
            _ => Err(format!("this would pass the monthly limit of {}", fmt(self.limits.per_month_cents))),
        }
    }

    /// Decides a purchase request; Within opens a ten-minute window for the agent.
    pub fn request(&mut self, agent: &str, cents: i64, purpose: &str, place: &str, now: DateTime<Utc>) -> Decision {
        self.roll(now);
        match self.check(agent, cents) {
            Err(why) => Decision::Ask(why),
            Ok(_) => {
                let until = (now + Duration::minutes(WINDOW_MINUTES)).timestamp();
                self.ledger.windows.insert(
                    agent.to_string(),
                    Window { until, purpose: purpose.to_string(), place: place.to_string() },
                );
                Decision::Within { window_until: until }
            }
        }
    }

    /// True while the agent's cleared window is open.
    pub fn window_open(&self, agent: &str, now: DateTime<Utc>) -> bool {
        self.ledger.windows.get(agent).is_some_and(|w| now.timestamp() < w.until)
    }

    /// Books a spend. Needs an open window and still fits the limits.
    pub fn record_spend(&mut self, agent: &str, cents: i64, now: DateTime<Utc>) -> Result<()> {
        self.roll(now);
        if !self.window_open(agent, now) {
            bail!("no open purchase window for {agent}");
        }
        let cents = self.check(agent, cents).map_err(|e| anyhow!(e))?;
        self.ledger.spent_cents += cents;
        let w = self.ledger.windows.get(agent).cloned().unwrap();
        self.ledger.history.push(Spend { agent: agent.to_string(), cents, at: now.timestamp(), purpose: w.purpose, place: w.place });
        if self.ledger.history.len() > 200 {
            self.ledger.history.remove(0);
        }
        Ok(())
    }
}

impl Payments {
    /// Books a purchase a person approved by hand, over the limits or not, so it still counts toward the month.
    pub fn record_approved(&mut self, agent: &str, cents: i64, purpose: &str, place: &str, now: DateTime<Utc>) -> Result<()> {
        self.roll(now);
        if cents <= 0 {
            bail!("the amount must be above zero");
        }
        self.ledger.spent_cents = self.ledger.spent_cents.saturating_add(cents as u64);
        self.ledger.history.push(Spend { agent: agent.to_string(), cents: cents as u64, at: now.timestamp(), purpose: purpose.to_string(), place: place.to_string() });
        if self.ledger.history.len() > 200 {
            self.ledger.history.remove(0);
        }
        Ok(())
    }
}

/// Dollars and cents, the way the limits are written: `12.50`.
pub fn fmt(cents: u64) -> String {
    format!("{}.{:02}", cents / 100, cents % 100)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(y: i32, m: u32, d: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, 12, 0, 0).unwrap()
    }

    fn on() -> Payments {
        let mut p = Payments::default();
        p.limits.enabled = true;
        p.limits.agents.insert("bot".into());
        p
    }

    #[test]
    fn defaults_are_off_with_stated_limits() {
        let l = Limits::default();
        assert!(!l.enabled && l.agents.is_empty());
        assert_eq!((l.per_purchase_cents, l.per_month_cents), (6000, 20000));
    }

    #[test]
    fn disabled_always_asks() {
        let mut p = on();
        p.limits.enabled = false;
        assert!(matches!(p.request("bot", 100, "x", "y", t(2026, 1, 5)), Decision::Ask(_)));
    }

    #[test]
    fn unlisted_agent_asks() {
        let mut p = on();
        assert!(matches!(p.request("other", 100, "x", "y", t(2026, 1, 5)), Decision::Ask(_)));
    }

    #[test]
    fn within_opens_ten_minute_window() {
        let mut p = on();
        let now = t(2026, 1, 5);
        let Decision::Within { window_until } = p.request("bot", 1500, "domain", "namecheap", now) else { panic!() };
        assert_eq!(window_until, now.timestamp() + 600);
        assert!(p.window_open("bot", now + Duration::minutes(9)));
        assert!(!p.window_open("bot", now + Duration::minutes(10)));
        assert!(!p.window_open("nobody", now));
    }

    #[test]
    fn over_per_purchase_asks() {
        let mut p = on();
        assert!(matches!(p.request("bot", 6001, "x", "y", t(2026, 1, 5)), Decision::Ask(_)));
        assert!(matches!(p.request("bot", 6000, "x", "y", t(2026, 1, 5)), Decision::Within { .. }));
    }

    #[test]
    fn bad_amounts_are_rejected() {
        let mut p = on();
        for c in [0, -5, i64::MIN] {
            assert!(matches!(p.request("bot", c, "x", "y", t(2026, 1, 5)), Decision::Ask(_)), "{c}");
        }
        p.ledger.spent_cents = u64::MAX - 1;
        assert!(matches!(p.request("bot", 100, "x", "y", t(2026, 1, 5)), Decision::Ask(_)));
    }

    #[test]
    fn spend_needs_window_and_counts_toward_month() {
        let mut p = on();
        let now = t(2026, 1, 5);
        assert!(p.record_spend("bot", 100, now).is_err());
        p.request("bot", 6000, "x", "y", now);
        for _ in 0..3 {
            p.record_spend("bot", 6000, now).unwrap();
        }
        assert_eq!(p.spent_this_month(now), 18000);
        assert!(p.record_spend("bot", 6000, now).is_err());
        assert!(matches!(p.request("bot", 2001, "x", "y", now), Decision::Ask(_)));
        assert!(matches!(p.request("bot", 2000, "x", "y", now), Decision::Within { .. }));
    }

    #[test]
    fn spend_after_window_closed_fails() {
        let mut p = on();
        let now = t(2026, 1, 5);
        p.request("bot", 100, "x", "y", now);
        assert!(p.record_spend("bot", 100, now + Duration::minutes(11)).is_err());
    }

    #[test]
    fn month_rolls_over() {
        let mut p = on();
        let jan = t(2026, 1, 31);
        p.request("bot", 6000, "x", "y", jan);
        p.record_spend("bot", 6000, jan).unwrap();
        assert_eq!(p.spent_this_month(jan), 6000);
        assert_eq!(p.spent_this_month(t(2026, 2, 1)), 0);
        assert_eq!(p.spent_this_month(t(2027, 1, 1)), 0);
    }

    #[test]
    fn persists_and_tolerates_garbage() {
        let dir = std::env::temp_dir().join(format!("pay-{}", uuid::Uuid::new_v4()));
        let path = dir.join("p.json");
        let mut p = on();
        let now = t(2026, 1, 5);
        p.request("bot", 500, "x", "y", now);
        p.record_spend("bot", 500, now).unwrap();
        p.save(&path).unwrap();
        let mut q = Payments::load(&path);
        assert_eq!(q.spent_this_month(now), 500);
        assert!(q.limits.enabled);
        std::fs::write(&path, "{{{").unwrap();
        assert!(!Payments::load(&path).limits.enabled);
        assert!(!Payments::load(&dir.join("none.json")).limits.enabled);
    }

    #[test]
    fn a_hand_approved_purchase_counts_toward_the_month() {
        let mut p = on();
        let now = t(2026, 1, 5);
        p.record_approved("bot", 25000, "laptop stand", "shop", now).unwrap();
        assert_eq!(p.spent_this_month(now), 25000);
        assert!(matches!(p.request("bot", 100, "x", "y", now), Decision::Ask(_)), "the month is spent");
        assert!(p.record_approved("bot", 0, "x", "y", now).is_err());
    }

    #[test]
    fn parses_amounts() {
        assert_eq!(parse_amount_cents("12").unwrap(), 1200);
        assert_eq!(parse_amount_cents("12.5").unwrap(), 1250);
        assert_eq!(parse_amount_cents("0.07").unwrap(), 7);
        for bad in ["", "-1", "1.234", "abc", ".5", "1e3", "99999999999999999999"] {
            assert!(parse_amount_cents(bad).is_err(), "{bad}");
        }
    }
}
