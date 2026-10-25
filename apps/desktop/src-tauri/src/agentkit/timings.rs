//! Per-turn timings: where a run spent its time, one summary line, and a ring file of recent runs.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// How many lines the ring file keeps.
pub const RING_KEEP: usize = 500;

#[derive(Debug, Clone)]
struct Span {
    label: String,
    start: u64,
    end: Option<u64>,
}

/// Spans and marks for one turn. Times are milliseconds on the caller's own clock.
#[derive(Debug, Clone, Default)]
pub struct RunTimings {
    turn_start: Option<u64>,
    turn_end: Option<u64>,
    first_output: Option<u64>,
    spans: Vec<Span>,
}

/// The serialised form of a finished run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Report {
    pub turn_ms: u64,
    pub wake_ms: u64,
    pub screen_ms: u64,
    pub first_output_ms: Option<u64>,
    pub tool_ms: u64,
    pub model_ms: u64,
    pub tools: BTreeMap<String, u64>,
}

impl RunTimings {
    /// A fresh, empty set of timings.
    pub fn new() -> Self {
        Self::default()
    }

    /// Marks the turn start.
    pub fn begin_turn(&mut self, now: u64) {
        self.turn_start = Some(now);
    }

    /// Marks the turn end.
    pub fn end_turn(&mut self, now: u64) {
        self.turn_end = Some(now);
    }

    /// Opens a span; labels are `wake`, `screen` or `tool:<name>`.
    pub fn start(&mut self, label: &str, now: u64) {
        self.spans.push(Span { label: label.to_string(), start: now, end: None });
    }

    /// Closes the oldest open span with this label; false when none is open.
    pub fn end(&mut self, label: &str, now: u64) -> bool {
        match self.spans.iter_mut().find(|s| s.label == label && s.end.is_none()) {
            Some(s) => {
                s.end = Some(now.max(s.start));
                true
            }
            None => false,
        }
    }

    /// Records the first visible output of the turn; later calls are ignored.
    pub fn mark_first_output(&mut self, now: u64) {
        self.first_output.get_or_insert(now);
    }

    fn sum(&self, pred: impl Fn(&str) -> bool) -> u64 {
        self.spans.iter().filter(|s| pred(&s.label)).filter_map(|s| s.end.map(|e| e - s.start)).sum()
    }

    /// Wall time covered by tool spans, counting overlapping parallel tools once.
    fn tool_union(&self) -> u64 {
        let mut iv: Vec<(u64, u64)> = self
            .spans
            .iter()
            .filter(|s| s.label.starts_with("tool:"))
            .filter_map(|s| s.end.map(|e| (s.start, e)))
            .collect();
        iv.sort();
        let mut total = 0;
        let mut cur: Option<(u64, u64)> = None;
        for (s, e) in iv {
            match cur {
                Some((cs, ce)) if s <= ce => cur = Some((cs, ce.max(e))),
                Some((cs, ce)) => {
                    total += ce - cs;
                    cur = Some((s, e));
                }
                None => cur = Some((s, e)),
            }
        }
        if let Some((cs, ce)) = cur {
            total += ce - cs;
        }
        total
    }

    /// Everything measured so far as plain numbers; the model share is the turn minus tool time.
    pub fn report(&self) -> Report {
        let turn_ms = match (self.turn_start, self.turn_end) {
            (Some(s), Some(e)) => e.saturating_sub(s),
            _ => 0,
        };
        let mut tools: BTreeMap<String, u64> = BTreeMap::new();
        for s in &self.spans {
            if let (Some(name), Some(e)) = (s.label.strip_prefix("tool:"), s.end) {
                *tools.entry(name.to_string()).or_default() += e - s.start;
            }
        }
        let tool_ms = self.tool_union();
        Report {
            turn_ms,
            wake_ms: self.sum(|l| l == "wake"),
            screen_ms: self.sum(|l| l == "screen"),
            first_output_ms: match (self.turn_start, self.first_output) {
                (Some(s), Some(f)) => Some(f.saturating_sub(s)),
                _ => None,
            },
            tool_ms,
            model_ms: turn_ms.saturating_sub(tool_ms),
            tools,
        }
    }

    /// One human line, e.g. `turn 12.3s | wake 0.4s | tools 4.0s (bash 3.0s) | model 7.9s`.
    pub fn summary_line(&self) -> String {
        let r = self.report();
        let mut parts = vec![format!("turn {}", secs(r.turn_ms))];
        if r.wake_ms > 0 {
            parts.push(format!("wake {}", secs(r.wake_ms)));
        }
        if r.screen_ms > 0 {
            parts.push(format!("screen {}", secs(r.screen_ms)));
        }
        if let Some(f) = r.first_output_ms {
            parts.push(format!("first output {}", secs(f)));
        }
        if r.tool_ms > 0 {
            let each: Vec<String> = r.tools.iter().map(|(n, ms)| format!("{n} {}", secs(*ms))).collect();
            parts.push(format!("tools {} ({})", secs(r.tool_ms), each.join(", ")));
        }
        parts.push(format!("model {}", secs(r.model_ms)));
        parts.join(" | ")
    }

    /// The report as one JSON line, no newline inside.
    pub fn to_json_line(&self) -> String {
        serde_json::to_string(&self.report()).unwrap_or_default()
    }
}

fn secs(ms: u64) -> String {
    format!("{}.{}s", ms / 1000, (ms % 1000) / 100)
}

/// Appends a line and keeps only the newest `keep` lines, writing atomically.
pub fn append_ring(path: &Path, line: &str, keep: usize) -> Result<()> {
    let line = line.replace(['\n', '\r'], " ");
    if line.trim().is_empty() {
        return Ok(());
    }
    let mut lines: Vec<String> = std::fs::read_to_string(path)
        .map(|t| t.lines().filter(|l| !l.is_empty()).map(String::from).collect())
        .unwrap_or_default();
    lines.push(line);
    if lines.len() > keep {
        lines.drain(..lines.len() - keep);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, lines.join("\n") + "\n")?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// The newest `n` lines, oldest first; empty when the file is missing.
pub fn recent(path: &Path, n: usize) -> Vec<String> {
    let lines: Vec<String> = std::fs::read_to_string(path)
        .map(|t| t.lines().filter(|l| !l.is_empty()).map(String::from).collect())
        .unwrap_or_default();
    let skip = lines.len().saturating_sub(n);
    lines.into_iter().skip(skip).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("tim-{}", uuid::Uuid::new_v4())).join("t.jsonl")
    }

    fn sample() -> RunTimings {
        let mut t = RunTimings::new();
        t.begin_turn(1000);
        t.start("wake", 1000);
        t.end("wake", 1400);
        t.start("screen", 1400);
        t.end("screen", 2500);
        t.mark_first_output(3100);
        t.start("tool:bash", 4000);
        t.end("tool:bash", 7000);
        t.start("tool:read", 7000);
        t.end("tool:read", 8000);
        t.end_turn(13300);
        t
    }

    #[test]
    fn spans_and_model_share() {
        let r = sample().report();
        assert_eq!(r.turn_ms, 12300);
        assert_eq!((r.wake_ms, r.screen_ms), (400, 1100));
        assert_eq!(r.first_output_ms, Some(2100));
        assert_eq!(r.tool_ms, 4000);
        assert_eq!(r.model_ms, 8300);
        assert_eq!(r.tools["bash"], 3000);
    }

    #[test]
    fn parallel_tools_count_once() {
        let mut t = RunTimings::new();
        t.begin_turn(0);
        t.start("tool:a", 0);
        t.start("tool:b", 1000);
        t.end("tool:a", 3000);
        t.end("tool:b", 2000);
        t.end_turn(5000);
        let r = t.report();
        assert_eq!(r.tool_ms, 3000);
        assert_eq!(r.model_ms, 2000);
        assert_eq!(r.tools["a"] + r.tools["b"], 4000);
    }

    #[test]
    fn unclosed_span_and_unknown_end_are_harmless() {
        let mut t = RunTimings::new();
        t.begin_turn(0);
        t.start("tool:x", 100);
        assert!(!t.end("tool:y", 200));
        t.end_turn(1000);
        assert_eq!(t.report().tool_ms, 0);
        assert_eq!(t.report().model_ms, 1000);
    }

    #[test]
    fn model_never_underflows() {
        let mut t = RunTimings::new();
        t.begin_turn(0);
        t.start("tool:x", 0);
        t.end("tool:x", 900);
        t.end_turn(500);
        assert_eq!(t.report().model_ms, 0);
    }

    #[test]
    fn first_output_keeps_the_first_mark() {
        let mut t = RunTimings::new();
        t.begin_turn(0);
        t.mark_first_output(10);
        t.mark_first_output(99);
        t.end_turn(100);
        assert_eq!(t.report().first_output_ms, Some(10));
    }

    #[test]
    fn summary_line_reads_well() {
        let l = sample().summary_line();
        assert!(l.starts_with("turn 12.3s"));
        assert!(l.contains("wake 0.4s") && l.contains("tools 4.0s (bash 3.0s, read 1.0s)"));
        assert!(l.ends_with("model 8.3s"));
    }

    #[test]
    fn json_line_round_trips() {
        let t = sample();
        let line = t.to_json_line();
        assert!(!line.contains('\n'));
        assert_eq!(serde_json::from_str::<Report>(&line).unwrap(), t.report());
    }

    #[test]
    fn ring_keeps_newest() {
        let p = tmp();
        for i in 0..10 {
            append_ring(&p, &format!("l{i}"), 4).unwrap();
        }
        assert_eq!(recent(&p, 100), vec!["l6", "l7", "l8", "l9"]);
        assert_eq!(recent(&p, 2), vec!["l8", "l9"]);
    }

    #[test]
    fn ring_flattens_newlines_and_skips_blank() {
        let p = tmp();
        append_ring(&p, "a\nb", 5).unwrap();
        append_ring(&p, "   ", 5).unwrap();
        assert_eq!(recent(&p, 5), vec!["a b"]);
    }

    #[test]
    fn recent_on_missing_file_is_empty() {
        assert!(recent(&tmp(), 5).is_empty());
    }

    #[test]
    fn default_ring_size_is_500() {
        let p = tmp();
        for i in 0..520 {
            append_ring(&p, &i.to_string(), RING_KEEP).unwrap();
        }
        let all = recent(&p, 1000);
        assert_eq!(all.len(), 500);
        assert_eq!(all[0], "20");
    }
}
