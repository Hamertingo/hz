//! What an agent has done, read off its session log: when it spoke, which turns
//! finished and how long they took, what it cost, and the feed of things worth
//! opening again (files, pull requests, exchanges with teammates, notes).
//!
//! The log is the only record, so everything here is derived on request and
//! nothing is stored. Days and months are bucketed by the webview in the
//! reader's own time zone; this side hands over timestamps.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::{
    agents,
    budget::{month_key, SpendCounter},
    store,
};

/// A turn that finished: when, for how long, and whether it ended well.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct TaskRun {
    pub end_ms: u64,
    pub secs: u32,
    pub ok: bool,
}

/// Dollars spent in one calendar month.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct MonthSpend {
    pub month: String,
    pub usd: f64,
}

/// One finished turn as a billing line: what it added to the session's running
/// totals. The Usage page sums these into windows and exports them as CSV.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct CallStep {
    pub at_ms: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

/// A turn that has started and not yet finished.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct OpenTurn {
    pub since_ms: u64,
    /// `you`, or the name of the teammate who asked.
    pub by: String,
}

/// One row of the activity feed. Which fields are set depends on `kind`: a `file`
/// has a `path`, a `pr` a `url`, `number` and `repo`, a team row a `peer`, `ask`
/// and maybe an `answer`, a `note` the note's file name.
#[derive(Clone, Debug, Default, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct FeedItem {
    /// `chat`, `file`, `team` or `routine`: the filter the row falls under.
    pub group: String,
    /// `answer`, `file`, `image` (a shared screenshot, with its `path`), `pr`, `team_ask`, `team_message`, `team_in`, `note`.
    pub kind: String,
    pub title: String,
    pub sub: String,
    pub at_ms: u64,
    pub seq: u64,
    pub path: Option<String>,
    pub url: Option<String>,
    pub number: Option<u32>,
    pub repo: Option<String>,
    pub peer: Option<String>,
    pub ask: Option<String>,
    pub answer: Option<String>,
    pub note: Option<String>,
}

/// Everything the profile page draws from the log.
#[derive(Clone, Debug, Default, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ActivityScan {
    /// When each message was sent, by the reader, a teammate or the agent.
    pub messages: Vec<u64>,
    pub tasks: Vec<TaskRun>,
    /// Newest first, capped.
    pub feed: Vec<FeedItem>,
    pub spend: Vec<MonthSpend>,
    /// Every finished turn with what it cost, oldest first.
    pub calls: Vec<CallStep>,
    pub last_total: f64,
    pub open: Option<OpenTurn>,
}

/// Rows kept in the feed. More is scrolling nobody does.
const FEED_CAP: usize = 400;
/// A turn longer than this is a process that was left open, not work.
const MAX_TURN_SECS: u64 = 6 * 3600;

const INTRO_MARK: &str = "<hz-intro/>";

fn ms_of(ts: &str) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(ts).ok().map(|d| d.timestamp_millis().max(0) as u64)
}

fn one_line(text: &str, max: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        flat
    } else {
        format!("{}…", flat.chars().take(max).collect::<String>().trim_end())
    }
}

/// The words of a relayed message, without the "[message from your teammate X]"
/// header and the answer-with instruction the team tool wraps around them.
fn team_body(text: &str) -> String {
    let rest = text
        .strip_prefix("[message from your teammate ")
        .and_then(|r| r.split_once("]\n\n"))
        .map_or(text, |(_, r)| r);
    rest.split("\n\n(Answer").next().unwrap_or(rest).trim().to_string()
}

fn team_tool(name: &str) -> Option<&'static str> {
    if name.ends_with("team__team_ask") {
        Some("team_ask")
    } else if name.ends_with("team__team_message") {
        Some("team_message")
    } else {
        None
    }
}

fn is_doc(path: &str) -> bool {
    if path.split('/').any(|p| p.starts_with('.') && p.len() > 1) {
        return false;
    }
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').is_some_and(|(stem, ext)| {
        !stem.is_empty()
            && matches!(
                ext.to_lowercase().as_str(),
                "md" | "mdx" | "txt" | "rst" | "csv" | "tsv" | "json" | "yaml" | "yml" | "html"
            )
    })
}

fn pr_in(text: &str) -> Option<(String, u32, String)> {
    let at = text.find("https://github.com/")?;
    let tail = &text[at..];
    let url: String = tail.chars().take_while(|c| !c.is_whitespace() && !matches!(c, ')' | '"' | '\'' | '>')).collect();
    let parts: Vec<&str> = url.trim_start_matches("https://github.com/").split('/').collect();
    if parts.len() >= 4 && parts[2] == "pull" {
        let number = parts[3].parse().ok()?;
        return Some((format!("{}/{}", parts[0], parts[1]), number, url));
    }
    None
}

struct Call {
    name: String,
    input: Value,
    feed_at: Option<usize>,
}

/// Reads a session log's text. Pure, so the tests feed it lines directly.
pub fn scan(log: &str, memory_marker: &str) -> ActivityScan {
    let mut out = ActivityScan::default();
    let mut feed: Vec<FeedItem> = Vec::new();
    let mut calls: HashMap<String, Call> = HashMap::new();
    let mut counter = SpendCounter::default();
    let mut months: HashMap<String, f64> = HashMap::new();

    let mut open: Option<OpenTurn> = None;
    let mut hidden = false;
    let mut steps = 0u32;

    for raw in log.lines() {
        let Ok(e) = serde_json::from_str::<Value>(raw) else { continue };
        if !e["subagent"].is_null() {
            continue;
        }
        let Some(at) = e["ts"].as_str().and_then(ms_of) else { continue };
        let seq = e["seq"].as_u64().unwrap_or(0);
        let p = &e["payload"];

        match p["type"].as_str().unwrap_or_default() {
            "user_message" => {
                let text = p["text"].as_str().unwrap_or_default();
                if text.starts_with(INTRO_MARK) || text.starts_with(crate::agent_profile::TIDY_MARK) {
                    hidden = true;
                    open.get_or_insert(OpenTurn { since_ms: at, by: "you".into() });
                    continue;
                }
                hidden = false;
                out.messages.push(at);
                let from = p["from"]["title"].as_str();
                open.get_or_insert(OpenTurn { since_ms: at, by: from.unwrap_or("you").to_string() });
                if let Some(peer) = from {
                    let body = team_body(text);
                    feed.push(FeedItem {
                        group: "team".into(),
                        kind: "team_in".into(),
                        title: format!("{peer} wrote to it"),
                        sub: one_line(&body, 100),
                        at_ms: at,
                        seq,
                        peer: Some(peer.to_string()),
                        ask: Some(body),
                        ..Default::default()
                    });
                }
            }
            "turn_started" => {
                open.get_or_insert(OpenTurn { since_ms: at, by: "you".into() });
            }
            "tool_call_started" => {
                steps += 1;
                let id = p["callId"].as_str().unwrap_or_default().to_string();
                let name = p["name"].as_str().unwrap_or_default().to_string();
                let input = p["input"].clone();
                let tool_type = p["toolType"].as_str().unwrap_or_default();
                let mut feed_at = None;

                if let Some(kind) = team_tool(&name) {
                    let to = input["to"].as_str().unwrap_or("a teammate").to_string();
                    let text = input["text"].as_str().unwrap_or_default().to_string();
                    feed.push(FeedItem {
                        group: "team".into(),
                        kind: kind.into(),
                        title: if kind == "team_ask" { format!("Asked {to}") } else { format!("Messaged {to}") },
                        sub: one_line(&text, 100),
                        at_ms: at,
                        seq,
                        peer: Some(to),
                        ask: Some(text),
                        ..Default::default()
                    });
                    feed_at = Some(feed.len() - 1);
                } else if name.ends_with("memory__memory_write") {
                    let note = input["name"].as_str().unwrap_or("note").to_string();
                    let note = if note.ends_with(".md") { note } else { format!("{note}.md") };
                    feed.push(FeedItem {
                        group: "file".into(),
                        kind: "note".into(),
                        title: format!("Remembered {}", note.trim_end_matches(".md").replace('-', " ")),
                        sub: input["tag"].as_str().map_or("memory".into(), |t| format!("memory · {t}")),
                        at_ms: at,
                        seq,
                        note: Some(note),
                        ..Default::default()
                    });
                } else if tool_type == "file_edit" && {
                    let n = name.to_lowercase();
                    n.contains("write") || n.contains("create")
                } {
                    let path = ["file_path", "path", "notebook_path"]
                        .iter()
                        .find_map(|k| input[*k].as_str())
                        .unwrap_or_default();
                    if path.starts_with('/') {
                        if !memory_marker.is_empty() && path.contains(memory_marker) {
                            let file = path.rsplit('/').next().unwrap_or(path).to_string();
                            feed.push(FeedItem {
                                group: "file".into(),
                                kind: "note".into(),
                                title: format!("Remembered {}", file.trim_end_matches(".md").replace('-', " ")),
                                sub: "memory".into(),
                                at_ms: at,
                                seq,
                                note: Some(file),
                                ..Default::default()
                            });
                        } else if is_doc(path) {
                            feed.push(FeedItem {
                                group: "file".into(),
                                kind: "file".into(),
                                title: format!("Saved {}", path.rsplit('/').next().unwrap_or(path)),
                                sub: path.rsplit_once('/').map_or(String::new(), |(d, _)| d.to_string()),
                                at_ms: at,
                                seq,
                                path: Some(path.to_string()),
                                ..Default::default()
                            });
                        }
                    }
                }
                calls.insert(id, Call { name, input, feed_at });
            }
            "tool_call_completed" => {
                let id = p["callId"].as_str().unwrap_or_default();
                let Some(call) = calls.remove(id) else { continue };
                let result = p["result"]["text"].as_str().unwrap_or_default();

                if let Some(i) = call.feed_at {
                    if team_tool(&call.name) == Some("team_ask") {
                        let answer = result.split_once(" answered:\n\n").map_or(result, |(_, a)| a);
                        let item = &mut feed[i];
                        item.sub = format!("{} · answered", item.sub);
                        item.answer = Some(answer.trim().to_string());
                    }
                }
                // `agent_tools.rs` names the picture as `(file <path>)` in its answer.
                if call.name.ends_with("share_screenshot") {
                    if let Some(path) = result.split_once("(file ").and_then(|(_, r)| r.split_once(')')).map(|(p, _)| p) {
                        let caption = call.input["caption"].as_str().unwrap_or_default();
                        feed.push(FeedItem {
                            group: "file".into(),
                            kind: "image".into(),
                            title: if caption.is_empty() { "Shared a screenshot".into() } else { one_line(caption, 80) },
                            sub: "screenshot".into(),
                            at_ms: at,
                            seq,
                            path: Some(path.to_string()),
                            ..Default::default()
                        });
                    }
                }
                let command = call.input["command"].as_str().unwrap_or_default();
                if command.contains("pr create") {
                    if let Some((repo, number, url)) = pr_in(result) {
                        feed.push(FeedItem {
                            group: "file".into(),
                            kind: "pr".into(),
                            title: format!("Opened PR #{number}"),
                            sub: repo.clone(),
                            at_ms: at,
                            seq,
                            url: Some(url),
                            number: Some(number),
                            repo: Some(repo),
                            ..Default::default()
                        });
                    }
                }
            }
            "turn_completed" => {
                let ok = p["status"].as_str() == Some("success");
                let secs = open
                    .as_ref()
                    .map_or(0, |o| (at.saturating_sub(o.since_ms) / 1000).min(MAX_TURN_SECS)) as u32;
                let by = open.take().map_or("you".to_string(), |o| o.by);

                let total = p["usage"]["costUsd"].as_f64();
                let step = total.map_or(0.0, |t| counter.step(t));
                if step > 0.0 {
                    *months.entry(month_key(at)).or_default() += step;
                }
                let input_tokens = p["usage"]["inputTokens"].as_u64().unwrap_or(0);
                let output_tokens = p["usage"]["outputTokens"].as_u64().unwrap_or(0);
                if step > 0.0 || input_tokens > 0 || output_tokens > 0 {
                    out.calls.push(CallStep { at_ms: at, input_tokens, output_tokens, cost_usd: step });
                }

                out.tasks.push(TaskRun { end_ms: at, secs, ok });
                if !hidden {
                    out.messages.push(at);
                    let mut sub = format!("{steps} {} · {secs}s", if steps == 1 { "step" } else { "steps" });
                    if step > 0.0 {
                        sub.push_str(&format!(" · US$ {step:.2}"));
                    }
                    feed.push(FeedItem {
                        group: "chat".into(),
                        kind: "answer".into(),
                        title: match (ok, by.as_str()) {
                            (false, _) => "A turn stopped with an error".into(),
                            (true, "you") => "Answered you".into(),
                            (true, other) => format!("Answered {other}"),
                        },
                        sub,
                        at_ms: at,
                        seq,
                        ..Default::default()
                    });
                }
                hidden = false;
                steps = 0;
            }
            _ => {}
        }
    }

    out.open = open;
    out.last_total = counter.last();
    let mut spend: Vec<MonthSpend> = months.into_iter().map(|(month, usd)| MonthSpend { month, usd }).collect();
    spend.sort_by(|a, b| a.month.cmp(&b.month));
    out.spend = spend;

    feed.reverse();
    feed.truncate(FEED_CAP);
    out.feed = feed;
    out
}

/// Scans one session's log from disk. A missing log is an empty scan: an agent
/// exists before its first turn.
pub async fn scan_session(session_id: &str) -> ActivityScan {
    let Ok(path) = store::get_session_path(session_id).await else { return ActivityScan::default() };
    let Ok(text) = tokio::fs::read_to_string(&path).await else { return ActivityScan::default() };
    tokio::task::spawn_blocking(move || scan(&text, "")).await.unwrap_or_default()
}

/// The agent's activity, read from its conversation's log.
#[tauri::command]
pub async fn agent_activity(agent_id: String) -> Result<ActivityScan, String> {
    agents::valid_agent_id(&agent_id).map_err(|e| e.to_string())?;
    let agent = agents::by_id(&agent_id).ok_or("unknown agent")?;
    let Some(session_id) = agent.session_id else { return Ok(ActivityScan::default()) };
    let Ok(path) = store::get_session_path(&session_id).await else { return Ok(ActivityScan::default()) };
    let Ok(text) = tokio::fs::read_to_string(&path).await else { return Ok(ActivityScan::default()) };
    // The marker a write into this agent's own memory folder carries in its path.
    let marker = format!("/agents/{agent_id}/memory/");
    tokio::task::spawn_blocking(move || scan(&text, &marker))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(seq: u64, ts: &str, payload: Value) -> String {
        serde_json::json!({"seq": seq, "ts": ts, "subagent": null, "payload": payload}).to_string()
    }

    fn log(lines: &[String]) -> String {
        lines.join("\n")
    }

    #[test]
    fn a_turn_becomes_a_task_two_messages_and_an_answer_row() {
        let text = log(&[
            line(0, "2026-10-23T21:00:00.000Z", serde_json::json!({"type":"user_message","text":"oi","from":null})),
            line(1, "2026-10-23T21:00:02.000Z", serde_json::json!({"type":"tool_call_started","callId":"c1","name":"bash","toolType":"shell","input":{"command":"ls"}})),
            line(2, "2026-10-23T21:00:30.000Z", serde_json::json!({"type":"turn_completed","status":"success","usage":{"costUsd":0.18}})),
        ]);
        let s = scan(&text, "");

        assert_eq!(s.messages.len(), 2);
        assert_eq!(s.tasks.len(), 1);
        assert_eq!(s.tasks[0].secs, 30);
        assert!(s.tasks[0].ok);
        assert_eq!(s.feed[0].title, "Answered you");
        assert_eq!(s.feed[0].sub, "1 step · 30s · US$ 0.18");
        assert!(s.open.is_none());
    }

    #[test]
    fn spend_is_the_step_between_running_totals_by_month() {
        let done = |seq, ts: &str, total| line(seq, ts, serde_json::json!({"type":"turn_completed","status":"success","usage":{"costUsd":total}}));
        let text = log(&[
            done(1, "2026-09-30T12:00:00.000Z", 0.50),
            done(2, "2026-10-02T12:00:00.000Z", 0.80),
            // The child restarted: the total starts over.
            done(3, "2026-10-03T12:00:00.000Z", 0.10),
        ]);
        let s = scan(&text, "");

        let by: HashMap<_, _> = s.spend.iter().map(|m| (m.month.as_str(), m.usd)).collect();
        assert!((by["2026-09"] - 0.50).abs() < 1e-9);
        assert!((by["2026-10"] - 0.40).abs() < 1e-9);
        assert!((s.last_total - 0.10).abs() < 1e-9);
    }

    #[test]
    fn a_hidden_prompt_is_work_but_not_a_message_or_a_row() {
        let text = log(&[
            line(0, "2026-10-23T21:00:00.000Z", serde_json::json!({"type":"user_message","text":"<hz-tidy/>Tidy.","from":null})),
            line(1, "2026-10-23T21:00:10.000Z", serde_json::json!({"type":"turn_completed","status":"success"})),
        ]);
        let s = scan(&text, "");

        assert!(s.messages.is_empty());
        assert_eq!(s.tasks.len(), 1);
        assert!(s.feed.is_empty());
    }

    #[test]
    fn teammates_files_prs_and_notes_become_rows_that_open() {
        let text = log(&[
            line(0, "2026-10-23T21:00:00.000Z", serde_json::json!({"type":"user_message","text":"go","from":null})),
            line(1, "2026-10-23T21:00:01.000Z", serde_json::json!({"type":"tool_call_started","callId":"a","name":"mcp__team__team_ask","toolType":"mcp","input":{"to":"Hugo","text":"prices?"}})),
            line(2, "2026-10-23T21:00:20.000Z", serde_json::json!({"type":"tool_call_completed","callId":"a","result":{"text":"Hugo answered:\n\nE2B per second."}})),
            line(3, "2026-10-23T21:00:21.000Z", serde_json::json!({"type":"tool_call_started","callId":"b","name":"Write","toolType":"file_edit","input":{"file_path":"/p/notes/pricing.md"}})),
            line(4, "2026-10-23T21:00:22.000Z", serde_json::json!({"type":"tool_call_started","callId":"n","name":"Write","toolType":"file_edit","input":{"file_path":"/h/agents/x/memory/tone.md"}})),
            line(5, "2026-10-23T21:00:23.000Z", serde_json::json!({"type":"tool_call_started","callId":"c","name":"bash","toolType":"shell","input":{"command":"gh pr create"}})),
            line(6, "2026-10-23T21:00:24.000Z", serde_json::json!({"type":"tool_call_completed","callId":"c","result":{"text":"https://github.com/acme/app/pull/212\n"}})),
        ]);
        let s = scan(&text, "/agents/x/memory/");
        let kinds: Vec<&str> = s.feed.iter().map(|f| f.kind.as_str()).collect();

        assert_eq!(kinds, vec!["pr", "note", "file", "team_ask"], "newest first");
        assert_eq!(s.feed[0].number, Some(212));
        assert_eq!(s.feed[0].repo.as_deref(), Some("acme/app"));
        assert_eq!(s.feed[1].note.as_deref(), Some("tone.md"));
        assert_eq!(s.feed[2].path.as_deref(), Some("/p/notes/pricing.md"));
        assert_eq!(s.feed[3].answer.as_deref(), Some("E2B per second."));
        assert_eq!(s.feed[3].peer.as_deref(), Some("Hugo"));
        assert!(s.open.is_some(), "the turn never closed, so it is still going");
    }

    #[test]
    fn a_shared_screenshot_is_a_library_row_with_its_file() {
        let text = log(&[
            line(1, "2026-10-23T21:00:01.000Z", serde_json::json!({"type":"tool_call_started","callId":"s","name":"mcp__hz__share_screenshot","toolType":"mcp","input":{"caption":"The deploy page"}})),
            line(2, "2026-10-23T21:00:03.000Z", serde_json::json!({"type":"tool_call_completed","callId":"s","result":{"text":"Screenshot shared (file /h/.hz/attachments/s1/screenshots/ada-20261023-210003.png). The person sees it."}})),
        ]);
        let s = scan(&text, "");
        assert_eq!(s.feed[0].kind, "image");
        assert_eq!(s.feed[0].title, "The deploy page");
        assert_eq!(s.feed[0].path.as_deref(), Some("/h/.hz/attachments/s1/screenshots/ada-20261023-210003.png"));
    }

    #[test]
    fn a_relayed_message_loses_its_wrapper() {
        let body = team_body("[message from your teammate Hugo]\n\nUse E2B.\n\n(Answer with team_message to Hugo if a reply is needed.)");
        assert_eq!(body, "Use E2B.");
    }
}
