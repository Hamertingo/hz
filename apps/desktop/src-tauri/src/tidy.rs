//! The nightly memory tidy: once a day, at the time the workspace chose, every
//! agent in it is asked (with the hidden `<hz-tidy/>` prompt) to merge duplicate
//! notes and drop stale ones.
//!
//! A poll in this process, like the routines'. The day a workspace was last
//! tidied is written to disk *before* its agents are asked, which is the whole
//! of exactly-once: a crash mid-run skips that night rather than repeating it.

use std::{collections::BTreeMap, path::PathBuf, time::Duration};

use chrono::Local;
use tauri::AppHandle;

use crate::{agent_profile, agents, studio, workspaces};

const POLL: Duration = Duration::from_secs(60);
/// How long after the chosen time a missed tidy is still run. Past it the night
/// is skipped: tidying at lunchtime because the laptop was shut at 3am is not
/// what "nightly" promised.
const CATCH_UP_MINUTES: u16 = 4 * 60;
/// A folder with fewer notes has nothing to merge, and a turn is not free.
const MIN_NOTES: u32 = 2;

/// Pure: whether a workspace whose tidy time is `at` (minutes since midnight)
/// is due at `now`, given the day it last ran and today's.
pub fn due(now: u16, at: u16, last_day: Option<&str>, today: &str) -> bool {
    last_day != Some(today) && now >= at && now - at <= CATCH_UP_MINUTES
}

fn state_path(home: &std::path::Path) -> PathBuf {
    home.join("tidy-state.json")
}

async fn read_state(home: &std::path::Path) -> BTreeMap<String, String> {
    tokio::fs::read_to_string(state_path(home))
        .await
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Starts the poll. Called once from `setup`.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL).await;
            tick(&app).await;
        }
    });
}

async fn tick(app: &AppHandle) {
    let Ok(home) = crate::store::get_home_app_dir().await else { return };
    let today = Local::now().format("%Y-%m-%d").to_string();
    let now = studio::local_minutes();

    for ws in workspaces::cached() {
        if !ws.defaults.tidy {
            continue;
        }
        let Some(at) = studio::parse_hhmm(&ws.defaults.tidy_time) else { continue };
        let mut state = read_state(&home).await;
        if !due(now, at, state.get(&ws.id).map(String::as_str), &today) {
            continue;
        }
        state.insert(ws.id.clone(), today.clone());
        let _ = crate::store::write_atomic(&state_path(&home), serde_json::to_string_pretty(&state).unwrap_or_default()).await;

        for agent in agents::in_workspace(&ws.id) {
            if agent.session_id.is_none() || agent_profile::note_count(&agent.id).await < MIN_NOTES {
                continue;
            }
            match agent_profile::agent_memory_tidy(agent.id.clone(), app.clone()).await {
                Ok(t) => eprintln!("[tidy] {}: {} notes to {}", agent.name, t.before, t.after),
                Err(e) => eprintln!("[tidy] {}: {e}", agent.name),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tidy_is_due_from_its_time_until_the_catch_up_ends_and_once_a_day() {
        let at = 3 * 60;
        assert!(!due(2 * 60 + 59, at, None, "d"), "not before its time");
        assert!(due(3 * 60, at, None, "d"));
        assert!(due(3 * 60 + 200, at, None, "d"), "caught up within four hours");
        assert!(!due(3 * 60 + 241, at, None, "d"), "a missed night is skipped");
        assert!(!due(3 * 60 + 5, at, Some("d"), "d"), "already ran today");
        assert!(due(3 * 60 + 5, at, Some("yesterday"), "d"));
    }
}
