//! An agent's monthly spend, and what happens at 80% and 100% of its budget.
//!
//! Spend is the sum, per calendar month, of what each finished turn added to the
//! session's reported cost. The agent reports a **running total for the session**,
//! so a turn's cost is the step from the last total — and a total that goes
//! *down* means the child restarted and counts from zero again.

use std::{
    collections::{HashMap, HashSet},
    sync::{LazyLock, Mutex},
};

use chrono::{Datelike, Local, TimeZone};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use crate::{agent_activity, agent_profile, agents, workspaces};

/// Turns a stream of running totals into the cost of each step.
#[derive(Default, Clone, Copy)]
pub struct SpendCounter {
    last: f64,
}

impl SpendCounter {
    /// Starts from a total already counted, for a ledger resumed from disk.
    pub fn new(last: f64) -> Self {
        Self { last }
    }

    /// The cost since the previous total. A smaller total is a fresh child, so
    /// the whole of it is new spend.
    pub fn step(&mut self, total: f64) -> f64 {
        let delta = if total >= self.last { total - self.last } else { total };
        self.last = total;
        delta
    }

    /// The newest total seen, to persist so the next step is measured from it.
    pub fn last(&self) -> f64 {
        self.last
    }
}

/// `2026-10`, in the reader's own calendar: a budget resets when their month does.
pub fn month_key(ms: u64) -> String {
    let at = Local.timestamp_millis_opt(ms as i64).single().unwrap_or_else(Local::now);
    format!("{:04}-{:02}", at.year(), at.month())
}

/// Where spend stands against a budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub enum BudgetState {
    Ok,
    Warn,
    Paused,
}

/// Pure: the state for `spent` against `budget`. No budget never pauses.
pub fn state_for(spent: f64, budget: Option<f64>) -> BudgetState {
    match budget {
        Some(b) if b > 0.0 && spent >= b => BudgetState::Paused,
        Some(b) if b > 0.0 && spent >= b * 0.8 => BudgetState::Warn,
        _ => BudgetState::Ok,
    }
}

/// What the Access tab draws.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SpendView {
    pub month: String,
    pub spent_usd: f64,
    pub budget_usd: Option<f64>,
    pub state: BudgetState,
}

/// Told to the webview when an agent crosses 80% or 100%, and again to nobody:
/// the page and the notice stack turn it into a card, and the Inbox will read the
/// same event.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct BudgetNotice {
    pub agent_id: String,
    pub agent_name: String,
    pub state: BudgetState,
    pub spent_usd: f64,
    pub budget_usd: f64,
    pub at_ms: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Ledger {
    month: String,
    usd: f64,
    last_total: f64,
    /// Which thresholds were already announced this month, so a turn does not
    /// raise the same card again.
    warned: bool,
    paused: bool,
}

static LEDGERS: LazyLock<Mutex<HashMap<String, Ledger>>> = LazyLock::new(Default::default);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// The ledger for an agent: from memory, else from its file, else rebuilt from
/// the session log, which is how an agent that spent before this existed starts
/// with a true number.
async fn ledger(agent: &agents::AgentRecord) -> Ledger {
    if let Some(l) = LEDGERS.lock().expect("ledgers poisoned").get(&agent.id) {
        if l.month == month_key(now_ms()) {
            return l.clone();
        }
    }
    let month = month_key(now_ms());
    let file = agent_profile::agent_root(&agent.id).await.ok().map(|r| r.join("spend.json"));
    if let Some(file) = &file {
        if let Some(l) = tokio::fs::read_to_string(file)
            .await
            .ok()
            .and_then(|raw| serde_json::from_str::<Ledger>(&raw).ok())
            .filter(|l| l.month == month)
        {
            LEDGERS.lock().expect("ledgers poisoned").insert(agent.id.clone(), l.clone());
            return l;
        }
    }
    let rebuilt = match &agent.session_id {
        Some(sid) => {
            let scan = agent_activity::scan_session(sid).await;
            Ledger {
                usd: scan.spend.iter().find(|m| m.month == month).map_or(0.0, |m| m.usd),
                last_total: scan.last_total,
                month,
                ..Default::default()
            }
        }
        None => Ledger { month, ..Default::default() },
    };
    save(&agent.id, &rebuilt).await;
    rebuilt
}

async fn save(agent_id: &str, l: &Ledger) {
    LEDGERS.lock().expect("ledgers poisoned").insert(agent_id.to_string(), l.clone());
    if let Ok(root) = agent_profile::agent_root(agent_id).await {
        let _ = tokio::fs::create_dir_all(&root).await;
        let _ = tokio::fs::write(root.join("spend.json"), serde_json::to_vec(l).unwrap_or_default()).await;
    }
}

/// What the workspace's budget says about the next prompt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceVerdict {
    Go,
    /// Over budget and the reader chose "Pause agents".
    Pause,
    /// Over budget and the reader chose "Ask me": the prompt waits on an answer.
    Ask,
}

/// Pure: where `spent` stands against a workspace budget and its action
/// (`pause`, `ask` or `go`). No budget, or "keep going", never holds a prompt.
pub fn workspace_verdict(spent: f64, budget: Option<f64>, action: &str) -> WorkspaceVerdict {
    match budget {
        Some(b) if b > 0.0 && spent >= b => match action {
            "pause" => WorkspaceVerdict::Pause,
            "go" => WorkspaceVerdict::Go,
            _ => WorkspaceVerdict::Ask,
        },
        _ => WorkspaceVerdict::Go,
    }
}

/// Pure: whether `spent` has reached the alert line (a percentage of the budget).
pub fn crossed_alert(spent: f64, budget: Option<f64>, alert_pct: u32) -> bool {
    matches!(budget, Some(b) if b > 0.0 && spent >= b * f64::from(alert_pct) / 100.0)
}

/// What a workspace has spent this month: the sum of its agents' ledgers, which
/// are updated as each turn closes and so already hold the turn that just ended.
async fn workspace_spent(workspace_id: &str) -> f64 {
    let mut total = 0.0;
    for agent in agents::in_workspace(workspace_id) {
        total += ledger(&agent).await.usd;
    }
    total
}

/// `workspace id + month` pairs the reader already said "keep going" to, or that
/// were already warned about, so neither is asked twice in a month.
static ALLOWED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
static ALERTED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

fn month_token(workspace_id: &str) -> String {
    format!("{workspace_id}:{}", month_key(now_ms()))
}

/// Refuses a prompt to an agent that is out of budget. Called at the one door
/// every prompt goes through. The agent's own budget comes first; then the
/// workspace's, whose "Ask me" raises an Inbox question and holds the prompt.
pub async fn guard(agent_id: &str, app: &AppHandle) -> anyhow::Result<()> {
    let Some(agent) = agents::by_id(agent_id) else { return Ok(()) };
    if let Some(budget) = agent.budget {
        let spent = ledger(&agent).await.usd;
        if state_for(spent, Some(budget)) == BudgetState::Paused {
            anyhow::bail!(
                "{} is paused: it has spent US$ {spent:.2} of its US$ {budget:.2} monthly budget. \
                 Raise the budget in its Access tab to continue.",
                agent.name
            );
        }
    }

    let Some(ws_id) = agent.workspace_id.clone() else { return Ok(()) };
    let defaults = workspaces::defaults_of(&ws_id);
    if defaults.budget_usd.is_none() || ALLOWED.lock().expect("allowed poisoned").contains(&month_token(&ws_id)) {
        return Ok(());
    }
    let spent = workspace_spent(&ws_id).await;
    match workspace_verdict(spent, defaults.budget_usd, &defaults.budget_action) {
        WorkspaceVerdict::Go => Ok(()),
        WorkspaceVerdict::Pause => anyhow::bail!(
            "The workspace has spent US$ {spent:.2} of its US$ {:.2} monthly budget and is set to pause agents. \
             Raise the budget in Settings, Usage & limits, to continue.",
            defaults.budget_usd.unwrap_or_default()
        ),
        WorkspaceVerdict::Ask => {
            let question = format!(
                "The workspace has spent US$ {spent:.2} of its US$ {:.2} budget this month. \
                 {} is about to start another turn. Keep going for the rest of the month?",
                defaults.budget_usd.unwrap_or_default(),
                agent.name
            );
            let answer = crate::inbox::ask_user(app, &agent, &question, vec!["Keep going".into(), "Stop".into()])
                .await?;
            if answer.eq_ignore_ascii_case("keep going") {
                ALLOWED.lock().expect("allowed poisoned").insert(month_token(&ws_id));
                Ok(())
            } else {
                anyhow::bail!("The workspace budget is reached and you chose to stop. Nothing was sent.")
            }
        }
    }
}

/// Warns once a month when the workspace crosses its alert line.
async fn workspace_alert(agent: &agents::AgentRecord, app: &AppHandle) {
    let Some(ws_id) = agent.workspace_id.as_deref() else { return };
    let defaults = workspaces::defaults_of(ws_id);
    if defaults.budget_usd.is_none() || ALERTED.lock().expect("alerted poisoned").contains(&month_token(ws_id)) {
        return;
    }
    let spent = workspace_spent(ws_id).await;
    if !crossed_alert(spent, defaults.budget_usd, defaults.alert_pct) {
        return;
    }
    ALERTED.lock().expect("alerted poisoned").insert(month_token(ws_id));
    let budget = defaults.budget_usd.unwrap_or_default();
    let title = format!("The workspace is at {}% of its budget", defaults.alert_pct);
    let body = format!("US$ {spent:.2} of US$ {budget:.2} this month");
    crate::inbox::push_done(app, &agent.id, &title, &body, serde_json::json!({"summary": body}), None);
    crate::notifications::notify_asking(app, None, "asking", title, body).await;
}

/// How far into a turn the running cost is, per session, for the per-task cap.
#[derive(Default)]
struct TaskWatch {
    base: f64,
    last: f64,
    tripped: bool,
}

static TASKS: LazyLock<Mutex<HashMap<String, TaskWatch>>> = LazyLock::new(Default::default);

/// A turn began: what it costs is measured from the running total as it stands.
pub fn task_started(session_id: &str) {
    let mut tasks = TASKS.lock().expect("task watch poisoned");
    let w = tasks.entry(session_id.to_string()).or_default();
    w.base = w.last;
    w.tripped = false;
}

/// Pure: whether a turn that started at `base` and is now at `total` has gone
/// over `cap`. A total below the base is a fresh child counting from zero.
pub fn over_task_cap(base: f64, total: f64, cap: Option<f64>) -> bool {
    let spent = if total >= base { total - base } else { total };
    matches!(cap, Some(c) if c > 0.0 && spent > c)
}

/// The agent's running session total moved. Past the workspace's per-task cap
/// the turn is stopped and the reader is asked whether to let it carry on.
pub fn task_cost(session_id: &str, total: f64, app: &AppHandle) {
    let Some(agent) = agents::agent_of(session_id) else { return };
    let cap = agent.workspace_id.as_deref().and_then(|id| workspaces::defaults_of(id).task_cap_usd);

    let spent = {
        let mut tasks = TASKS.lock().expect("task watch poisoned");
        let w = tasks.entry(session_id.to_string()).or_default();
        w.last = total;
        if w.tripped || !over_task_cap(w.base, total, cap) {
            return;
        }
        w.tripped = true;
        if total >= w.base { total - w.base } else { total }
    };

    let app = app.clone();
    let session_id = session_id.to_string();
    tauri::async_runtime::spawn(async move {
        let manager = app.state::<crate::session::SessionManager>();
        let _ = manager.interrupt(&session_id, &app).await;
        let question = format!(
            "{} stopped: this one task has cost US$ {spent:.2}, over your US$ {:.2} limit. Let it carry on?",
            agent.name,
            cap.unwrap_or_default()
        );
        let answer = crate::inbox::ask_user(&app, &agent, &question, vec!["Carry on".into(), "Leave it".into()])
            .await
            .unwrap_or_default();
        if answer.eq_ignore_ascii_case("carry on") {
            if let Some(target) = crate::orchestration::resolved_session(Some(&session_id)).await {
                let _ = crate::orchestration::deliver(&target, None, "Carry on with what you were doing.", &app).await;
            }
        }
    });
}

/// Called with every finished turn's running session total. Adds the step to the
/// month and announces a threshold the first time it is crossed.
pub async fn observe_completed(session_id: &str, total_usd: Option<f64>, app: &AppHandle) {
    let (Some(total), Some(agent)) = (total_usd, agents::agent_of(session_id)) else { return };
    let mut l = ledger(&agent).await;

    let mut counter = SpendCounter::new(l.last_total);
    l.usd += counter.step(total);
    l.last_total = counter.last();

    let state = state_for(l.usd, agent.budget);
    let announce = match state {
        BudgetState::Paused if !l.paused => {
            l.paused = true;
            l.warned = true;
            true
        }
        BudgetState::Warn if !l.warned => {
            l.warned = true;
            true
        }
        _ => false,
    };
    save(&agent.id, &l).await;
    workspace_alert(&agent, app).await;

    if let (true, Some(budget)) = (announce, agent.budget) {
        let _ = app.emit(
            "agent_budget",
            BudgetNotice {
                agent_id: agent.id.clone(),
                agent_name: agent.name.clone(),
                state,
                spent_usd: l.usd,
                budget_usd: budget,
                at_ms: now_ms(),
            },
        );
    }
}

/// This month's spend against the agent's budget.
#[tauri::command]
pub async fn agent_spend(agent_id: String) -> Result<SpendView, String> {
    let agent = agents::by_id(&agent_id).ok_or("unknown agent")?;
    let l = ledger(&agent).await;
    Ok(SpendView {
        month: l.month,
        spent_usd: l.usd,
        budget_usd: agent.budget,
        state: state_for(l.usd, agent.budget),
    })
}

/// Clears the "already announced" marks when the budget changes, so raising it
/// and crossing the new line announces again.
#[tauri::command]
pub async fn agent_budget_changed(agent_id: String) -> Result<SpendView, String> {
    let agent = agents::by_id(&agent_id).ok_or("unknown agent")?;
    let mut l = ledger(&agent).await;
    l.warned = state_for(l.usd, agent.budget) != BudgetState::Ok;
    l.paused = state_for(l.usd, agent.budget) == BudgetState::Paused;
    save(&agent.id, &l).await;
    agent_spend(agent_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_running_total_becomes_the_cost_of_each_step() {
        let mut c = SpendCounter::default();
        assert_eq!(c.step(0.10), 0.10);
        assert!((c.step(0.35) - 0.25).abs() < 1e-9);
        assert_eq!(c.step(0.35), 0.0);
    }

    #[test]
    fn a_total_that_drops_is_a_fresh_child_and_counts_in_full() {
        let mut c = SpendCounter::new(1.00);
        assert!((c.step(0.20) - 0.20).abs() < 1e-9);
        assert!((c.step(0.50) - 0.30).abs() < 1e-9);
    }

    #[test]
    fn eighty_percent_warns_and_a_hundred_pauses() {
        assert_eq!(state_for(10.0, Some(50.0)), BudgetState::Ok);
        assert_eq!(state_for(39.99, Some(50.0)), BudgetState::Ok);
        assert_eq!(state_for(40.0, Some(50.0)), BudgetState::Warn);
        assert_eq!(state_for(50.0, Some(50.0)), BudgetState::Paused);
        assert_eq!(state_for(500.0, None), BudgetState::Ok);
        assert_eq!(state_for(500.0, Some(0.0)), BudgetState::Ok, "a zero budget means none");
    }

    #[test]
    fn a_workspace_over_budget_pauses_asks_or_goes_on_by_the_readers_pick() {
        assert_eq!(workspace_verdict(50.0, Some(50.0), "pause"), WorkspaceVerdict::Pause);
        assert_eq!(workspace_verdict(50.0, Some(50.0), "ask"), WorkspaceVerdict::Ask);
        assert_eq!(workspace_verdict(50.0, Some(50.0), "go"), WorkspaceVerdict::Go);
        assert_eq!(workspace_verdict(49.99, Some(50.0), "pause"), WorkspaceVerdict::Go);
        assert_eq!(workspace_verdict(500.0, None, "pause"), WorkspaceVerdict::Go);
        assert_eq!(workspace_verdict(500.0, Some(0.0), "pause"), WorkspaceVerdict::Go, "zero means none");
    }

    #[test]
    fn the_alert_line_is_a_percentage_of_the_budget() {
        assert!(!crossed_alert(79.0, Some(100.0), 80));
        assert!(crossed_alert(80.0, Some(100.0), 80));
        assert!(!crossed_alert(1000.0, None, 80));
    }

    #[test]
    fn a_task_is_over_its_cap_by_what_it_added_not_by_the_session_total() {
        assert!(!over_task_cap(10.0, 11.5, Some(2.0)));
        assert!(over_task_cap(10.0, 12.5, Some(2.0)));
        assert!(over_task_cap(10.0, 2.5, Some(2.0)), "a fresh child counts from zero");
        assert!(!over_task_cap(0.0, 99.0, None));
    }

    #[test]
    fn months_are_the_readers_calendar_months() {
        let oct = Local.with_ymd_and_hms(2026, 10, 15, 12, 0, 0).unwrap().timestamp_millis() as u64;
        let nov = Local.with_ymd_and_hms(2026, 11, 1, 0, 30, 0).unwrap().timestamp_millis() as u64;
        assert_eq!(month_key(oct), "2026-10");
        assert_eq!(month_key(nov), "2026-11");
    }
}
