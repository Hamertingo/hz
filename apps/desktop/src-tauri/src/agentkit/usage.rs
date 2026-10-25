//! Token counts to estimated cost, from a plain price table, summed per agent per day and month.

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

/// (pattern, input USD per million tokens, output USD per million tokens), first match wins.
/// A leading `^` means "starts with"; otherwise the pattern may sit anywhere in the lowercased
/// model name. Order matters: put the more specific names above the general ones.
pub const PRICES: &[(&str, f64, f64)] = &[
    ("claude-opus-4-5", 5.0, 25.0),
    ("claude-opus", 15.0, 75.0),
    ("claude-sonnet", 3.0, 15.0),
    ("claude-haiku-4-5", 1.0, 5.0),
    ("claude-haiku", 0.80, 4.0),
    ("gpt-5-nano", 0.05, 0.40),
    ("gpt-5-mini", 0.25, 2.0),
    ("gpt-5", 1.25, 10.0),
    ("gpt-4.1-mini", 0.40, 1.60),
    ("gpt-4.1", 2.0, 8.0),
    ("gpt-4o-mini", 0.15, 0.60),
    ("gpt-4o", 2.50, 10.0),
    ("^o4-mini", 1.10, 4.40),
    ("^o3", 2.0, 8.0),
    ("gemini-2.5-pro", 1.25, 10.0),
    ("gemini-2.5-flash-lite", 0.10, 0.40),
    ("gemini-2.5-flash", 0.30, 2.50),
    ("gemini-2.0-flash", 0.10, 0.40),
    ("grok-code-fast", 0.20, 1.50),
    ("grok-3-mini", 0.30, 0.50),
    ("grok-4", 3.0, 15.0),
    ("grok-3", 3.0, 15.0),
];

/// Looks up (input, output) USD per million tokens for a model name; `None` when unknown.
pub fn price_for(model: &str) -> Option<(f64, f64)> {
    let name = model.trim().to_lowercase();
    let name = name.rsplit('/').next().unwrap_or(&name);
    PRICES.iter().find_map(|&(pat, i, o)| {
        let hit = match pat.strip_prefix('^') {
            Some(p) => name.starts_with(p),
            None => name.contains(pat),
        };
        hit.then_some((i, o))
    })
}

/// Estimated cost in millionths of a dollar; `None` for an unknown model or on overflow.
pub fn cost_microusd(model: &str, input_tokens: u64, output_tokens: u64) -> Option<u64> {
    let (pi, po) = price_for(model)?;
    // One USD per million tokens is exactly one micro-dollar per token, so the table's price is the multiplier.
    let milli = |p: f64| (p * 1000.0).round() as u64;
    let a = input_tokens.checked_mul(milli(pi))?;
    let b = output_tokens.checked_mul(milli(po))?;
    a.checked_add(b).map(|v| v / 1000)
}

/// "$0.0012" under a cent, "$1.23" above; never scientific notation.
pub fn format_cost(micro: u64) -> String {
    let usd = micro as f64 / 1_000_000.0;
    if micro == 0 {
        "$0.00".into()
    } else if usd < 0.01 {
        format!("${usd:.4}")
    } else {
        format!("${usd:.2}")
    }
}

/// Running totals for one bucket.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Totals {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_micro: u64,
    /// Runs whose model had no price, so the cost above is a floor.
    pub unpriced_runs: u64,
}

impl Totals {
    fn add(&mut self, o: &Totals) {
        self.input_tokens = self.input_tokens.saturating_add(o.input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(o.output_tokens);
        self.cost_micro = self.cost_micro.saturating_add(o.cost_micro);
        self.unpriced_runs = self.unpriced_runs.saturating_add(o.unpriced_runs);
    }
}

/// Usage per agent per calendar day. Not serde: chrono's serde feature is off, so callers persist `Totals` per day themselves.
#[derive(Debug, Clone, Default)]
pub struct Usage {
    days: BTreeMap<String, BTreeMap<NaiveDate, Totals>>,
}

impl Usage {
    /// Adds one run's tokens to the agent's day and prices it.
    pub fn record(&mut self, agent: &str, day: NaiveDate, model: &str, input: u64, output: u64) {
        let cost = cost_microusd(model, input, output);
        let t = Totals {
            input_tokens: input,
            output_tokens: output,
            cost_micro: cost.unwrap_or(0),
            unpriced_runs: u64::from(cost.is_none()),
        };
        self.days.entry(agent.into()).or_default().entry(day).or_default().add(&t);
    }

    /// Totals for one agent on one day.
    pub fn day(&self, agent: &str, day: NaiveDate) -> Totals {
        self.days.get(agent).and_then(|d| d.get(&day)).copied().unwrap_or_default()
    }

    /// Totals for one agent over a calendar month.
    pub fn month(&self, agent: &str, year: i32, month: u32) -> Totals {
        let mut t = Totals::default();
        if let Some(d) = self.days.get(agent) {
            d.iter().filter(|(k, _)| k.year() == year && k.month() == month).for_each(|(_, v)| t.add(v));
        }
        t
    }

    /// Totals across every agent for a calendar month.
    pub fn month_all(&self, year: i32, month: u32) -> Totals {
        let mut t = Totals::default();
        for a in self.days.keys() {
            t.add(&self.month(a, year, month));
        }
        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, dd: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, dd).unwrap()
    }

    #[test]
    fn known_models_price() {
        assert_eq!(price_for("claude-sonnet-4-5-20250929"), Some((3.0, 15.0)));
        assert_eq!(price_for("Claude-Opus-4-5"), Some((5.0, 25.0)));
        assert_eq!(price_for("anthropic/claude-haiku-4-5"), Some((1.0, 5.0)));
    }

    #[test]
    fn specific_beats_general() {
        assert_eq!(price_for("gpt-5-mini").unwrap().0, 0.25);
        assert_eq!(price_for("gpt-5.1").unwrap().0, 1.25);
        assert_eq!(price_for("gemini-2.5-flash-lite").unwrap().0, 0.10);
    }

    #[test]
    fn prefix_pattern_avoids_false_hits() {
        assert!(price_for("o3").is_some());
        assert!(price_for("proto3-thing").is_none());
    }

    #[test]
    fn unknown_model_is_none() {
        assert_eq!(price_for("llama-9"), None);
        assert_eq!(cost_microusd("llama-9", 10, 10), None);
    }

    #[test]
    fn cost_math() {
        // 1M in at $3 + 1M out at $15 = $18 = 18_000_000 micro.
        assert_eq!(cost_microusd("claude-sonnet-4", 1_000_000, 1_000_000), Some(18_000_000));
        assert_eq!(cost_microusd("gpt-5-nano", 1000, 1000), Some(450));
        assert_eq!(cost_microusd("gpt-5", 0, 0), Some(0));
    }

    #[test]
    fn overflow_is_none() {
        assert_eq!(cost_microusd("claude-opus-4", u64::MAX, 0), None);
    }

    #[test]
    fn formats() {
        assert_eq!(format_cost(0), "$0.00");
        assert_eq!(format_cost(1_200), "$0.0012");
        assert_eq!(format_cost(1_234_567), "$1.23");
    }

    #[test]
    fn aggregates_per_day_and_month() {
        let mut u = Usage::default();
        u.record("leo", d(2026, 1, 5), "claude-sonnet-4", 1_000_000, 0);
        u.record("leo", d(2026, 1, 5), "claude-sonnet-4", 1_000_000, 0);
        u.record("leo", d(2026, 1, 20), "claude-sonnet-4", 0, 1_000_000);
        u.record("leo", d(2026, 2, 1), "claude-sonnet-4", 1, 1);
        assert_eq!(u.day("leo", d(2026, 1, 5)).cost_micro, 6_000_000);
        assert_eq!(u.month("leo", 2026, 1).cost_micro, 21_000_000);
        assert_eq!(u.month("leo", 2026, 2).input_tokens, 1);
        assert_eq!(u.day("nobody", d(2026, 1, 5)), Totals::default());
    }

    #[test]
    fn unpriced_runs_are_counted_not_costed() {
        let mut u = Usage::default();
        u.record("a", d(2026, 3, 1), "mystery", 500, 500);
        let t = u.day("a", d(2026, 3, 1));
        assert_eq!((t.cost_micro, t.unpriced_runs, t.input_tokens), (0, 1, 500));
    }

    #[test]
    fn month_all_sums_agents() {
        let mut u = Usage::default();
        u.record("a", d(2026, 3, 1), "gpt-5", 1_000_000, 0);
        u.record("b", d(2026, 3, 9), "gpt-5", 1_000_000, 0);
        assert_eq!(u.month_all(2026, 3).cost_micro, 2_500_000);
    }
}
