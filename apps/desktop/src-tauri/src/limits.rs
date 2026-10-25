//! How close each CLI is to its plan's limit, read from the CLI itself.
//!
//! **Real where the CLI will say, estimated where it will not, never zero.**
//! - Claude: the ACP adapter answers a prompt that is exactly `/usage` with the
//!   Agent SDK's `rate_limits` (5-hour, weekly, per-model), locally and for
//!   free. hz opens one private session, sends that, reads the Markdown and
//!   closes it.
//! - Codex: the app server's `account/rateLimits/read`.
//! - OpenCode: reports no plan limit at all, and says so.
//! - A CLI whose reading fails falls back to hz's own token counts against the
//!   plan the reader picked, and every such bar says `estimated`.
//!
//! A reading that cannot be had is an empty window list with the reason, which
//! the page draws as "unavailable". It is never drawn as 0%.

use std::{
    collections::HashMap,
    process::Stdio,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use chrono::{Datelike, FixedOffset, Local, NaiveDate, NaiveTime, TimeZone, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};
use ts_rs::TS;

use crate::{harness::Harness, proc::HideConsole as _};

/// One bar on the Usage page.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    /// `fiveHour`, `week`, `weekModel:<name>` or `window:<minutes>`.
    pub key: String,
    pub label: String,
    /// 0 to 100. `None` is "the CLI named the window and gave no number".
    pub used_pct: Option<f64>,
    pub resets_at_ms: Option<u64>,
    /// Sized from hz's own token counts, not read from the CLI.
    pub estimated: bool,
}

/// One CLI's windows and where they came from.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct CliLimits {
    /// The harness wire name: `claude-acp`, `codex-acp`, `opencode`.
    pub harness: String,
    pub installed: bool,
    pub plan: Option<String>,
    /// `claude-usage`, `codex-app-server`, `estimate` or `none`.
    pub source: String,
    pub windows: Vec<LimitWindow>,
    /// Why there is nothing to draw, or a caveat about what is drawn.
    pub note: Option<String>,
    pub read_at_ms: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// `max` becomes `Max`.
fn title_case(word: &str) -> String {
    let mut chars = word.chars();
    chars.next().map_or_else(String::new, |c| c.to_uppercase().collect::<String>() + chars.as_str())
}

// --- Claude -----------------------------------------------------------------

/// Offset of a zone name the way `Intl` prints it in English: `GMT-3`,
/// `GMT+5:30`, `UTC`, or a US abbreviation. `None` for anything else.
fn zone_offset(name: &str) -> Option<FixedOffset> {
    let secs = |h: i32, m: i32| FixedOffset::east_opt(h * 3600 + h.signum() * m * 60);
    match name {
        "UTC" | "GMT" => return FixedOffset::east_opt(0),
        "PST" => return secs(-8, 0),
        "PDT" | "MST" => return secs(-7, 0),
        "MDT" | "CST" => return secs(-6, 0),
        "CDT" | "EST" => return secs(-5, 0),
        "EDT" => return secs(-4, 0),
        _ => {}
    }
    let rest = name.strip_prefix("GMT").or_else(|| name.strip_prefix("UTC"))?;
    let sign = match rest.chars().next()? {
        '+' => 1,
        '-' | '\u{2212}' => -1,
        _ => return None,
    };
    let body = &rest[rest.chars().next()?.len_utf8()..];
    let (h, m) = body.split_once(':').unwrap_or((body, "0"));
    secs(sign * h.parse::<i32>().ok()?, m.parse::<i32>().ok()?)
}

/// `Oct 23, 12:30 PM GMT-3` as epoch milliseconds. The text carries no year, so
/// it is the current one, or the next when that would put the reset more than a
/// day in the past.
fn parse_reset(text: &str, now_ms: u64) -> Option<u64> {
    let (date, time) = text.split_once(", ")?;
    let (month, day) = date.split_once(' ')?;
    let month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        .iter()
        .position(|m| *m == month)? as u32
        + 1;
    let day: u32 = day.trim().parse().ok()?;

    let mut parts = time.split_whitespace();
    let (hh, mm) = parts.next()?.split_once(':')?;
    let (mut hour, minute): (u32, u32) = (hh.parse().ok()?, mm.parse().ok()?);
    let meridiem = parts.next()?;
    hour %= 12;
    if meridiem.eq_ignore_ascii_case("PM") {
        hour += 12;
    }
    let zone = parts.next().and_then(zone_offset);

    let now = Utc.timestamp_millis_opt(now_ms as i64).single()?;
    let build = |year: i32| {
        let naive = NaiveDate::from_ymd_opt(year, month, day)?.and_time(NaiveTime::from_hms_opt(hour, minute, 0)?);
        let at = match zone {
            Some(z) => z.from_local_datetime(&naive).single()?.timestamp_millis(),
            None => Local.from_local_datetime(&naive).single()?.timestamp_millis(),
        };
        Some(at)
    };
    let this = build(now.year())?;
    let at = if (this as i128) < now_ms as i128 - 86_400_000 { build(now.year() + 1)? } else { this };
    Some(at.max(0) as u64)
}

/// A limit's label as the adapter writes it, turned into the page's key and words.
fn claude_window(label: &str) -> (String, String) {
    match label.trim() {
        "5-hour limit" => ("fiveHour".into(), "5-hour window".into()),
        "Weekly \u{b7} all models" => ("week".into(), "This week".into()),
        other => {
            let model = other.strip_prefix("Weekly \u{b7} ").unwrap_or(other).trim();
            (format!("weekModel:{model}"), format!("{model} this week"))
        }
    }
}

/// The plan and windows in the adapter's `/usage` Markdown.
///
/// Only the text above the first rule is read: below it come this session's
/// cost and "what's using your limits", none of which is a window. A line that
/// does not match the `**label** — **N%** · Resets …` shape is skipped rather
/// than failing the rest.
pub fn parse_claude_usage(markdown: &str, now_ms: u64) -> (Option<String>, Vec<LimitWindow>) {
    let mut plan = None;
    let mut windows = Vec::new();

    for line in markdown.lines() {
        let line = line.trim();
        if line == "---" {
            break;
        }
        if let Some(rest) = line.strip_prefix("> Claude ") {
            plan = rest.split_once(" subscription").map(|(p, _)| title_case(p.trim()));
            continue;
        }
        let Some(rest) = line.strip_prefix("**") else { continue };
        let Some((label, rest)) = rest.split_once("**") else { continue };
        let Some(rest) = rest.trim_start().strip_prefix('\u{2014}') else { continue };
        let Some(rest) = rest.trim_start().strip_prefix("**") else { continue };
        let Some((pct, rest)) = rest.split_once("%**") else { continue };
        let Ok(pct) = pct.trim().parse::<f64>() else { continue };

        let resets_at_ms = rest.split_once("Resets ").and_then(|(_, r)| parse_reset(r.trim(), now_ms));
        let (key, label) = claude_window(label);
        windows.push(LimitWindow { key, label, used_pct: Some(pct.clamp(0.0, 100.0)), resets_at_ms, estimated: false });
    }
    (plan, windows)
}

// --- Codex ------------------------------------------------------------------

/// The windows in a Codex `account/rateLimits/read` result.
///
/// The two buckets are named by length, not by name: 300 minutes is the
/// 5-hour window and 10080 the week, and any other length is drawn as what it
/// is rather than guessed at.
pub fn parse_codex_limits(result: &Value) -> (Option<String>, Vec<LimitWindow>) {
    let limits = &result["rateLimits"];
    let plan = limits["planType"].as_str().map(title_case);
    let mut windows = Vec::new();

    for bucket in ["primary", "secondary"] {
        let b = &limits[bucket];
        let (Some(pct), Some(mins)) = (b["usedPercent"].as_f64(), b["windowDurationMins"].as_u64()) else { continue };
        let (key, label) = match mins {
            300 => ("fiveHour".to_string(), "5-hour window".to_string()),
            10080 => ("week".to_string(), "This week".to_string()),
            m if m % 60 == 0 => (format!("window:{m}"), format!("{}-hour window", m / 60)),
            m => (format!("window:{m}"), format!("{m}-minute window")),
        };
        windows.push(LimitWindow {
            key,
            label,
            used_pct: Some(pct.clamp(0.0, 100.0)),
            resets_at_ms: b["resetsAt"].as_u64().map(|s| s * 1000),
            estimated: false,
        });
    }
    (plan, windows)
}

// --- Estimates --------------------------------------------------------------

/// What hz assumes a plan allows in a window, in tokens. **Assumptions, not
/// published numbers**: the vendors state no token figures, so these are sized
/// from observed use and exist only to put an `estimated` bar where the CLI gave
/// nothing. The page labels every bar built from them.
pub fn plan_allowance(harness: &str, plan: &str) -> Option<(u64, u64)> {
    let m = 1_000_000u64;
    match (harness, plan.to_ascii_lowercase().as_str()) {
        ("claude-acp", "pro") => Some((4 * m, 40 * m)),
        ("claude-acp", "max") => Some((20 * m, 200 * m)),
        ("codex-acp", "plus") => Some((6 * m, 60 * m)),
        ("codex-acp", "pro") => Some((30 * m, 300 * m)),
        _ => None,
    }
}

/// Estimated windows from tokens counted in the last 5 hours and the last 7 days.
pub fn estimate_windows(harness: &str, plan: &str, tokens_5h: u64, tokens_7d: u64) -> Vec<LimitWindow> {
    let Some((five, week)) = plan_allowance(harness, plan) else { return Vec::new() };
    let pct = |used: u64, cap: u64| ((used as f64 / cap as f64) * 100.0).clamp(0.0, 100.0).round();
    vec![
        LimitWindow { key: "fiveHour".into(), label: "5-hour window".into(), used_pct: Some(pct(tokens_5h, five)), resets_at_ms: None, estimated: true },
        LimitWindow { key: "week".into(), label: "This week".into(), used_pct: Some(pct(tokens_7d, week)), resets_at_ms: None, estimated: true },
    ]
}

// --- Readers ----------------------------------------------------------------

/// A line-delimited JSON-RPC peer on a child's stdio, for a one-shot probe.
struct Peer {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    lines: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    next: u64,
}

impl Peer {
    fn start(command: Command) -> Result<Self> {
        let mut child = command
            .hide_console()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .context("could not start the CLI")?;
        let stdin = child.stdin.take().context("no stdin")?;
        let stdout = child.stdout.take().context("no stdout")?;
        Ok(Self { child, stdin, lines: BufReader::new(stdout).lines(), next: 0 })
    }

    async fn send(&mut self, value: Value) -> Result<()> {
        self.stdin.write_all(format!("{value}\n").as_bytes()).await?;
        Ok(())
    }

    /// Sends a request and reads until its response, handing every notification
    /// that arrives meanwhile to `on_note`.
    async fn call(&mut self, method: &str, params: Value, mut on_note: impl FnMut(&Value)) -> Result<Value> {
        self.next += 1;
        let id = self.next;
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})).await?;
        while let Some(line) = self.lines.next_line().await? {
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if v["id"].as_u64() == Some(id) && v.get("method").is_none() {
                if let Some(err) = v.get("error") {
                    bail!("{method}: {}", err["message"].as_str().unwrap_or("failed"));
                }
                return Ok(v["result"].clone());
            }
            if v.get("method").is_some() && v.get("id").is_none() {
                on_note(&v);
            }
        }
        bail!("the CLI closed before answering {method}")
    }

    async fn close(mut self) {
        drop(self.stdin);
        let _ = tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await;
    }
}

/// Reads Claude's windows by asking the ACP adapter for `/usage` in a throwaway
/// session. The adapter must already be installed: a usage read is not a reason
/// to start a 300 MB `npm install`.
async fn read_claude() -> Result<(Option<String>, Vec<LimitWindow>)> {
    use crate::harness::mcode::dialect;

    let entry = dialect::adapter_entry_if_installed(Harness::Claude)
        .await
        .context("Claude's adapter isn't set up yet; start a Claude agent once")?;
    let node = crate::binpath::node().await;
    anyhow::ensure!(node.is_absolute(), "Node.js is needed to read Claude's usage");
    let home = std::env::home_dir().context("no home directory")?;

    let mut command = Command::new(node);
    command
        .arg(entry)
        .current_dir(&home)
        .env("PATH", crate::binpath::child_path(crate::binpath::resolved_bin_dirs()));
    let mut peer = Peer::start(command)?;

    peer.call("initialize", json!({"protocolVersion": 1, "clientCapabilities": {}}), |_| {}).await?;
    let session = peer
        .call("session/new", json!({"cwd": home.to_string_lossy(), "mcpServers": []}), |_| {})
        .await?;
    let session_id = session["sessionId"].as_str().context("no session id")?.to_string();

    let mut text = String::new();
    peer.call(
        "session/prompt",
        json!({"sessionId": session_id, "prompt": [{"type": "text", "text": "/usage"}]}),
        |note| {
            let update = &note["params"]["update"];
            if note["method"] == "session/update" && update["sessionUpdate"] == "agent_message_chunk" {
                text.push_str(update["content"]["text"].as_str().unwrap_or_default());
            }
        },
    )
    .await?;
    peer.close().await;

    let (plan, windows) = parse_claude_usage(&text, now_ms());
    anyhow::ensure!(!windows.is_empty(), "Claude reported no plan limits (an API key has none)");
    Ok((plan, windows))
}

/// Reads Codex's windows from its app server.
async fn read_codex() -> Result<(Option<String>, Vec<LimitWindow>)> {
    let bin = crate::binpath::agent_binary(Harness::Codex).await;
    anyhow::ensure!(bin.is_absolute(), "Codex isn't installed");
    let mut command = Command::new(bin);
    command
        .arg("app-server")
        .env("PATH", crate::binpath::child_path(crate::binpath::resolved_bin_dirs()));
    let mut peer = Peer::start(command)?;

    peer.call("initialize", json!({"clientInfo": {"name": "hz", "title": "hz", "version": env!("CARGO_PKG_VERSION")}}), |_| {})
        .await?;
    peer.send(json!({"jsonrpc": "2.0", "method": "initialized"})).await?;
    let result = peer.call("account/rateLimits/read", json!(null), |_| {}).await?;
    peer.close().await;

    let (plan, windows) = parse_codex_limits(&result);
    anyhow::ensure!(!windows.is_empty(), "Codex reported no plan limits");
    Ok((plan, windows))
}

const TTL: Duration = Duration::from_secs(300);
const READ_TIMEOUT: Duration = Duration::from_secs(25);

static CACHE: LazyLock<Mutex<HashMap<String, (Instant, CliLimits)>>> = LazyLock::new(Default::default);

fn cached(harness: &str) -> Option<CliLimits> {
    let cache = CACHE.lock().expect("limits cache poisoned");
    cache.get(harness).filter(|(at, _)| at.elapsed() < TTL).map(|(_, l)| l.clone())
}

/// The soonest reset in a cached reading, which is when a limit-blocked agent
/// can be tried again. `None` when nothing is cached or nothing says.
pub fn next_reset_ms(harness: &str) -> Option<u64> {
    let cache = CACHE.lock().expect("limits cache poisoned");
    let now = now_ms();
    cache
        .get(harness)?
        .1
        .windows
        .iter()
        .filter(|w| w.used_pct.is_some_and(|p| p >= 99.0))
        .filter_map(|w| w.resets_at_ms)
        .filter(|at| *at > now)
        .min()
}

/// Reads one CLI's limits under a timeout, falling back to an estimate and then
/// to an honest "unavailable".
async fn read_one(harness: Harness, plans: &std::collections::BTreeMap<String, String>, tokens: (u64, u64)) -> CliLimits {
    let wire = harness.wire_name();
    let installed = crate::binpath::agent_installed(harness).await;
    let mut out = CliLimits {
        harness: wire.clone(),
        installed,
        plan: plans.get(&wire).cloned(),
        source: "none".into(),
        windows: Vec::new(),
        note: None,
        read_at_ms: now_ms(),
    };
    if !installed {
        out.note = Some("Not installed".into());
        return out;
    }

    let read = match harness {
        Harness::Claude => tokio::time::timeout(READ_TIMEOUT, read_claude()).await,
        Harness::Codex => tokio::time::timeout(READ_TIMEOUT, read_codex()).await,
        _ => {
            out.note = Some("No limit reported".into());
            return out;
        }
    };
    let source = if harness == Harness::Claude { "claude-usage" } else { "codex-app-server" };

    match read {
        Ok(Ok((plan, windows))) => {
            out.plan = plan.or(out.plan);
            out.source = source.into();
            out.windows = windows;
        }
        Ok(Err(e)) => fall_back(&mut out, plans, tokens, format!("{e:#}")),
        Err(_) => fall_back(&mut out, plans, tokens, "The CLI took too long to answer".into()),
    }
    out
}

/// Puts an estimate in place of a reading that failed, or says there is none.
fn fall_back(out: &mut CliLimits, plans: &std::collections::BTreeMap<String, String>, tokens: (u64, u64), why: String) {
    let plan = plans.get(&out.harness).cloned().or_else(|| out.plan.clone());
    let windows = plan.as_deref().map_or_else(Vec::new, |p| estimate_windows(&out.harness, p, tokens.0, tokens.1));
    if windows.is_empty() {
        out.note = Some(format!("Unavailable: {why}"));
    } else {
        out.source = "estimate".into();
        out.windows = windows;
        out.note = Some(format!("Estimated from hz's own counts. {why}"));
    }
    out.plan = plan;
}

/// Every CLI's limits, or just `harness`'s when one is named (the page asks per
/// card so each fills as its own read lands). Cached for five minutes; `refresh`
/// reads again. The reads run side by side, each under its own timeout, so a
/// stuck CLI costs its own row and nothing else.
#[tauri::command]
pub async fn plan_limits(
    workspace_id: Option<String>,
    refresh: bool,
    harness: Option<String>,
) -> Result<Vec<CliLimits>, String> {
    let defaults = match workspace_id.as_deref() {
        Some(id) => crate::workspaces::defaults_of(id),
        None => crate::workspaces::first_defaults(),
    };
    let tokens = crate::spend::window_tokens().await;

    let wanted = [Harness::Claude, Harness::Codex, Harness::OpenCode]
        .into_iter()
        .filter(|h| harness.as_deref().is_none_or(|w| w == h.wire_name()));
    let reads = wanted.map(|h| {
        let plans = defaults.plans.clone();
        let t = tokens.get(&h.wire_name()).copied().unwrap_or((0, 0));
        async move {
            let wire = h.wire_name();
            if !refresh {
                if let Some(hit) = cached(&wire) {
                    return hit;
                }
            }
            let fresh = read_one(h, &plans, t).await;
            CACHE.lock().expect("limits cache poisoned").insert(wire, (Instant::now(), fresh.clone()));
            fresh
        }
    });
    Ok(futures_util::future::join_all(reads).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What the adapter returned for `/usage` on a Max account, captured from
    /// `claude-agent-acp` 0.94.0 on 2026-10-23.
    const CLAUDE_USAGE: &str = include_str!("fixtures/claude_usage.md");

    /// `account/rateLimits/read` from `codex app-server` 0.163.0 on a Plus
    /// account, account ids removed.
    const CODEX_LIMITS: &str = include_str!("fixtures/codex_rate_limits.json");

    fn at(y: i32, m: u32, d: u32, h: u32) -> u64 {
        Utc.with_ymd_and_hms(y, m, d, h, 0, 0).unwrap().timestamp_millis() as u64
    }

    /// Reads the real thing on a machine that has the CLIs. Not run by default:
    /// `cargo test live_ -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "talks to the installed Claude and Codex"]
    async fn live_claude_and_codex_report_windows() {
        let claude = read_claude().await;
        eprintln!("claude: {claude:?}");
        let codex = read_codex().await;
        eprintln!("codex: {codex:?}");
        assert!(claude.is_ok() || codex.is_ok(), "neither CLI answered");
    }

    #[test]
    fn the_claude_capture_yields_the_plan_and_three_windows() {
        let now = at(2026, 10, 23, 14);
        let (plan, windows) = parse_claude_usage(CLAUDE_USAGE, now);

        assert_eq!(plan.as_deref(), Some("Max"));
        assert_eq!(windows.len(), 3);
        assert_eq!((windows[0].key.as_str(), windows[0].used_pct), ("fiveHour", Some(16.0)));
        assert_eq!((windows[1].key.as_str(), windows[1].used_pct), ("week", Some(61.0)));
        assert_eq!(windows[2].key, "weekModel:Fable");
        assert_eq!(windows[2].label, "Fable this week");
        assert!(windows.iter().all(|w| !w.estimated && w.resets_at_ms.is_some()));
        // "Oct 23, 12:30 PM GMT-3" is 15:30 UTC.
        assert_eq!(windows[0].resets_at_ms, Some(at(2026, 10, 23, 15) + 30 * 60_000));
    }

    #[test]
    fn the_session_and_behaviour_sections_are_not_windows() {
        let (_, windows) = parse_claude_usage(CLAUDE_USAGE, at(2026, 10, 23, 14));
        assert!(windows.iter().all(|w| w.key != "weekModel:Last 24h"));
    }

    #[test]
    fn markdown_with_no_limits_reads_as_none() {
        let (plan, windows) = parse_claude_usage("## Usage\n\n### This session\n\n---\n", 0);
        assert!(plan.is_none() && windows.is_empty());
    }

    #[test]
    fn a_reset_in_the_new_year_rolls_forward() {
        let dec = at(2026, 12, 31, 12);
        let reset = parse_reset("Jan 2, 3:00 AM UTC", dec).unwrap();
        assert_eq!(reset, at(2027, 1, 2, 3));
        // A reset an hour ago is this year's, not next year's.
        assert_eq!(parse_reset("Dec 31, 11:00 AM UTC", dec), Some(at(2026, 12, 31, 11)));
    }

    #[test]
    fn zone_names_are_read_the_way_intl_prints_them() {
        assert_eq!(zone_offset("GMT-3").unwrap().local_minus_utc(), -3 * 3600);
        assert_eq!(zone_offset("GMT+5:30").unwrap().local_minus_utc(), 5 * 3600 + 1800);
        assert_eq!(zone_offset("PDT").unwrap().local_minus_utc(), -7 * 3600);
        assert!(zone_offset("CEST").is_none());
    }

    #[test]
    fn the_codex_capture_yields_five_hours_and_a_week() {
        let result: Value = serde_json::from_str(CODEX_LIMITS).unwrap();
        let (plan, windows) = parse_codex_limits(&result);

        assert_eq!(plan.as_deref(), Some("Plus"));
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].key, "fiveHour");
        assert_eq!(windows[0].resets_at_ms, Some(1_792_772_540_000));
        assert_eq!(windows[1].key, "week");
        assert_eq!(windows[1].used_pct, Some(0.0), "a real zero is drawn as a real zero");
    }

    #[test]
    fn an_odd_codex_window_is_drawn_as_what_it_is() {
        let result = json!({"rateLimits": {"primary": {"usedPercent": 40, "windowDurationMins": 60, "resetsAt": 1}}});
        let (_, windows) = parse_codex_limits(&result);
        assert_eq!(windows[0].label, "1-hour window");
        assert!(parse_codex_limits(&json!({})).1.is_empty());
    }

    #[test]
    fn estimates_are_labelled_and_a_missing_plan_gives_none() {
        let w = estimate_windows("claude-acp", "Max", 10_000_000, 50_000_000);
        assert!(w.iter().all(|w| w.estimated));
        assert_eq!(w[0].used_pct, Some(50.0));
        assert_eq!(w[1].used_pct, Some(25.0));
        assert!(estimate_windows("claude-acp", "Enterprise", 1, 1).is_empty());
        assert!(estimate_windows("opencode", "Max", 1, 1).is_empty());
    }

    #[test]
    fn a_failed_read_with_no_plan_is_unavailable_and_never_zero() {
        let mut out = CliLimits {
            harness: "claude-acp".into(),
            installed: true,
            plan: None,
            source: "none".into(),
            windows: Vec::new(),
            note: None,
            read_at_ms: 0,
        };
        fall_back(&mut out, &Default::default(), (5, 5), "timed out".into());
        assert!(out.windows.is_empty());
        assert_eq!(out.note.as_deref(), Some("Unavailable: timed out"));

        let plans = [("claude-acp".to_string(), "Pro".to_string())].into();
        fall_back(&mut out, &plans, (2_000_000, 0), "timed out".into());
        assert_eq!(out.source, "estimate");
        assert_eq!(out.windows[0].used_pct, Some(50.0));
    }
}
