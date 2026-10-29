//! How agents work and what they cost, wired into the live session: run timings and an estimated
//! cost on every finished turn, the sidebar's digest line, the routine offer, the light-and-strong
//! brain, and the scripted first chat. The logic lives in `agentkit/`; this is where it meets events.
//!
//! Fed from two places in `session.rs`: [`prompt_logged`] when a prompt is written to the log, and
//! [`observe`] for every mapped event before it is emitted and persisted, so what it writes onto a
//! `turn_completed` (the duration, an estimated cost) is what the log keeps.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::agentkit::{digest, onboarding, rotation, routine_suggest, timings, usage};
use crate::events::{AgentEvent, AgentEventPayload, Usage};
use crate::harness::Harness;
use crate::models::{Effort, ModelId};

/// One session's turn as it runs.
#[derive(Default)]
struct Run {
    timings: timings::RunTimings,
    open: bool,
    /// Call id to its span label, since a result names only the id.
    calls: HashMap<String, String>,
    /// What the agent said since the reader last wrote or looked, for the digest.
    said: Vec<digest::Msg>,
}

impl Run {
    fn begin(&mut self, now: u64) {
        if !self.open {
            self.timings = timings::RunTimings::new();
            self.timings.begin_turn(now);
            self.calls.clear();
            self.open = true;
        }
    }

    /// Feeds one event; answers the turn's report when the event closes it.
    fn feed(&mut self, payload: &AgentEventPayload, seq: u64, now: u64) -> Option<timings::Report> {
        match payload {
            AgentEventPayload::TurnStarted(_) => self.begin(now),
            AgentEventPayload::ToolCallStarted { call_id, name, .. } => {
                self.begin(now);
                let label = format!("tool:{name}");
                self.timings.start(&label, now);
                self.calls.insert(call_id.clone(), label);
            }
            AgentEventPayload::ToolCallCompleted { call_id, .. } => {
                if let Some(label) = self.calls.remove(call_id) {
                    self.timings.end(&label, now);
                }
            }
            AgentEventPayload::Delta(_) => self.timings.mark_first_output(now),
            AgentEventPayload::AssistantText { text, .. } => {
                self.timings.mark_first_output(now);
                if !text.trim().is_empty() {
                    self.said.push(digest::Msg { id: seq.to_string(), text: text.clone() });
                }
            }
            AgentEventPayload::TurnCompleted { .. } => {
                self.begin(now);
                self.timings.end_turn(now);
                self.open = false;
                return Some(self.timings.report());
            }
            _ => {}
        }
        None
    }
}

static RUNS: LazyLock<Mutex<HashMap<String, Run>>> = LazyLock::new(Default::default);
/// Estimated dollars per session, kept as a running total so it reads like the engines' own.
static ESTIMATES: LazyLock<Mutex<HashMap<String, f64>>> = LazyLock::new(Default::default);
/// Serialises the small JSON stores below; each is read, changed and written whole.
static FILES: Mutex<()> = Mutex::new(());

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

async fn path(name: &str) -> Option<PathBuf> {
    crate::kit_cmds::root().await.ok().map(|d| d.join(name))
}

fn read<T: Default + for<'de> Deserialize<'de>>(p: &std::path::Path) -> T {
    std::fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write<T: Serialize>(p: &std::path::Path, v: &T) {
    let tmp = p.with_extension("tmp");
    if serde_json::to_vec(v).ok().and_then(|b| std::fs::write(&tmp, b).ok()).is_some() {
        let _ = std::fs::rename(tmp, p);
    }
}

/// Whether hz itself wrote this prompt (the greeting, the memory tidy), which no person asked for.
fn is_hidden(text: &str) -> bool {
    text.starts_with("<hz-")
}

/// This turn's estimated cost in dollars, from its own token counts and the price table.
pub fn estimate_usd(model: &str, u: &Usage) -> Option<f64> {
    let micro = usage::estimate_microusd(
        model,
        u.input_tokens.unwrap_or(0),
        u.output_tokens.unwrap_or(0),
        u.cached_input_tokens.unwrap_or(0),
        u.cache_write_tokens.unwrap_or(0),
    )?;
    (micro > 0).then_some(micro as f64 / 1_000_000.0)
}

/// A prompt was logged. `by_reader` is false for a teammate's ask or a relayed message.
pub fn prompt_logged(session_id: &str, text: &str, by_reader: bool) {
    {
        let mut runs = RUNS.lock().expect("runs poisoned");
        let run = runs.entry(session_id.to_string()).or_default();
        run.begin(now_ms());
        if by_reader {
            run.said.clear();
        }
    }
    if !by_reader || is_hidden(text) || crate::routines::is_running(session_id) {
        return;
    }
    // Only the agent's own chat: a channel thread is the group's errand, not the reader's habit.
    let Some(agent) = crate::agents::agent_of(session_id).filter(|a| a.session_id.as_deref() == Some(session_id)) else { return };
    let (sid, text) = (session_id.to_string(), text.to_string());
    tokio::spawn(async move {
        clear_digest(&sid).await;
        note_request(&agent.id, &text).await;
    });
}

/// The reader opened a chat: what the agent said there is read.
pub fn seen(session_id: &str) {
    if let Some(run) = RUNS.lock().expect("runs poisoned").get_mut(session_id) {
        run.said.clear();
    }
    let sid = session_id.to_string();
    tokio::spawn(async move { clear_digest(&sid).await });
}

/// Called for every mapped event of a session before it is emitted and logged.
pub async fn observe(session_id: &str, event: &mut AgentEvent, app: &AppHandle) {
    if event.subagent.is_some() {
        return;
    }
    let (report, said) = {
        let mut runs = RUNS.lock().expect("runs poisoned");
        let run = runs.entry(session_id.to_string()).or_default();
        let report = run.feed(&event.payload, event.seq, now_ms());
        let said = if report.is_some() { run.said.clone() } else { Vec::new() };
        (report, said)
    };
    let Some(report) = report else { return };
    let agent = crate::agents::agent_of(session_id);

    let mut model = None;
    let mut tokens = (0, 0);
    if let AgentEventPayload::TurnCompleted { usage, duration_ms, .. } = &mut event.payload {
        duration_ms.get_or_insert(report.turn_ms);
        if let Some(u) = usage.as_mut() {
            let name = u.model.clone().or_else(|| agent.as_ref().and_then(|a| a.model_id.clone())).unwrap_or_default();
            if u.cost_usd.is_none() {
                if let Some(step) = estimate_usd(&name, u) {
                    let mut all = ESTIMATES.lock().expect("estimates poisoned");
                    let total = all.entry(session_id.to_string()).or_default();
                    *total += step;
                    u.cost_usd = Some(*total);
                }
            }
            tokens = (u.input_tokens.unwrap_or(0), u.output_tokens.unwrap_or(0));
            model = Some(name);
        }
    }

    let line = json!({
        "session": session_id,
        "seq": event.seq,
        "at": now_ms(),
        "agent": agent.as_ref().map(|a| a.id.clone()),
        "model": model,
        "input": tokens.0,
        "output": tokens.1,
        "report": report,
    });
    if let Some(p) = path("timings.jsonl").await {
        let text = line.to_string();
        let _ = tokio::task::spawn_blocking(move || timings::append_ring(&p, &text, timings::RING_KEEP)).await;
    }

    digest_after(session_id, &said, app).await;
    if let Some(agent) = agent.filter(|a| a.session_id.as_deref() == Some(session_id)) {
        offer_after(&agent.id, session_id, app).await;
    }
}

/// What the sidebar shows for a session whose messages are unread.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestLine {
    pub session_id: String,
    pub line: String,
    /// The newest message the line covers.
    pub seq: u64,
}

async fn digest_after(session_id: &str, said: &[digest::Msg], app: &AppHandle) {
    let Some(p) = path("digests.json").await else { return };
    let made = digest::needs_digest(said).then(|| digest::local_line(said)).filter(|l| !l.is_empty());
    {
        let _g = FILES.lock().expect("files poisoned");
        let mut store: digest::Store = read(&p);
        match (&made, said.last()) {
            (Some(line), Some(newest)) => digest::apply(&mut store, session_id, &newest.id, line),
            _ => {
                if store.remove(session_id).is_none() {
                    return;
                }
            }
        }
        write(&p, &store);
    }
    let seq = said.last().and_then(|m| m.id.parse().ok()).unwrap_or(0);
    let _ = app.emit("agent_digest", DigestLine { session_id: session_id.into(), line: made.unwrap_or_default(), seq });
}

async fn clear_digest(session_id: &str) {
    let Some(p) = path("digests.json").await else { return };
    let _g = FILES.lock().expect("files poisoned");
    let mut store: digest::Store = read(&p);
    if store.remove(session_id).is_some() {
        write(&p, &store);
    }
}

/// The digest lines kept for these sessions; the sidebar draws one only while its row is unread.
#[tauri::command]
pub async fn kit_digests(session_ids: Vec<String>) -> Vec<DigestLine> {
    let Some(p) = path("digests.json").await else { return Vec::new() };
    let store: digest::Store = read(&p);
    session_ids
        .into_iter()
        .filter_map(|id| {
            let d = store.get(&id)?;
            Some(DigestLine { line: d.line.clone(), seq: d.newest_id.parse().unwrap_or(0), session_id: id })
        })
        .collect()
}

/// A routine hz offers once, waiting on the reader's answer.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub task: String,
    pub weekday: Option<u32>,
    pub minute_of_day: u32,
    /// The words the reader used last time, sent as the routine's prompt.
    pub prompt: String,
    /// The card's sentence.
    pub line: String,
    pub at_ms: u64,
}

impl Offer {
    fn suggestion(&self) -> routine_suggest::Suggestion {
        routine_suggest::Suggestion { task: self.task.clone(), weekday: self.weekday, minute_of_day: self.minute_of_day }
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Offers {
    /// Agent id to its open offer.
    open: HashMap<String, Offer>,
    /// `agent \u{1f} task` to the reader's last words for it.
    words: HashMap<String, String>,
}

fn words_key(agent: &str, task: &str) -> String {
    format!("{agent}\u{1f}{task}")
}

/// A request is worth remembering when it names a task in two words or more; "thanks" is not one.
fn task_of(text: &str) -> Option<String> {
    let t = routine_suggest::task_name_fallback(text);
    (t.split_whitespace().count() >= 2).then_some(t)
}

async fn note_request(agent_id: &str, text: &str) {
    let Some(task) = task_of(text) else { return };
    let (Some(sig), Some(off)) = (path("routine-signatures.json").await, path("routine-offers.json").await) else { return };
    let _g = FILES.lock().expect("files poisoned");
    let mut store = routine_suggest::load(&sig);
    if routine_suggest::record_in(&mut store, agent_id, &task, Local::now().naive_local(), routine_suggest::Origin::User) {
        let _ = routine_suggest::save(&store, &sig);
        let mut offers: Offers = read(&off);
        offers.words.insert(words_key(agent_id, &task), text.trim().chars().take(2000).collect());
        write(&off, &offers);
    }
}

async fn offer_after(agent_id: &str, session_id: &str, app: &AppHandle) {
    let (Some(sig), Some(off)) = (path("routine-signatures.json").await, path("routine-offers.json").await) else { return };
    let offer = {
        let _g = FILES.lock().expect("files poisoned");
        let mut offers: Offers = read(&off);
        if offers.open.contains_key(agent_id) {
            return;
        }
        let mut store = routine_suggest::load(&sig);
        let Some(s) = routine_suggest::suggest(&mut store, agent_id, Local::now().naive_local()) else { return };
        let _ = routine_suggest::save(&store, &sig);
        let prompt = offers.words.get(&words_key(agent_id, &s.task)).cloned().unwrap_or_else(|| s.task.clone());
        let offer = Offer { line: s.describe(), task: s.task, weekday: s.weekday, minute_of_day: s.minute_of_day, prompt, at_ms: now_ms() };
        offers.open.insert(agent_id.to_string(), offer.clone());
        write(&off, &offers);
        offer
    };
    let _ = app.emit("routine_offer", json!({ "agentId": agent_id, "sessionId": session_id, "offer": offer }));
}

/// The routine hz is offering this agent, if any.
#[tauri::command]
pub async fn kit_routine_offer(agent_id: String) -> Option<Offer> {
    let off = path("routine-offers.json").await?;
    read::<Offers>(&off).open.get(&agent_id).cloned()
}

/// What the routine made from an accepted offer looks like.
pub fn routine_for(agent_id: &str, offer: &Offer, s: &routine_suggest::Schedule) -> crate::automations::RoutineInput {
    let mut name = offer.task.clone();
    if let Some(c) = name.get(..1) {
        name = c.to_uppercase() + &name[1..];
    }
    crate::automations::RoutineInput {
        id: None,
        name,
        agent_id: agent_id.to_string(),
        trigger: crate::automations::Trigger::Schedule {
            days: s.weekday.map_or_else(|| (0..7).collect(), |w| vec![w as u8]),
            time: format!("{:02}:{:02}", s.minute_of_day / 60, s.minute_of_day % 60),
            tz: "local".into(),
        },
        act: offer.task.clone(),
        prompt: offer.prompt.clone(),
        to: "agent_chat".into(),
        quiet: false,
        on: true,
        secret: None,
    }
}

/// Answers an offer: `yes`, `time` (with `time` as "HH:MM"), `no` (never again for this task) or
/// `dismiss` (gone for now; it was already offered once, so it does not come back). Yes and time
/// make the routine and answer it.
#[tauri::command]
pub async fn kit_routine_answer(app: AppHandle, agent_id: String, answer: String, time: Option<String>) -> Result<Option<Value>, String> {
    let (Some(sig), Some(off)) = (path("routine-signatures.json").await, path("routine-offers.json").await) else { return Err("no app folder".into()) };
    let (offer, schedule) = {
        let _g = FILES.lock().expect("files poisoned");
        let mut offers: Offers = read(&off);
        let offer = offers.open.get(&agent_id).cloned().ok_or("nothing is on offer")?;
        let a = match answer.as_str() {
            "yes" => routine_suggest::Answer::Yes,
            "time" => routine_suggest::Answer::OtherTime(time.unwrap_or_default()),
            "no" => routine_suggest::Answer::No,
            _ => routine_suggest::Answer::No,
        };
        let mut store = routine_suggest::load(&sig);
        let schedule = if answer == "dismiss" { None } else { routine_suggest::answer(&mut store, &agent_id, &offer.suggestion(), a)? };
        let _ = routine_suggest::save(&store, &sig);
        offers.open.remove(&agent_id);
        write(&off, &offers);
        (offer, schedule)
    };
    let Some(s) = schedule else { return Ok(None) };
    let routine = crate::automations::routine_save(app, routine_for(&agent_id, &offer, &s)).await.map_err(|e| format!("{e:?}"))?;
    serde_json::to_value(routine).map(Some).map_err(|e| e.to_string())
}

/// The light-and-strong brain of one agent, as saved.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrainState {
    /// `None` runs the model the reader picked, untouched.
    pub mode: Option<rotation::Mode>,
    pub turbo_until: Option<i64>,
    pub last_heavy_at: Option<i64>,
    /// The size the last request ran on.
    pub strong: bool,
}

fn at(ts: Option<i64>) -> Option<DateTime<Utc>> {
    ts.and_then(|t| DateTime::from_timestamp(t, 0))
}

impl BrainState {
    fn rotation(&self, mode: rotation::Mode) -> rotation::Rotation {
        rotation::Rotation {
            mode,
            turbo_until: at(self.turbo_until),
            last_heavy_at: at(self.last_heavy_at),
            level: if self.strong { rotation::Level::Strong } else { rotation::Level::Light },
        }
    }

    fn keep(&mut self, r: &rotation::Rotation) {
        self.mode = Some(r.mode);
        self.turbo_until = r.turbo_until.map(|t| t.timestamp());
        self.last_heavy_at = r.last_heavy_at.map(|t| t.timestamp());
        self.strong = r.level == rotation::Level::Strong;
    }
}

/// Which engines the brain can move: Claude by model, Codex by effort. OpenCode's models are each
/// provider's own, with no light or strong to name.
pub fn brain_of(harness: Harness) -> Option<rotation::Brain> {
    match harness {
        Harness::Claude => Some(rotation::Brain::Claude),
        Harness::Codex => Some(rotation::Brain::Codex),
        _ => None,
    }
}

/// The model and effort a level puts this engine on, starting from what the send carried.
pub fn apply_level(brain: rotation::Brain, level: rotation::Level, model: ModelId, effort: Option<Effort>) -> (ModelId, Option<Effort>) {
    let (mut model, mut effort) = (model, effort);
    for (key, value) in rotation::settings_for(brain, level, model.as_str()) {
        match key.as_str() {
            "model" => model = ModelId::new(value),
            "reasoning_effort" => effort = serde_json::from_value(Value::String(value)).ok().or(effort),
            _ => {}
        }
    }
    (model, effort)
}

/// Picks this prompt's model and effort when the agent's brain rotates; otherwise hands them back.
/// Never moves a session with a turn open, since swapping brains mid-request drops its context.
pub async fn pick(session_id: &str, agent_id: Option<&str>, harness: Harness, prompt: &str, model: ModelId, effort: Option<Effort>) -> (ModelId, Option<Effort>) {
    let Some(brain) = brain_of(harness) else { return (model, effort) };
    let Some(agent_id) = agent_id.map(str::to_string).or_else(|| crate::agents::agent_of(session_id).map(|a| a.id)) else { return (model, effort) };
    let Some(p) = path("rotation.json").await else { return (model, effort) };
    let in_request = RUNS.lock().expect("runs poisoned").get(session_id).is_some_and(|r| r.open);
    let level = {
        let _g = FILES.lock().expect("files poisoned");
        let mut all: HashMap<String, BrainState> = read(&p);
        let Some(saved) = all.get_mut(&agent_id) else { return (model, effort) };
        let Some(mode) = saved.mode else { return (model, effort) };
        let mut r = saved.rotation(mode);
        let level = rotation::decide(&mut r, prompt, Utc::now(), in_request);
        saved.keep(&r);
        write(&p, &all);
        level
    };
    apply_level(brain, level, model, effort)
}

/// An agent's brain setting.
#[tauri::command]
pub async fn kit_brain_get(agent_id: String) -> BrainState {
    let Some(p) = path("rotation.json").await else { return BrainState::default() };
    read::<HashMap<String, BrainState>>(&p).remove(&agent_id).unwrap_or_default()
}

/// Sets the brain mode (`light`, `strong`, `rotate`, or null to follow the picked model) and turbo,
/// which holds the strong brain for an hour from now.
#[tauri::command]
pub async fn kit_brain_set(agent_id: String, mode: Option<rotation::Mode>, turbo: Option<bool>) -> Result<BrainState, String> {
    let p = path("rotation.json").await.ok_or("no app folder")?;
    let _g = FILES.lock().expect("files poisoned");
    let mut all: HashMap<String, BrainState> = read(&p);
    let s = all.entry(agent_id).or_default();
    s.mode = mode;
    match turbo {
        Some(true) => s.turbo_until = Some((Utc::now() + chrono::Duration::hours(rotation::TURBO_HOURS)).timestamp()),
        Some(false) => s.turbo_until = None,
        None => {}
    }
    let out = s.clone();
    write(&p, &all);
    Ok(out)
}

/// One step of the scripted first chat, in the webview's shape.
fn step_json(s: onboarding::Step) -> Value {
    let effects: Vec<Value> = s
        .effects
        .into_iter()
        .map(|e| match e {
            onboarding::Effect::SetJob(v) => json!({"kind": "job", "value": v}),
            onboarding::Effect::SetLabel(v) => json!({"kind": "label", "value": v}),
            onboarding::Effect::SetName(v) => json!({"kind": "name", "value": v}),
        })
        .collect();
    let done = match &s.state {
        onboarding::State::Done { task } => Some(task.clone()),
        _ => None,
    };
    json!({"agentText": s.agent_text, "choices": s.choices, "effects": effects, "state": s.state, "done": done.is_some(), "task": done.flatten()})
}

/// The opening of a new agent's first chat.
#[tauri::command]
pub fn kit_onboarding_start() -> Value {
    step_json(onboarding::Onboarding::start())
}

/// Moves the first chat on by the reader's reply.
#[tauri::command]
pub fn kit_onboarding_next(state: onboarding::State, input: String) -> Value {
    step_json(onboarding::Onboarding::next(&state, &input))
}

/// The newest run timings, oldest first; one session's only when `session_id` is given.
#[tauri::command]
pub async fn kit_timings(session_id: Option<String>, limit: Option<usize>) -> Vec<Value> {
    let Some(p) = path("timings.jsonl").await else { return Vec::new() };
    let lines = tokio::task::spawn_blocking(move || timings::recent(&p, timings::RING_KEEP)).await.unwrap_or_default();
    let mut out: Vec<Value> = lines
        .iter()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| session_id.as_deref().is_none_or(|s| v["session"].as_str() == Some(s)))
        .collect();
    let keep = limit.unwrap_or(100);
    if out.len() > keep {
        out.drain(..out.len() - keep);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{SessionInfo, ToolResult, ToolType, TurnStatus};

    fn started() -> AgentEventPayload {
        AgentEventPayload::TurnStarted(SessionInfo {
            cwd: None,
            model: None,
            harness_version: None,
            tools: Vec::new(),
            mcp_servers: Vec::new(),
            subagent_types: Vec::new(),
            settings: None,
        })
    }

    fn call(id: &str) -> AgentEventPayload {
        AgentEventPayload::ToolCallStarted {
            call_id: id.into(),
            name: "Bash".into(),
            tool_type: ToolType::Shell,
            input: json!({}),
            raw_input: None,
            title: None,
        }
    }

    fn done(id: &str) -> AgentEventPayload {
        AgentEventPayload::ToolCallCompleted {
            call_id: id.into(),
            result: ToolResult { text: String::new(), is_error: false, structured: None, exit_code: None, duration_ms: None, images: Vec::new() },
        }
    }

    fn said(text: &str) -> AgentEventPayload {
        AgentEventPayload::AssistantText { block: None, text: text.into() }
    }

    fn completed() -> AgentEventPayload {
        AgentEventPayload::TurnCompleted {
            status: TurnStatus::Success,
            stop_reason: None,
            auth_failed: false,
            final_text: None,
            usage: None,
            duration_ms: None,
            head: None,
        }
    }

    #[test]
    fn a_run_times_itself_from_the_prompt_and_splits_tools_from_the_model() {
        let mut r = Run::default();
        r.begin(1_000);
        assert!(r.feed(&started(), 1, 3_000).is_none());
        r.feed(&call("a"), 2, 4_000);
        r.feed(&done("a"), 3, 6_500);
        r.feed(&said("All done here"), 4, 7_000);
        let rep = r.feed(&completed(), 5, 8_000).expect("the turn closes");
        assert_eq!(rep.turn_ms, 7_000);
        assert_eq!(rep.tool_ms, 2_500);
        assert_eq!(rep.model_ms, 4_500);
        assert_eq!(rep.first_output_ms, Some(6_000));
        assert_eq!(rep.tools["Bash"], 2_500);
        assert_eq!(r.said.len(), 1);
        assert!(!r.open);
    }

    #[test]
    fn a_queued_prompt_does_not_restart_the_clock() {
        let mut r = Run::default();
        r.begin(0);
        r.begin(5_000);
        assert_eq!(r.feed(&completed(), 1, 9_000).unwrap().turn_ms, 9_000);
    }

    #[test]
    fn a_turn_with_tokens_and_no_reported_cost_is_estimated() {
        let u = Usage { input_tokens: Some(1_000_000), output_tokens: Some(0), ..Default::default() };
        assert_eq!(estimate_usd("gpt-5", &u), Some(1.25));
        assert_eq!(estimate_usd("mystery-model", &u), None);
        assert_eq!(estimate_usd("gpt-5", &Usage::default()), None);
    }

    #[test]
    fn requests_name_a_task_in_two_words_or_more() {
        assert_eq!(task_of("Please check my email").as_deref(), Some("check email"));
        assert!(task_of("thanks!").is_none());
        assert!(task_of("hi").is_none());
    }

    #[test]
    fn an_accepted_offer_becomes_a_schedule_in_the_agents_chat() {
        let offer = Offer { task: "check email".into(), weekday: None, minute_of_day: 545, prompt: "check my email please".into(), ..Default::default() };
        let s = routine_suggest::Schedule { task: offer.task.clone(), weekday: None, minute_of_day: 545 };
        let r = routine_for("a1", &offer, &s);
        assert_eq!(r.name, "Check email");
        assert_eq!(r.prompt, "check my email please");
        assert_eq!(r.to, "agent_chat");
        match r.trigger {
            crate::automations::Trigger::Schedule { days, time, tz } => {
                assert_eq!(days, vec![0, 1, 2, 3, 4, 5, 6]);
                assert_eq!((time.as_str(), tz.as_str()), ("09:05", "local"));
            }
            _ => panic!("a schedule"),
        }
        let monday = routine_suggest::Schedule { weekday: Some(0), ..s };
        assert!(matches!(routine_for("a1", &offer, &monday).trigger, crate::automations::Trigger::Schedule { ref days, .. } if days == &vec![0]));
    }

    #[test]
    fn the_brain_moves_claude_by_model_and_codex_by_effort() {
        let (m, e) = apply_level(rotation::Brain::Claude, rotation::Level::Strong, ModelId::new("sonnet"), Some(Effort::Medium));
        assert_eq!((m.as_str(), e), ("opus", Some(Effort::Medium)));
        let (m, e) = apply_level(rotation::Brain::Codex, rotation::Level::Light, ModelId::new("gpt-6.1-sol"), Some(Effort::High));
        assert_eq!((m.as_str(), e), ("gpt-6.1-sol", Some(Effort::Low)));
        assert!(brain_of(Harness::OpenCode).is_none());
    }

    #[test]
    fn the_saved_brain_round_trips_through_a_decision() {
        let mut s = BrainState { mode: Some(rotation::Mode::Rotate), ..Default::default() };
        let mut r = s.rotation(rotation::Mode::Rotate);
        let now = Utc::now();
        assert_eq!(rotation::decide(&mut r, "plan the launch", now, false), rotation::Level::Strong);
        s.keep(&r);
        assert!(s.strong);
        assert_eq!(s.last_heavy_at, Some(now.timestamp()));
        assert_eq!(rotation::decide(&mut s.rotation(rotation::Mode::Rotate), "ok", now, true), rotation::Level::Strong, "never mid-request");
    }

    #[test]
    fn onboarding_steps_reach_the_webview_with_their_effects() {
        let first = kit_onboarding_start();
        assert_eq!(first["choices"].as_array().unwrap().len(), 4);
        let next = kit_onboarding_next(serde_json::from_value(first["state"].clone()).unwrap(), "Code and projects".into());
        assert_eq!(next["effects"][0]["kind"], "job");
        assert_eq!(next["effects"][1], json!({"kind": "label", "value": "Code and projects"}));
        let named = kit_onboarding_next(serde_json::from_value(next["state"].clone()).unwrap(), "Ada".into());
        let last = kit_onboarding_next(serde_json::from_value(named["state"].clone()).unwrap(), "Fix the bug".into());
        assert_eq!((last["done"].as_bool(), last["task"].as_str()), (Some(true), Some("Fix the bug")));
    }
}
