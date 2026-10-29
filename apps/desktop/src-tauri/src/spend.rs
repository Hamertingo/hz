//! What the agents spent, as Settings → Usage & limits draws it: this month per
//! agent, the CSV of every call, and the token counts the estimated plan bars
//! are sized from.
//!
//! Everything is derived from the session logs on request (see
//! [`crate::agent_activity`]); nothing is stored here.

use std::collections::HashMap;

use serde::Serialize;
use ts_rs::TS;

use crate::{agent_activity, agents, budget::month_key};

/// One finished turn, attributed.
#[derive(Clone, Debug, PartialEq)]
pub struct CallRow {
    pub at_ms: u64,
    pub agent_id: String,
    pub agent_name: String,
    pub harness: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

/// One agent's month.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct AgentSpend {
    pub agent_id: String,
    pub name: String,
    pub harness: String,
    pub usd: f64,
    pub calls: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// The month across a workspace.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SpendOverview {
    pub month: String,
    pub total_usd: f64,
    /// Highest spender first.
    pub agents: Vec<AgentSpend>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Every call of the given agents, oldest first.
async fn calls_of(records: Vec<agents::AgentRecord>) -> Vec<CallRow> {
    let mut out = Vec::new();
    for agent in records {
        let Some(session) = agent.session_id.as_deref() else { continue };
        let scan = agent_activity::scan_session(session).await;
        out.extend(scan.calls.into_iter().map(|c| CallRow {
            at_ms: c.at_ms,
            agent_id: agent.id.clone(),
            agent_name: agent.name.clone(),
            harness: agent.harness.clone(),
            model: agent.model_id.clone().unwrap_or_default(),
            input_tokens: c.input_tokens,
            output_tokens: c.output_tokens,
            cost_usd: c.cost_usd,
        }));
    }
    out.sort_by_key(|c| c.at_ms);
    out
}

fn records_for(workspace_id: Option<&str>) -> Vec<agents::AgentRecord> {
    match workspace_id {
        Some(id) => agents::in_workspace(id),
        None => agents::all(),
    }
}

/// Tokens counted in the last 5 hours and the last 7 days, per harness, across
/// every agent. What an estimated bar is sized from.
pub async fn window_tokens() -> HashMap<String, (u64, u64)> {
    let now = now_ms();
    let mut out: HashMap<String, (u64, u64)> = HashMap::new();
    for c in calls_of(agents::all()).await {
        let age = now.saturating_sub(c.at_ms);
        let tokens = c.input_tokens + c.output_tokens;
        let slot = out.entry(c.harness).or_default();
        if age <= 5 * 3_600_000 {
            slot.0 += tokens;
        }
        if age <= 7 * 86_400_000 {
            slot.1 += tokens;
        }
    }
    out
}

/// This month's dollars across a workspace, for the budget guard.
pub async fn workspace_month_usd(workspace_id: &str) -> f64 {
    let month = month_key(now_ms());
    calls_of(agents::in_workspace(workspace_id))
        .await
        .iter()
        .filter(|c| month_key(c.at_ms) == month)
        .map(|c| c.cost_usd)
        .sum()
}

/// Rolls calls up into one row per agent for `month`.
pub fn overview(calls: &[CallRow], month: &str) -> SpendOverview {
    let mut by_agent: HashMap<&str, AgentSpend> = HashMap::new();
    for c in calls.iter().filter(|c| month_key(c.at_ms) == month) {
        let row = by_agent.entry(&c.agent_id).or_insert_with(|| AgentSpend {
            agent_id: c.agent_id.clone(),
            name: c.agent_name.clone(),
            harness: c.harness.clone(),
            usd: 0.0,
            calls: 0,
            input_tokens: 0,
            output_tokens: 0,
        });
        row.usd += c.cost_usd;
        row.calls += 1;
        row.input_tokens += c.input_tokens;
        row.output_tokens += c.output_tokens;
    }
    let mut agents: Vec<AgentSpend> = by_agent.into_values().collect();
    agents.sort_by(|a, b| b.usd.total_cmp(&a.usd).then_with(|| a.name.cmp(&b.name)));
    SpendOverview { month: month.to_string(), total_usd: agents.iter().map(|a| a.usd).sum(), agents }
}

/// One CSV field: quoted when it holds a comma, quote or newline, with quotes
/// doubled. A leading `=`, `+`, `-` or `@` is prefixed so a spreadsheet opens a
/// model or agent name as text instead of running it as a formula.
fn field(raw: &str) -> String {
    let safe = if raw.starts_with(['=', '+', '-', '@']) { format!("'{raw}") } else { raw.to_string() };
    if safe.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", safe.replace('"', "\"\""))
    } else {
        safe
    }
}

/// Every call in `month`, one row each.
pub fn csv(calls: &[CallRow], month: &str) -> String {
    let mut out = String::from("time,agent,cli,model,input_tokens,output_tokens,cost_usd\n");
    for c in calls.iter().filter(|c| month_key(c.at_ms) == month) {
        let time = chrono::DateTime::from_timestamp_millis(c.at_ms as i64)
            .map_or_else(String::new, |t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        out.push_str(&format!(
            "{},{},{},{},{},{},{:.4}\n",
            time,
            field(&c.agent_name),
            field(&c.harness),
            field(&c.model),
            c.input_tokens,
            c.output_tokens,
            c.cost_usd
        ));
    }
    out
}

/// This month's spend per agent in a workspace.
#[tauri::command]
pub async fn usage_spend(workspace_id: Option<String>) -> Result<SpendOverview, String> {
    let calls = calls_of(records_for(workspace_id.as_deref())).await;
    Ok(overview(&calls, &month_key(now_ms())))
}

/// Writes every call this month to `path` as CSV and answers how many rows.
#[tauri::command]
pub async fn usage_export_csv(workspace_id: Option<String>, path: String) -> Result<u32, String> {
    let month = month_key(now_ms());
    let calls = calls_of(records_for(workspace_id.as_deref())).await;
    let body = csv(&calls, &month);
    let rows = body.lines().count().saturating_sub(1) as u32;
    tokio::fs::write(&path, body).await.map_err(|e| format!("could not write {path}: {e}"))?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, TimeZone};

    fn ms(m: u32, d: u32) -> u64 {
        Local.with_ymd_and_hms(2026, m, d, 12, 0, 0).unwrap().timestamp_millis() as u64
    }

    fn call(agent: &str, at: u64, cost: f64) -> CallRow {
        CallRow {
            at_ms: at,
            agent_id: agent.into(),
            agent_name: agent.to_uppercase(),
            harness: "claude-acp".into(),
            model: "m".into(),
            input_tokens: 10,
            output_tokens: 5,
            cost_usd: cost,
        }
    }

    #[test]
    fn the_month_rolls_up_per_agent_biggest_first_and_ignores_other_months() {
        let calls = [call("ada", ms(10, 2), 1.5), call("leo", ms(10, 3), 4.0), call("ada", ms(10, 9), 1.0), call("ada", ms(9, 30), 99.0)];
        let o = overview(&calls, "2026-10");

        assert_eq!(o.agents.len(), 2);
        assert_eq!(o.agents[0].agent_id, "leo");
        assert_eq!((o.agents[1].agent_id.as_str(), o.agents[1].calls), ("ada", 2));
        assert_eq!((o.agents[1].input_tokens, o.agents[1].output_tokens), (20, 10));
        assert!((o.total_usd - 6.5).abs() < 1e-9);
    }

    #[test]
    fn the_csv_has_a_header_one_row_per_call_and_quotes_what_needs_it() {
        let mut odd = call("ada", ms(10, 2), 0.25);
        odd.agent_name = "Ada, \"the\" dev".into();
        odd.model = "=cmd".into();
        let text = csv(&[odd, call("old", ms(9, 1), 1.0)], "2026-10");
        let lines: Vec<&str> = text.lines().collect();

        assert_eq!(lines[0], "time,agent,cli,model,input_tokens,output_tokens,cost_usd");
        assert_eq!(lines.len(), 2, "September's call is not in October's export");
        assert!(lines[1].contains("\"Ada, \"\"the\"\" dev\""));
        assert!(lines[1].contains(",'=cmd,"), "a formula is neutered");
        assert!(lines[1].ends_with(",10,5,0.2500"));
    }
}
