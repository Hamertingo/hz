//! Prompts that run themselves, on a clock.
//!
//! **There is no daemon, and that is the design rather than a shortcut.** An
//! automation runs while hz is open: the poll is a task in this process, and
//! closing the app stops it. The alternative is a launch agent or a `launchd`
//! plist, which is a second thing installed on the reader's machine, a second
//! thing to keep in step with the bundle, and a prompt about a repository that
//! would then run with nobody watching — while every surface that could show the
//! result is closed. An automation the reader cannot see run is one they find
//! out about by reading a diff they did not expect.
//!
//! **Missed runs are skipped, not caught up.** A reader who closes the app for a
//! week and opens it gets one run, not a hundred and sixty-eight: the next time
//! is measured from *now*, in whole intervals. Catching up would be a queue of
//! prompts about a repository that has moved on, each spawning a session — the
//! worst possible answer to "I was away".
//!
//! **One run per due moment, and the claim is what makes it one.** The check and
//! the advance happen under one hold of the store's lock, so a second poll
//! arriving while the first is still spawning sessions finds the times already
//! moved and claims nothing.

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{fs, sync::Mutex};
use ts_rs::TS;
use uuid::Uuid;

use crate::{
    events::ApprovalPolicy,
    models::ModelId,
    orchestration::SESSION_CREATED,
    session::{Harness, SendRequest, SessionManager},
    store::get_home_app_dir,
    Fail,
};

/// How often the app looks.
///
/// Twice a minute against a schedule measured in minutes: the cost while idle is
/// a file read, and the slack is invisible against an interval nobody sets below
/// [`MIN_EVERY_MINUTES`].
pub const POLL: std::time::Duration = std::time::Duration::from_secs(30);

/// The shortest interval a reader can ask for.
///
/// Every run of an automation opens a session, and a session is a child process
/// and a worktree. A five-minute floor would be four hundred sessions a day for
/// a reader who left one switched on by accident.
pub const MIN_EVERY_MINUTES: u32 = 15;

const MAX_EVERY_MINUTES: u32 = 60 * 24 * 30;

/// Every read and write of the file goes through this.
static LOCK: Mutex<()> = Mutex::const_new(());

const FILE: &str = "automations.json";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    /// What the sidebar row this run opens is called.
    pub name: String,
    /// Sent as the prompt, as written. Nothing is assembled around it — see
    /// `SKILL.md`'s rule about prompts that read as the reader's own words.
    pub prompt: String,
    /// The repository it runs in. Held rather than taken from whichever session
    /// is selected, since a run happens with nobody looking.
    pub project_path: String,
    pub model: ModelId,
    /// Minutes between runs. **One number rather than a cron string**: nothing
    /// in this app can edit an expression, and every schedule anybody actually
    /// wants is "every N".
    pub every_minutes: u32,
    pub enabled: bool,
    /// When this is next due, RFC 3339 in UTC.
    pub next_run_at: String,
    pub last_run_at: Option<String>,
    /// The session the last run opened, so the reader can find what it said —
    /// the row is what an automation answers with.
    pub last_session_id: Option<String>,
    /// Every key this build does not know, carried through untouched.
    ///
    /// The file is rewritten whole, so a build that round-trips it through its
    /// own struct without this would drop whatever a later one added. The same
    /// bargain `SessionIndexItem::unknown` makes, and for the same reason.
    #[serde(flatten)]
    #[ts(flatten)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
}

/// Whether this is due at `now`.
///
/// A stamp this build cannot read counts as **due**, which is the safe
/// direction: the alternative is an automation that silently never runs again
/// because of a field nobody can see.
pub fn due(automation: &Automation, now: DateTime<Utc>) -> bool {
    if !automation.enabled {
        return false;
    }
    match parse(&automation.next_run_at) {
        Some(at) => at <= now,
        None => true,
    }
}

/// The automation as a run that started at `now` leaves it.
///
/// **Measured from `now`, never from the old stamp** — that is the whole of
/// "missed runs are skipped". `old + interval` walks one step at a time through
/// a week of missed slots and every one of them is due again the moment it lands.
pub fn after_a_run(automation: &Automation, now: DateTime<Utc>) -> Automation {
    Automation {
        next_run_at: stamp(now + Duration::minutes(automation.every_minutes as i64)),
        last_run_at: Some(stamp(now)),
        ..automation.clone()
    }
}

/// An automation due for its first run: `next_run_at` is when it was made.
pub fn schedule_from(now: DateTime<Utc>) -> String {
    stamp(now)
}

fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn parse(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw).ok().map(|at| at.with_timezone(&Utc))
}

async fn file() -> Result<PathBuf> {
    Ok(get_home_app_dir().await?.join(FILE))
}

pub async fn list() -> Result<Vec<Automation>> {
    read_from(&file().await?).await
}

/// Takes everything due right now, and advances each of them.
///
/// **The claim is the exactly-once.** Read, decide and write happen under one
/// hold of [`LOCK`], so two polls a second apart cannot both see the same
/// automation as due — the second finds `next_run_at` already moved past it. The
/// spawn happens *after* the lock is dropped, because it is slow and it is
/// allowed to fail: a run that fails to start has still happened, and retrying
/// it on the next poll would be the double-run this exists to prevent.
pub async fn claim_due(now: DateTime<Utc>) -> Result<Vec<Automation>> {
    claim_at(&file().await?, now).await
}

/// The path-taking half. Split out so the one function whose whole job is the
/// read-decide-write can be driven in a test without touching the reader's own
/// file — the reader of `~/.hz` is not something a test may write to.
async fn claim_at(path: &Path, now: DateTime<Utc>) -> Result<Vec<Automation>> {
    let _guard = LOCK.lock().await;

    let all = read_from(path).await?;
    let mut claimed = Vec::new();
    let mut left = Vec::with_capacity(all.len());

    for automation in all {
        if due(&automation, now) {
            let next = after_a_run(&automation, now);
            claimed.push(next.clone());
            left.push(next);
        } else {
            left.push(automation);
        }
    }

    if claimed.is_empty() {
        return Ok(claimed);
    }
    write_to(path, &left).await?;
    Ok(claimed)
}

pub async fn create(
    name: String,
    prompt: String,
    project_path: String,
    model: ModelId,
    every_minutes: u32,
) -> Result<Automation> {
    if prompt.trim().is_empty() {
        bail!("an automation needs a prompt");
    }
    if !(MIN_EVERY_MINUTES..=MAX_EVERY_MINUTES).contains(&every_minutes) {
        bail!("run it every {MIN_EVERY_MINUTES} minutes at the least");
    }

    let _guard = LOCK.lock().await;
    let path = file().await?;
    let mut all = read_from(&path).await?;

    let automation = Automation {
        id: Uuid::now_v7().to_string(),
        name: if name.trim().is_empty() {
            // The first line of the prompt, which is what it is about. Better
            // than "Untitled", which names nothing and collides with every
            // other one.
            prompt
                .lines()
                .next()
                .unwrap_or_default()
                .trim()
                .chars()
                .take(60)
                .collect::<String>()
        } else {
            name.trim().to_string()
        },
        prompt,
        project_path,
        model,
        every_minutes,
        enabled: true,
        next_run_at: schedule_from(Utc::now()),
        last_run_at: None,
        last_session_id: None,
        unknown: serde_json::Map::new(),
    };

    all.push(automation.clone());
    write_to(&path, &all).await?;
    Ok(automation)
}

pub async fn remove(id: &str) -> Result<Vec<Automation>> {
    let _guard = LOCK.lock().await;
    let path = file().await?;
    let mut all = read_from(&path).await?;
    all.retain(|a| a.id != id);
    write_to(&path, &all).await?;
    Ok(all)
}

/// Switches one on or off, and answers with the whole list.
///
/// **Switching one back on makes it due now** rather than at whatever it was
/// pointed at when it was switched off: the reader pressing the switch is asking
/// for it to run, and a stamp from last week is not what they mean. Left alone,
/// an automation switched off for a month and back on would either run instantly
/// (which this makes explicit) or wait out a stale interval.
pub async fn set_enabled(id: &str, enabled: bool) -> Result<Vec<Automation>> {
    set_enabled_at(&file().await?, id, enabled, Utc::now()).await
}

async fn set_enabled_at(
    path: &Path,
    id: &str,
    enabled: bool,
    now: DateTime<Utc>,
) -> Result<Vec<Automation>> {
    let _guard = LOCK.lock().await;
    let mut all = read_from(path).await?;

    for automation in all.iter_mut() {
        if automation.id != id {
            continue;
        }
        if enabled && !automation.enabled {
            automation.next_run_at = schedule_from(now);
        }
        automation.enabled = enabled;
    }

    write_to(path, &all).await?;
    Ok(all)
}

/// Records the session a claimed run opened.
pub async fn remember_run(id: &str, session_id: &str) -> Result<()> {
    let _guard = LOCK.lock().await;
    let path = file().await?;
    let mut all = read_from(&path).await?;

    for automation in all.iter_mut() {
        if automation.id == id {
            automation.last_session_id = Some(session_id.to_string());
        }
    }

    write_to(&path, &all).await
}

async fn read_from(path: &Path) -> Result<Vec<Automation>> {
    let contents = match fs::read_to_string(path).await {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e).with_context(|| format!("could not open {}", path.display())),
    };

    if contents.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str(&contents).with_context(|| format!("could not read {}", path.display()))
}

/// Written whole, through a temporary file.
///
/// A reader opening the app mid-write must either see the old list or the new
/// one — the file holds the prompt text and the stamps that decide what has
/// already run, so a torn write is an automation that runs twice.
async fn write_to(path: &Path, automations: &[Automation]) -> Result<()> {
    let encoded = serde_json::to_string_pretty(automations)?;
    let temp = path.with_extension("json.tmp");

    fs::write(&temp, encoded)
        .await
        .with_context(|| format!("could not write {}", temp.display()))?;
    fs::rename(&temp, path)
        .await
        .with_context(|| format!("could not replace {}", path.display()))?;
    Ok(())
}

// --- Running them -----------------------------------------------------------

/// Starts the poll. Called once from `setup`, beside the socket.
///
/// Nothing is spawned here: the task sleeps first, waits out a whole interval,
/// and only then looks. An app that launches runs nothing until an automation is
/// actually due, and the first look is never on the launch path.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL).await;
            if let Err(e) = tick(&app).await {
                eprintln!("[automations err] {e:#}");
            }
        }
    });
}

/// Claims what is due and opens a session for each.
///
/// **The claim comes first and the spawn second, and that order is the whole of
/// the exactly-once.** A spawn that fails has still had its run taken, so the
/// next poll cannot take it again. Spawning first and recording after would
/// re-run every automation whose session failed to start, on every poll, for as
/// long as the failure lasted.
async fn tick(app: &AppHandle) -> Result<()> {
    for automation in claim_due(Utc::now()).await? {
        match run(app, &automation).await {
            Ok(session_id) => remember_run(&automation.id, &session_id).await?,
            // Logged and dropped: the run has happened as far as the schedule is
            // concerned, and one automation that cannot start is not a reason to
            // stop the poll for the others.
            Err(e) => eprintln!("[automations err] {}: {e:#}", automation.name),
        }
    }
    Ok(())
}

/// One run: a session of its own, in its own worktree, on the automation's own
/// prompt.
///
/// **The stance is the app's default rather than anything stored**, and that is
/// the safe direction rather than an oversight: this is the one session in the
/// app that starts with nobody in the room, and a stance that let it write
/// unsupervised would be an escalation the reader never agreed to at the moment
/// they were not looking. What it costs is stated: a run that writes stops at
/// its first write, and the reader finds it in the sidebar behind the yellow
/// mark. That is a run that happened, not one that quietly did something else.
async fn run(app: &AppHandle, automation: &Automation) -> Result<String> {
    let session_id = Uuid::now_v7().to_string();

    let outcome = app
        .state::<SessionManager>()
        .send_msg(
            SendRequest {
                session_id: &session_id,
                prompt: &automation.prompt,
                attachment_paths: &[],
                issue_ids: &[],
                harness: Harness::Mcode,
                model: automation.model.clone(),
                // The model's own ladder: an automation names a model, not a
                // level, and a level from another model's ladder is a refusal.
                effort: None,
                permission_mode: ApprovalPolicy::default(),
                fast: false,
                cwd: &automation.project_path,
                branch: None,
                // Always, for `hz new`'s reason: this can run while the reader is
                // working in that checkout, and two agents in one tree overwrite
                // each other.
                use_worktree: true,
                worktree_name: None,
                base_ref: None,
                seed_tree: None,
                agent_name: None,
                is_new_session: true,
                parent_session_id: None,
                // Nobody typed it. `None`, like a relay: the wait is from the
                // child's own boot, since there is no press to time it from.
                from: None,
                sent_at: None,
            },
            app,
        )
        .await
        .context("could not start the run")?;

    // The row has to reach the sidebar from here, since nothing the reader did
    // asked for this session: the app is the only side that knows it exists.
    let item = outcome
        .snapshot
        .map(|snapshot| snapshot.index_item)
        .context("the run started but returned no index entry")?;
    app.emit(SESSION_CREATED, &item).ok();

    Ok(session_id)
}

// --- Commands ---------------------------------------------------------------

#[tauri::command]
pub async fn list_automations() -> Result<Vec<Automation>, Fail> {
    Ok(list().await?)
}

#[tauri::command]
pub async fn create_automation(
    name: String,
    prompt: String,
    project_path: String,
    model: ModelId,
    every_minutes: u32,
) -> Result<Automation, Fail> {
    Ok(create(name, prompt, project_path, model, every_minutes).await?)
}

#[tauri::command]
pub async fn delete_automation(id: String) -> Result<Vec<Automation>, Fail> {
    Ok(remove(&id).await?)
}

#[tauri::command]
pub async fn set_automation_enabled(id: String, enabled: bool) -> Result<Vec<Automation>, Fail> {
    Ok(set_enabled(&id, enabled).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(hours: i64) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-09-20T12:00:00Z").unwrap().with_timezone(&Utc)
            + Duration::hours(hours)
    }

    fn automation(every_minutes: u32, next_run_at: DateTime<Utc>) -> Automation {
        Automation {
            id: "a".into(),
            name: "nightly".into(),
            prompt: "check the PRs".into(),
            project_path: "/tmp/repo".into(),
            model: ModelId::default(),
            every_minutes,
            enabled: true,
            next_run_at: stamp(next_run_at),
            last_run_at: None,
            last_session_id: None,
            unknown: serde_json::Map::new(),
        }
    }

    #[test]
    fn due_only_once_the_stamp_has_arrived() {
        let a = automation(60, at(1));
        assert!(!due(&a, at(0)));
        assert!(due(&a, at(1)), "the moment itself counts");
        assert!(due(&a, at(5)));
    }

    #[test]
    fn a_switched_off_automation_is_never_due() {
        let mut a = automation(60, at(-100));
        a.enabled = false;
        assert!(!due(&a, at(0)));
    }

    /// The safe direction: a stamp nobody can read runs rather than never
    /// running again.
    #[test]
    fn a_stamp_this_build_cannot_read_counts_as_due() {
        let mut a = automation(60, at(0));
        a.next_run_at = "not a date".into();
        assert!(due(&a, at(0)));
    }

    /// **The rule the whole design turns on.** Measured from `now`, so a week
    /// closed is one run — not one per missed slot, each spawning a session.
    #[test]
    fn a_missed_run_is_skipped_rather_than_caught_up() {
        let a = automation(60, at(-24 * 7));
        let after = after_a_run(&a, at(0));

        assert_eq!(after.next_run_at, stamp(at(1)), "one interval from now");
        assert_eq!(after.last_run_at.as_deref(), Some(stamp(at(0)).as_str()));
        assert!(!due(&after, at(0)), "and it is not due again immediately");
    }

    #[tokio::test]
    async fn a_claim_advances_only_what_was_due() {
        // A file of its own rather than `~/.hz`: this is the one function whose
        // whole job is the read-decide-write, so it is the one worth driving.
        let dir = std::env::temp_dir().join(format!("hz-auto-{}", Uuid::now_v7()));
        fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join(FILE);

        let ready = automation(30, at(-1));
        let later = automation(30, at(4));
        write_to(&path, &[ready.clone(), later.clone()]).await.unwrap();

        let claimed = claim_at(&path, at(0)).await.unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].id, "a");
        assert_eq!(claimed[0].next_run_at, stamp(at(0) + Duration::minutes(30)));

        // The second poll a moment later finds nothing: the stamp moved.
        assert!(claim_at(&path, at(0)).await.unwrap().is_empty());

        // And the one that was not due is untouched, stamp and all.
        let left = read_from(&path).await.unwrap();
        assert_eq!(left.len(), 2);
        assert_eq!(left[1].next_run_at, later.next_run_at);

        fs::remove_dir_all(&dir).await.ok();
    }

    #[tokio::test]
    async fn switching_one_back_on_makes_it_due_now() {
        let dir = std::env::temp_dir().join(format!("hz-auto-{}", Uuid::now_v7()));
        fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join(FILE);

        let mut a = automation(60, at(-24 * 7));
        a.enabled = false;
        write_to(&path, &[a]).await.unwrap();

        let mut all = set_enabled_at(&path, "a", true, at(0)).await.unwrap();
        assert!(all[0].enabled);
        assert_eq!(
            all[0].next_run_at,
            stamp(at(0)),
            "the reader pressed the switch to have it run, not to wait out a stale stamp"
        );
        assert!(due(&all[0], at(0)));

        all = set_enabled_at(&path, "a", false, at(0)).await.unwrap();
        assert!(!all[0].enabled);

        fs::remove_dir_all(&dir).await.ok();
    }
}
