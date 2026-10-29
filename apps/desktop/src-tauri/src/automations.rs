//! Routines: an agent does something on its own, on a clock or when a service calls.
//!
//! The file keeps its old name and path (`automations.json`) so a reader's data
//! survives the rename of the idea; [`read_from`] upgrades the old shape in place.
//!
//! **There is no daemon, and that is the design rather than a shortcut.** A
//! routine runs while hz is open: the poll is a task in this process, and closing
//! the app stops it, as does the webhook listener. The alternative is a launch
//! agent, which is a second thing installed on the reader's machine and a prompt
//! that would run with every surface that could show the result closed.
//!
//! **Missed runs are skipped, not caught up.** A reader who closes the app for a
//! week gets no replay of it: the next time is always measured from *now*. A
//! morning digest that fires at 15:00 because the laptop was shut at 08:00 is
//! worse than none, so an occurrence more than [`GRACE`] late is dropped.
//!
//! **One run per due moment, and the claim is what makes it one.** The check and
//! the advance happen under one hold of the store's lock, so a second poll
//! arriving while the first is still starting runs finds the times already moved.
//!
//! Running them lives in [`crate::routines`], the webhook listener in
//! [`crate::routine_hooks`]; this file is the record and its clock.

use anyhow::{bail, Context, Result};
use chrono::{
    DateTime, Datelike, Duration, FixedOffset, Local, NaiveDate, SecondsFormat, TimeZone, Timelike,
    Utc,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::{fs, sync::Mutex};
use ts_rs::TS;
use uuid::Uuid;

use crate::{models::ModelId, store::get_home_app_dir, Fail};

/// How often the app looks.
pub const POLL: std::time::Duration = std::time::Duration::from_secs(30);

/// How late an occurrence may be and still run. Two polls of slack; beyond it the
/// app was closed or asleep and the moment is dropped.
pub const GRACE: Duration = Duration::minutes(10);

/// Runs kept per routine. The file is rewritten whole on every change.
pub const MAX_RUNS: usize = 40;

/// How long a deleted routine stays recoverable before the poll drops it.
const TOMBSTONE: Duration = Duration::hours(24);

/// Every read and write of the file goes through this.
static LOCK: Mutex<()> = Mutex::const_new(());

const FILE: &str = "automations.json";

/// The Tauri event the webview refetches on.
pub const CHANGED: &str = "routines_changed";

/// What starts a routine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Trigger {
    /// `days` are 0 (Monday) to 6 (Sunday), `time` is `HH:MM` and `tz` is
    /// `local`, `UTC` or a fixed offset like `-03:00`. No IANA names: they need a
    /// timezone database this build does not carry, and `local` already follows
    /// the machine through daylight saving.
    Schedule { days: Vec<u8>, time: String, tz: String },
    /// A service calling the local endpoint. `source` is GitHub, Stripe, Linear,
    /// Sentry or Custom; `event` is the name the source gives it.
    Webhook { source: String, event: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Ok,
    Fail,
}

/// One run, kept on the routine.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    /// When it started, RFC 3339 UTC.
    pub at: String,
    pub status: RunStatus,
    pub duration_ms: u64,
    /// This turn's share of the session's cost, in dollars. `None` when the CLI
    /// did not report one; never shown as zero.
    pub cost: Option<f64>,
    /// The first part of the answer, for the sheet.
    pub output_excerpt: String,
    pub error: Option<String>,
    /// `schedule`, `manual`, or `webhook: <event>`.
    #[serde(default)]
    pub via: String,
    /// Where the result went, in words: what happened, including what could not.
    #[serde(default)]
    pub delivery: Option<String>,
    /// Whether the agent flagged something needing the person.
    #[serde(default)]
    pub needs_you: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Routine {
    pub id: String,
    pub name: String,
    /// The roster agent whose one conversation answers. Empty only for a routine
    /// made before agents, which still runs as its own session.
    #[serde(default)]
    pub agent_id: String,
    pub trigger: Trigger,
    /// What it does, in a few words, for the sentence.
    #[serde(default)]
    pub act: String,
    /// Sent as the prompt, as written.
    pub prompt: String,
    /// `agent_chat`, `channel:<id>`, `inbox` or `pr_comment`.
    #[serde(default = "default_to")]
    pub to: String,
    /// No notification unless the answer flags something for the person.
    #[serde(default)]
    pub quiet: bool,
    #[serde(default = "yes")]
    pub on: bool,
    /// When a schedule is next due, RFC 3339 UTC. `None` for a webhook.
    #[serde(default)]
    pub next_run_at: Option<String>,
    /// Dates (`YYYY-MM-DD` in the routine's zone) whose run was skipped by hand.
    #[serde(default)]
    pub skipped: Vec<String>,
    /// Newest last.
    #[serde(default)]
    pub runs: Vec<RunRecord>,
    /// The webhook's signing secret.
    #[serde(default)]
    pub secret: Option<String>,
    #[serde(default)]
    pub created_at: String,
    /// Set on delete; the poll drops the record after a day. Never listed.
    #[serde(default)]
    pub deleted_at: Option<String>,
    /// From before agents: the folder and model of the session each run opened.
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub model: Option<ModelId>,
    /// From before day-and-time schedules. While set, the routine keeps its
    /// interval; saving it in the editor clears this and the clock takes over.
    #[serde(default)]
    pub legacy_every_minutes: Option<u32>,
    /// Every key this build does not know, carried through untouched, so a build
    /// that round-trips the file does not drop what a later one added.
    #[serde(flatten)]
    #[ts(flatten)]
    pub unknown: serde_json::Map<String, Value>,
}

fn default_to() -> String {
    "agent_chat".into()
}

fn yes() -> bool {
    true
}

/// The editable part of a routine, as the editor sends it.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct RoutineInput {
    pub id: Option<String>,
    pub name: String,
    pub agent_id: String,
    pub trigger: Trigger,
    pub act: String,
    pub prompt: String,
    pub to: String,
    pub quiet: bool,
    pub on: bool,
    /// The signing secret the reader sees and pastes into the other service.
    /// `None` keeps the stored one (or makes one for a new webhook).
    #[serde(default)]
    pub secret: Option<String>,
}

// --- Clock ------------------------------------------------------------------

/// A zone a schedule is read in.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Zone {
    Local,
    Fixed(FixedOffset),
}

/// `local`, `UTC`/`Z`, or `+HH:MM`/`-HH:MM`. Anything else reads as `local`, the
/// safe direction: a routine still runs, on the machine's clock.
fn zone(tz: &str) -> Zone {
    let tz = tz.trim();
    if tz.eq_ignore_ascii_case("utc") || tz == "Z" {
        return Zone::Fixed(FixedOffset::east_opt(0).expect("zero offset"));
    }
    let sign = match tz.chars().next() {
        Some('+') => 1,
        Some('-') => -1,
        _ => return Zone::Local,
    };
    let Some((h, m)) = tz[1..].split_once(':') else { return Zone::Local };
    let (Ok(h), Ok(m)) = (h.parse::<i32>(), m.parse::<i32>()) else { return Zone::Local };
    FixedOffset::east_opt(sign * (h * 3600 + m * 60)).map_or(Zone::Local, Zone::Fixed)
}

/// `HH:MM` to (hour, minute), `None` for anything else.
pub fn parse_time(time: &str) -> Option<(u32, u32)> {
    let (h, m) = time.trim().split_once(':')?;
    let (h, m) = (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?);
    (h < 24 && m < 60).then_some((h, m))
}

fn walk<Tz: TimeZone>(
    tz: Tz,
    days: &[u8],
    (hour, minute): (u32, u32),
    after: DateTime<Utc>,
    skipped: &[String],
) -> Option<DateTime<Utc>> {
    let first: NaiveDate = after.with_timezone(&tz).date_naive();
    // A fortnight reaches any weekday twice, which covers a skipped date.
    for ahead in 0..15 {
        let date = first + Duration::days(ahead);
        if !days.contains(&(date.weekday().num_days_from_monday() as u8)) {
            continue;
        }
        if skipped.contains(&date.to_string()) {
            continue;
        }
        // `earliest` is the first of two readings in the hour clocks repeat. A
        // time inside the hour they skip has none: that day is passed over.
        let Some(at) = tz
            .from_local_datetime(&date.and_hms_opt(hour, minute, 0)?)
            .earliest()
            .map(|d| d.with_timezone(&Utc))
        else {
            continue;
        };
        if at > after {
            return Some(at);
        }
    }
    None
}

/// The first moment after `after` that falls on one of `days` at `time`, not on
/// a skipped date. `None` for a schedule with no days or an unreadable time.
pub fn next_after(
    days: &[u8],
    time: &str,
    tz: &str,
    after: DateTime<Utc>,
    skipped: &[String],
) -> Option<DateTime<Utc>> {
    let clock = parse_time(time)?;
    match zone(tz) {
        Zone::Local => walk(Local, days, clock, after, skipped),
        Zone::Fixed(offset) => walk(offset, days, clock, after, skipped),
    }
}

/// The date a moment falls on in `tz`, the way `skipped` spells it.
pub fn date_in(tz: &str, at: DateTime<Utc>) -> String {
    match zone(tz) {
        Zone::Local => at.with_timezone(&Local).date_naive().to_string(),
        Zone::Fixed(offset) => at.with_timezone(&offset).date_naive().to_string(),
    }
}

fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn parse(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw).ok().map(|at| at.with_timezone(&Utc))
}

impl Routine {
    /// When this is next due after `after`, if it is a schedule that is on.
    pub fn next_due(&self, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
        if !self.on {
            return None;
        }
        if let Some(every) = self.legacy_every_minutes {
            return Some(after + Duration::minutes(every as i64));
        }
        match &self.trigger {
            Trigger::Schedule { days, time, tz } => next_after(days, time, tz, after, &self.skipped),
            Trigger::Webhook { .. } => None,
        }
    }

    fn live(&self) -> bool {
        self.deleted_at.is_none()
    }
}

/// What a claim at `now` does to one routine: nothing, run it, or drop a stale
/// occurrence. Pure, so the three cases are testable without a file.
#[derive(Debug, PartialEq)]
pub enum Claim {
    Nothing,
    Run,
    /// Due, but too late or skipped by hand: advance without running.
    Drop,
}

pub fn claim_of(routine: &Routine, now: DateTime<Utc>) -> Claim {
    if !routine.on || !routine.live() || !matches!(routine.trigger, Trigger::Schedule { .. }) {
        return Claim::Nothing;
    }
    let Some(due) = routine.next_run_at.as_deref().and_then(parse) else {
        // No readable stamp: given one on the next advance rather than run now,
        // which would fire every routine the first poll after an upgrade.
        return Claim::Drop;
    };
    if due > now {
        return Claim::Nothing;
    }
    let tz = match &routine.trigger {
        Trigger::Schedule { tz, .. } => tz.as_str(),
        Trigger::Webhook { .. } => "local",
    };
    if routine.legacy_every_minutes.is_none() && now - due > GRACE {
        return Claim::Drop;
    }
    if routine.skipped.contains(&date_in(tz, due)) {
        return Claim::Drop;
    }
    Claim::Run
}

/// The routine as a claim at `now` leaves it: the next time found, and skipped
/// dates that are behind it forgotten.
fn advance(routine: &mut Routine, now: DateTime<Utc>) {
    let tz = match &routine.trigger {
        Trigger::Schedule { tz, .. } => tz.clone(),
        Trigger::Webhook { .. } => "local".into(),
    };
    let today = date_in(&tz, now);
    routine.skipped.retain(|d| d.as_str() >= today.as_str());
    routine.next_run_at = routine.next_due(now).map(stamp);
}

// --- Store ------------------------------------------------------------------

async fn file() -> Result<PathBuf> {
    Ok(get_home_app_dir().await?.join(FILE))
}

/// Everything not deleted.
pub async fn list() -> Result<Vec<Routine>> {
    Ok(read_from(&file().await?).await?.into_iter().filter(Routine::live).collect())
}

/// One routine by id, deleted or not.
pub async fn get(id: &str) -> Result<Option<Routine>> {
    Ok(read_from(&file().await?).await?.into_iter().find(|r| r.id == id))
}

/// Takes the schedules due right now, advances each, and answers the ones to run.
///
/// **The claim is the exactly-once.** Read, decide and write happen under one
/// hold of [`LOCK`]. The run starts *after* the lock is dropped, because it is
/// slow and allowed to fail: a run that fails to start has still happened, and
/// retrying on the next poll would be the double-run this exists to prevent.
pub async fn claim_due(now: DateTime<Utc>) -> Result<Vec<Routine>> {
    claim_at(&file().await?, now).await
}

async fn claim_at(path: &Path, now: DateTime<Utc>) -> Result<Vec<Routine>> {
    let _guard = LOCK.lock().await;
    let mut all = read_from(path).await?;
    let mut claimed = Vec::new();
    let mut changed = false;

    for routine in all.iter_mut() {
        match claim_of(routine, now) {
            Claim::Nothing => {}
            Claim::Drop => {
                advance(routine, now);
                changed = true;
            }
            Claim::Run => {
                advance(routine, now);
                claimed.push(routine.clone());
                changed = true;
            }
        }
    }

    let before = all.len();
    all.retain(|r| {
        r.deleted_at.as_deref().and_then(parse).is_none_or(|at| now - at < TOMBSTONE)
    });
    if all.len() != before {
        changed = true;
    }

    if changed {
        write_to(path, &all).await?;
    }
    Ok(claimed)
}

/// Creates or updates from the editor's fields, and answers the saved routine.
pub async fn save(input: RoutineInput) -> Result<Routine> {
    save_at(&file().await?, input, Utc::now()).await
}

async fn save_at(path: &Path, input: RoutineInput, now: DateTime<Utc>) -> Result<Routine> {
    if input.prompt.trim().is_empty() {
        bail!("a routine needs a prompt");
    }
    if let Trigger::Schedule { days, time, .. } = &input.trigger {
        if days.is_empty() || days.iter().any(|d| *d > 6) {
            bail!("pick at least one day");
        }
        parse_time(time).with_context(|| format!("{time:?} is not a time"))?;
    }

    let _guard = LOCK.lock().await;
    let mut all = read_from(path).await?;

    let name = if input.name.trim().is_empty() {
        // The first line of what it does, which is what it is about. Better than
        // "Untitled", which names nothing and collides with every other one.
        let from = if input.act.trim().is_empty() { input.prompt.as_str() } else { input.act.as_str() };
        from.lines().next().unwrap_or_default().trim().chars().take(60).collect()
    } else {
        input.name.trim().to_string()
    };

    let existing = input.id.as_deref().and_then(|id| all.iter().position(|r| r.id == id));
    let mut routine = match existing {
        Some(at) => all[at].clone(),
        None => Routine {
            // The editor names a new routine's id up front: the webhook address
            // it prints has to be the one the saved routine answers on.
            id: input.id.clone().unwrap_or_else(|| Uuid::now_v7().to_string()),
            name: String::new(),
            agent_id: String::new(),
            trigger: input.trigger.clone(),
            act: String::new(),
            prompt: String::new(),
            to: default_to(),
            quiet: true,
            on: true,
            next_run_at: None,
            skipped: Vec::new(),
            runs: Vec::new(),
            secret: None,
            created_at: stamp(now),
            deleted_at: None,
            project_path: None,
            model: None,
            legacy_every_minutes: None,
            unknown: serde_json::Map::new(),
        },
    };

    let moved = routine.trigger != input.trigger || routine.on != input.on;
    routine.name = name;
    routine.agent_id = input.agent_id;
    routine.trigger = input.trigger;
    routine.act = input.act.trim().to_string();
    routine.prompt = input.prompt;
    routine.to = input.to;
    routine.quiet = input.quiet;
    routine.on = input.on;

    if moved || existing.is_none() {
        // The clock takes over from a legacy interval the moment the reader
        // saves what they see, and dates skipped for the old schedule are void.
        routine.legacy_every_minutes = None;
        routine.skipped.clear();
        routine.next_run_at = routine.next_due(now).map(stamp);
    }
    if matches!(routine.trigger, Trigger::Webhook { .. }) {
        routine.next_run_at = None;
        if let Some(secret) = input.secret.filter(|s| !s.trim().is_empty()) {
            routine.secret = Some(secret.trim().to_string());
        }
        routine.secret.get_or_insert_with(new_secret);
    }

    match existing {
        Some(at) => all[at] = routine.clone(),
        None => all.push(routine.clone()),
    }
    write_to(path, &all).await?;
    Ok(routine)
}

/// A signing secret: 244 bits from two v4 UUIDs, which are random rather than
/// time-ordered like the v7 ids.
pub fn new_secret() -> String {
    format!("whsec_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// Applies `change` to one routine under the lock and writes the file.
async fn edit(id: &str, change: impl FnOnce(&mut Routine)) -> Result<Routine> {
    let _guard = LOCK.lock().await;
    let path = file().await?;
    let mut all = read_from(&path).await?;
    let routine = all.iter_mut().find(|r| r.id == id).context("no such routine")?;
    change(routine);
    let done = routine.clone();
    write_to(&path, &all).await?;
    Ok(done)
}

/// Pauses or resumes. Resuming measures the next time from now, so a routine
/// paused for a month does not look overdue.
pub async fn set_on(id: &str, on: bool) -> Result<Routine> {
    edit(id, |r| {
        r.on = on;
        r.next_run_at = if on {
            // A legacy interval was due the moment it was switched on.
            if r.legacy_every_minutes.is_some() {
                Some(stamp(Utc::now()))
            } else {
                r.next_due(Utc::now()).map(stamp)
            }
        } else {
            None
        };
    })
    .await
}

/// Soft delete: the record stays a day so Undo has something to bring back.
pub async fn delete(id: &str) -> Result<()> {
    edit(id, |r| {
        r.deleted_at = Some(stamp(Utc::now()));
    })
    .await
    .map(drop)
}

pub async fn restore(id: &str) -> Result<Routine> {
    edit(id, |r| {
        r.deleted_at = None;
        r.next_run_at = r.next_due(Utc::now()).map(stamp);
    })
    .await
}

/// A copy with its own id, its own secret and an empty history, paused so it
/// does not start running the moment it is made.
pub async fn duplicate(id: &str) -> Result<Routine> {
    let _guard = LOCK.lock().await;
    let path = file().await?;
    let mut all = read_from(&path).await?;
    let source = all.iter().find(|r| r.id == id).context("no such routine")?.clone();

    let mut copy = source;
    copy.id = Uuid::now_v7().to_string();
    copy.name = format!("{} (copy)", copy.name);
    copy.runs.clear();
    copy.skipped.clear();
    copy.on = false;
    copy.next_run_at = None;
    copy.created_at = stamp(Utc::now());
    copy.secret = matches!(copy.trigger, Trigger::Webhook { .. }).then(new_secret);

    all.push(copy.clone());
    write_to(&path, &all).await?;
    Ok(copy)
}

/// Skips the schedule's run on `date` (`YYYY-MM-DD`), and moves the next time
/// past it when it was the next.
pub async fn skip(id: &str, date: &str) -> Result<Routine> {
    let date = date.to_string();
    edit(id, move |r| {
        if !r.skipped.contains(&date) {
            r.skipped.push(date);
        }
        r.next_run_at = r.next_due(Utc::now()).map(stamp);
    })
    .await
}

/// Appends a finished run, newest last, and drops the oldest past [`MAX_RUNS`].
pub async fn record_run(id: &str, run: RunRecord) -> Result<()> {
    edit(id, |r| {
        r.runs.push(run);
        let extra = r.runs.len().saturating_sub(MAX_RUNS);
        r.runs.drain(..extra);
    })
    .await
    .map(drop)
}

/// Fills in where a run's result went, once that is known.
pub async fn note_delivery(id: &str, at: &str, delivery: String) -> Result<()> {
    edit(id, |r| {
        if let Some(run) = r.runs.iter_mut().rev().find(|run| run.at == at) {
            run.delivery = Some(delivery);
        }
    })
    .await
    .map(drop)
}

/// Reads the file, upgrading any record from before routines.
async fn read_from(path: &Path) -> Result<Vec<Routine>> {
    let contents = match fs::read_to_string(path).await {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e).with_context(|| format!("could not open {}", path.display())),
    };
    if contents.trim().is_empty() {
        return Ok(Vec::new());
    }

    let raw: Vec<Value> =
        serde_json::from_str(&contents).with_context(|| format!("could not read {}", path.display()))?;
    raw.into_iter().map(upgrade).collect()
}

/// A record from before routines becomes a schedule routine.
///
/// It had an interval, a folder and a model, and no agent. The interval stays in
/// [`Routine::legacy_every_minutes`] so what it did yesterday it does today; the
/// day-and-time trigger it is shown with is every day at the clock time of its
/// next run, which is what the editor will offer to keep.
fn upgrade(value: Value) -> Result<Routine> {
    if value.get("trigger").is_some() {
        return serde_json::from_value(value).context("could not read a routine");
    }

    let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
    let next = text("nextRunAt");
    let time = next
        .as_deref()
        .and_then(parse)
        .map(|at| {
            let local = at.with_timezone(&Local);
            format!("{:02}:{:02}", local.hour(), local.minute())
        })
        .unwrap_or_else(|| "09:00".into());

    let mut unknown = value.as_object().cloned().unwrap_or_default();
    for known in [
        "id", "name", "prompt", "projectPath", "model", "everyMinutes", "enabled", "nextRunAt",
        "lastRunAt", "lastSessionId",
    ] {
        unknown.remove(known);
    }

    Ok(Routine {
        id: text("id").unwrap_or_else(|| Uuid::now_v7().to_string()),
        name: text("name").unwrap_or_default(),
        agent_id: String::new(),
        trigger: Trigger::Schedule { days: (0..7).collect(), time, tz: "local".into() },
        act: String::new(),
        prompt: text("prompt").unwrap_or_default(),
        to: default_to(),
        quiet: false,
        on: value.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        next_run_at: next,
        skipped: Vec::new(),
        runs: Vec::new(),
        secret: None,
        created_at: text("lastRunAt").unwrap_or_default(),
        deleted_at: None,
        project_path: text("projectPath"),
        model: value.get("model").and_then(|m| serde_json::from_value(m.clone()).ok()),
        legacy_every_minutes: value.get("everyMinutes").and_then(Value::as_u64).map(|n| n as u32),
        unknown,
    })
}

/// Written whole, through a temporary file, so a reader opening the app mid-write
/// sees the old list or the new one: the file holds the stamps that decide what
/// has already run, and a torn write is a routine that runs twice.
async fn write_to(path: &Path, routines: &[Routine]) -> Result<()> {
    let encoded = serde_json::to_string_pretty(routines)?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, encoded)
        .await
        .with_context(|| format!("could not write {}", temp.display()))?;
    fs::rename(&temp, path)
        .await
        .with_context(|| format!("could not replace {}", path.display()))?;
    Ok(())
}

// --- Polling ----------------------------------------------------------------

/// Starts the poll. Called once from `setup`.
///
/// The task sleeps first and only then looks, so the first look is never on the
/// launch path.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL).await;
            if let Err(e) = tick(&app).await {
                eprintln!("[routines err] {e:#}");
            }
        }
    });
}

/// Claims what is due and starts each. The claim comes first and the start
/// second, which is the whole of the exactly-once.
async fn tick(app: &AppHandle) -> Result<()> {
    let claimed = claim_due(Utc::now()).await?;
    if !claimed.is_empty() {
        app.emit(CHANGED, ()).ok();
    }
    for routine in claimed {
        crate::routines::fire(app.clone(), routine.id, "schedule".into(), None);
    }
    Ok(())
}

// --- Commands ---------------------------------------------------------------

/// The routines, and which of them are running now.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct RoutineList {
    pub routines: Vec<Routine>,
    pub running: Vec<crate::routines::Running>,
}

async fn listing() -> Result<RoutineList, Fail> {
    Ok(RoutineList { routines: list().await?, running: crate::routines::running() })
}

fn changed(app: &AppHandle) {
    app.emit(CHANGED, ()).ok();
}

#[tauri::command]
pub async fn routines_list() -> Result<RoutineList, Fail> {
    listing().await
}

#[tauri::command]
pub async fn routine_save(app: AppHandle, input: RoutineInput) -> Result<Routine, Fail> {
    let saved = save(input).await?;
    changed(&app);
    Ok(saved)
}

#[tauri::command]
pub async fn routine_set_on(app: AppHandle, id: String, on: bool) -> Result<Routine, Fail> {
    let done = set_on(&id, on).await?;
    changed(&app);
    Ok(done)
}

#[tauri::command]
pub async fn routine_delete(app: AppHandle, id: String) -> Result<(), Fail> {
    delete(&id).await?;
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn routine_restore(app: AppHandle, id: String) -> Result<Routine, Fail> {
    let done = restore(&id).await?;
    changed(&app);
    Ok(done)
}

#[tauri::command]
pub async fn routine_duplicate(app: AppHandle, id: String) -> Result<Routine, Fail> {
    let copy = duplicate(&id).await?;
    changed(&app);
    Ok(copy)
}

#[tauri::command]
pub async fn routine_skip(app: AppHandle, id: String, date: String) -> Result<Routine, Fail> {
    let done = skip(&id, &date).await?;
    changed(&app);
    Ok(done)
}

/// Starts a run now without moving the schedule. Answers once it has started,
/// not when it ends: the webview follows the run through [`CHANGED`].
#[tauri::command]
pub async fn routine_run_now(app: AppHandle, id: String) -> Result<(), Fail> {
    if get(&id).await?.is_none_or(|r| !r.live()) {
        return Err(anyhow::anyhow!("no such routine").into());
    }
    if crate::routines::running().iter().any(|r| r.id == id) {
        return Err(anyhow::anyhow!("it is already running").into());
    }
    crate::routines::fire(app, id, "manual".into(), None);
    Ok(())
}

/// Where the webhook listener is, for the editor to print.
#[tauri::command]
pub fn routine_hook_info() -> crate::routine_hooks::HookInfo {
    crate::routine_hooks::info()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(raw: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(raw).unwrap().with_timezone(&Utc)
    }

    fn schedule(days: &[u8], time: &str, tz: &str, next: Option<&str>) -> Routine {
        Routine {
            id: "r".into(),
            name: "digest".into(),
            agent_id: "a".into(),
            trigger: Trigger::Schedule { days: days.to_vec(), time: time.into(), tz: tz.into() },
            act: "sums up".into(),
            prompt: "do it".into(),
            to: default_to(),
            quiet: true,
            on: true,
            next_run_at: next.map(str::to_string),
            skipped: Vec::new(),
            runs: Vec::new(),
            secret: None,
            created_at: String::new(),
            deleted_at: None,
            project_path: None,
            model: None,
            legacy_every_minutes: None,
            unknown: serde_json::Map::new(),
        }
    }

    // 2026-09-21 is a Monday.
    #[test]
    fn the_next_run_is_today_when_the_time_is_still_ahead() {
        let at = next_after(&[0], "09:00", "UTC", utc("2026-09-21T08:00:00Z"), &[]).unwrap();
        assert_eq!(at, utc("2026-09-21T09:00:00Z"));
    }

    #[test]
    fn the_next_run_is_next_week_once_the_time_has_passed() {
        let at = next_after(&[0], "09:00", "UTC", utc("2026-09-21T09:00:00Z"), &[]).unwrap();
        assert_eq!(at, utc("2026-09-28T09:00:00Z"), "the moment itself is already behind");
    }

    #[test]
    fn weekdays_skip_the_weekend() {
        // Friday evening: the next weekday run is Monday.
        let at = next_after(&[0, 1, 2, 3, 4], "08:00", "UTC", utc("2026-09-25T20:00:00Z"), &[]).unwrap();
        assert_eq!(at, utc("2026-09-28T08:00:00Z"));
    }

    #[test]
    fn a_fixed_offset_moves_the_moment_not_the_clock_reading() {
        // 09:00 at -03:00 is 12:00 UTC.
        let at = next_after(&[0], "09:00", "-03:00", utc("2026-09-21T00:00:00Z"), &[]).unwrap();
        assert_eq!(at, utc("2026-09-21T12:00:00Z"));
        // And the day is the offset's: 01:00 UTC Tuesday is still Monday there.
        let late = next_after(&[0], "23:00", "-03:00", utc("2026-09-22T01:00:00Z"), &[]).unwrap();
        assert_eq!(late, utc("2026-09-22T02:00:00Z"));
    }

    #[test]
    fn a_skipped_date_is_passed_over() {
        let at = next_after(&[0], "09:00", "UTC", utc("2026-09-21T08:00:00Z"), &["2026-09-21".into()]).unwrap();
        assert_eq!(at, utc("2026-09-28T09:00:00Z"));
    }

    #[test]
    fn no_days_and_bad_times_have_no_next() {
        assert!(next_after(&[], "09:00", "UTC", utc("2026-09-21T08:00:00Z"), &[]).is_none());
        assert!(next_after(&[0], "25:00", "UTC", utc("2026-09-21T08:00:00Z"), &[]).is_none());
        assert!(next_after(&[0], "nine", "UTC", utc("2026-09-21T08:00:00Z"), &[]).is_none());
    }

    #[test]
    fn local_reads_the_machines_own_clock() {
        let after = utc("2026-09-21T00:00:00Z");
        let at = next_after(&[0, 1, 2, 3, 4, 5, 6], "12:30", "local", after, &[]).unwrap();
        assert!(at > after && at - after <= Duration::hours(48));
        let back = at.with_timezone(&Local);
        assert_eq!((back.hour(), back.minute()), (12, 30));
    }

    #[test]
    fn an_unreadable_zone_falls_back_to_local() {
        assert_eq!(zone("Mars/Olympus"), Zone::Local);
        assert_eq!(zone("+05:30"), Zone::Fixed(FixedOffset::east_opt(5 * 3600 + 1800).unwrap()));
    }

    #[test]
    fn a_claim_runs_a_due_schedule_and_drops_a_stale_one() {
        let now = utc("2026-09-21T09:03:00Z");
        let due = schedule(&[0], "09:00", "UTC", Some("2026-09-21T09:00:00Z"));
        assert_eq!(claim_of(&due, now), Claim::Run);

        let stale = schedule(&[0], "09:00", "UTC", Some("2026-09-21T03:00:00Z"));
        assert_eq!(claim_of(&stale, now), Claim::Drop, "the app was closed: no late replay");

        let later = schedule(&[0], "09:00", "UTC", Some("2026-09-28T09:00:00Z"));
        assert_eq!(claim_of(&later, now), Claim::Nothing);

        let mut off = due.clone();
        off.on = false;
        assert_eq!(claim_of(&off, now), Claim::Nothing);

        let mut skipped = due;
        skipped.skipped.push("2026-09-21".into());
        assert_eq!(claim_of(&skipped, now), Claim::Drop);
    }

    #[test]
    fn a_webhook_is_never_claimed_by_the_clock() {
        let mut hook = schedule(&[0], "09:00", "UTC", Some("2020-01-01T00:00:00Z"));
        hook.trigger = Trigger::Webhook { source: "GitHub".into(), event: "push".into() };
        assert_eq!(claim_of(&hook, utc("2026-09-21T09:00:00Z")), Claim::Nothing);
    }

    #[tokio::test]
    async fn a_claim_advances_once_and_only_what_was_due() {
        let dir = std::env::temp_dir().join(format!("hz-routines-{}", Uuid::now_v7()));
        fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join(FILE);

        let ready = schedule(&[0], "09:00", "UTC", Some("2026-09-21T09:00:00Z"));
        let mut other = schedule(&[2], "10:00", "UTC", Some("2026-09-23T10:00:00Z"));
        other.id = "later".into();
        write_to(&path, &[ready, other.clone()]).await.unwrap();

        let now = utc("2026-09-21T09:01:00Z");
        let claimed = claim_at(&path, now).await.unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].next_run_at.as_deref(), Some("2026-09-28T09:00:00Z"));
        assert!(claim_at(&path, now).await.unwrap().is_empty(), "the stamp moved");

        let left = read_from(&path).await.unwrap();
        assert_eq!(left[1].next_run_at, other.next_run_at);
        fs::remove_dir_all(&dir).await.ok();
    }

    #[test]
    fn an_old_automation_becomes_a_schedule_routine_and_keeps_its_interval() {
        let old = serde_json::json!({
            "id": "a1", "name": "nightly", "prompt": "check the PRs",
            "projectPath": "/tmp/repo", "model": "", "everyMinutes": 90, "enabled": true,
            "nextRunAt": "2026-09-21T12:00:00Z", "lastRunAt": null, "lastSessionId": null,
            "futureField": 7,
        });
        let r = upgrade(old).unwrap();
        assert_eq!(r.id, "a1");
        assert!(r.agent_id.is_empty(), "it ran before agents");
        assert!(matches!(r.trigger, Trigger::Schedule { ref days, .. } if days.len() == 7));
        assert_eq!(r.legacy_every_minutes, Some(90));
        assert_eq!(r.project_path.as_deref(), Some("/tmp/repo"));
        assert_eq!(r.unknown.get("futureField"), Some(&serde_json::json!(7)));
        // The interval, not the day-and-time reading, still decides the next run.
        let after = utc("2026-09-21T12:00:00Z");
        assert_eq!(r.next_due(after), Some(after + Duration::minutes(90)));
    }

    #[test]
    fn a_new_shape_reads_back_untouched() {
        let r = schedule(&[0, 4], "16:00", "local", Some("2026-09-21T09:00:00Z"));
        let back = upgrade(serde_json::to_value(&r).unwrap()).unwrap();
        assert_eq!(back.trigger, r.trigger);
        assert_eq!(back.legacy_every_minutes, None);
    }

    #[tokio::test]
    async fn save_validates_and_gives_a_webhook_a_secret() {
        let dir = std::env::temp_dir().join(format!("hz-routines-{}", Uuid::now_v7()));
        fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join(FILE);
        let now = utc("2026-09-21T08:00:00Z");

        let input = |trigger: Trigger, prompt: &str| RoutineInput {
            id: None,
            name: String::new(),
            agent_id: "a".into(),
            trigger,
            act: "reviews the pull request".into(),
            prompt: prompt.into(),
            to: "inbox".into(),
            quiet: true,
            on: true,
            secret: None,
        };
        let hook = Trigger::Webhook { source: "GitHub".into(), event: "pull_request.opened".into() };

        assert!(save_at(&path, input(hook.clone(), "  "), now).await.is_err());
        let no_days = Trigger::Schedule { days: vec![], time: "09:00".into(), tz: "UTC".into() };
        assert!(save_at(&path, input(no_days, "x"), now).await.is_err());

        let made = save_at(&path, input(hook, "review it"), now).await.unwrap();
        assert!(made.secret.as_deref().is_some_and(|s| s.starts_with("whsec_")));
        assert_eq!(made.name, "reviews the pull request", "named after what it does");
        assert!(made.next_run_at.is_none());

        let sched = Trigger::Schedule { days: vec![0], time: "09:00".into(), tz: "UTC".into() };
        let mut edit = input(sched, "weekly");
        edit.id = Some(made.id.clone());
        let moved = save_at(&path, edit, now).await.unwrap();
        assert_eq!(moved.id, made.id, "an edit is not a copy");
        assert_eq!(moved.next_run_at.as_deref(), Some("2026-09-21T09:00:00Z"));
        fs::remove_dir_all(&dir).await.ok();
    }

    #[test]
    fn a_secret_is_long_and_never_repeats() {
        let (a, b) = (new_secret(), new_secret());
        assert_ne!(a, b);
        assert_eq!(a.len(), "whsec_".len() + 64);
    }
}
