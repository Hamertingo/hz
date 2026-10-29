//! What an agent's profile page keeps on disk besides the roster: the history of
//! its instructions, how often each memory note was read, the notes it forgot,
//! and the last time it tidied its memory.
//!
//! All of it lives under `~/.hz/agents/<id>/` beside the memory folder, and every
//! function below the commands takes that folder as an argument so the tests need
//! no real home directory.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::LazyLock,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::{agents, store};

/// One lock for every read-modify-write below. The files are small and the
/// writers are a person clicking and an agent calling a tool, so a single lock is
/// cheaper than reasoning about which pairs can collide.
static DISK: LazyLock<Mutex<()>> = LazyLock::new(Default::default);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// `~/.hz/agents/<id>`, for an id that is only an id.
pub(crate) async fn agent_root(agent_id: &str) -> Result<PathBuf> {
    agents::valid_agent_id(agent_id)?;
    Ok(store::get_home_app_dir().await?.join("agents").join(agent_id))
}

async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let tmp = path.with_extension("tmp");
    tokio::fs::write(&tmp, bytes).await?;
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction versions
// ---------------------------------------------------------------------------

/// One saved state of an agent's instructions, without its text.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct InstrMeta {
    pub n: u32,
    pub at_ms: u64,
    /// What changed, in a few words: "Added 3 lines", "Restored V4".
    pub summary: String,
    pub chars: u32,
}

/// A saved state with its text.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct InstrVersion {
    pub n: u32,
    pub at_ms: u64,
    pub summary: String,
    pub text: String,
}

impl InstrVersion {
    fn meta(&self) -> InstrMeta {
        InstrMeta {
            n: self.n,
            at_ms: self.at_ms,
            summary: self.summary.clone(),
            chars: self.text.chars().count() as u32,
        }
    }
}

fn version_file(root: &Path, n: u32) -> PathBuf {
    root.join("instructions").join(format!("{n:04}.json"))
}

async fn read_versions(root: &Path) -> Vec<InstrVersion> {
    let Ok(mut read) = tokio::fs::read_dir(root.join("instructions")).await else {
        return Vec::new();
    };
    let mut out = Vec::new();
    while let Ok(Some(entry)) = read.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".json") {
            continue;
        }
        let Ok(raw) = tokio::fs::read_to_string(entry.path()).await else { continue };
        if let Ok(v) = serde_json::from_str::<InstrVersion>(&raw) {
            out.push(v);
        }
    }
    out.sort_by_key(|v| std::cmp::Reverse(v.n));
    out
}

/// A few words on how `new` differs from `old`, by lines added and removed.
///
/// A multiset comparison rather than a diff: it only has to name the size of the
/// edit, and the real diff is drawn from the two texts when the reader compares.
pub(crate) fn summarize(old: &str, new: &str) -> String {
    let mut counts: HashMap<&str, i32> = HashMap::new();
    for line in old.lines().map(str::trim).filter(|l| !l.is_empty()) {
        *counts.entry(line).or_default() += 1;
    }
    let mut added = 0;
    for line in new.lines().map(str::trim).filter(|l| !l.is_empty()) {
        match counts.get_mut(line) {
            Some(n) if *n > 0 => *n -= 1,
            _ => added += 1,
        }
    }
    let removed: i32 = counts.values().sum();
    let plural = |n: i32| if n == 1 { "line" } else { "lines" };
    match (added, removed) {
        (0, 0) => "Reworded".into(),
        (a, 0) => format!("Added {a} {}", plural(a)),
        (0, r) => format!("Removed {r} {}", plural(r)),
        (a, r) => format!("Added {a}, removed {r} lines"),
    }
}

/// Appends a version unless `text` is what the newest one already says.
async fn append_version(root: &Path, text: &str, summary: Option<String>) -> Result<Option<InstrMeta>> {
    let _guard = DISK.lock().await;
    let versions = read_versions(root).await;
    let latest = versions.first();
    if latest.is_some_and(|v| v.text == text) {
        return Ok(None);
    }
    let summary = summary.unwrap_or_else(|| match latest {
        Some(prev) => summarize(&prev.text, text),
        None => "First version".to_string(),
    });
    let version = InstrVersion {
        n: latest.map_or(1, |v| v.n + 1),
        at_ms: now_ms(),
        summary,
        text: text.to_string(),
    };
    atomic_write(&version_file(root, version.n), &serde_json::to_vec_pretty(&version)?).await?;
    Ok(Some(version.meta()))
}

/// Every saved state of an agent's instructions, newest first.
#[tauri::command]
pub async fn agent_instr_list(agent_id: String) -> Result<Vec<InstrMeta>, String> {
    let root = agent_root(&agent_id).await.map_err(|e| e.to_string())?;
    Ok(read_versions(&root).await.iter().map(InstrVersion::meta).collect())
}

/// One saved state with its text.
#[tauri::command]
pub async fn agent_instr_read(agent_id: String, n: u32) -> Result<InstrVersion, String> {
    let root = agent_root(&agent_id).await.map_err(|e| e.to_string())?;
    let raw = tokio::fs::read_to_string(version_file(&root, n))
        .await
        .map_err(|_| format!("there is no version {n}"))?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Saves the instructions as a new version, or answers `None` when they have not
/// changed. The roster still holds the live copy that reaches the next briefing;
/// this is the history behind it. `summary` names a version the reader did not
/// type, such as the first one an existing agent is given.
#[tauri::command]
pub async fn agent_instr_save(
    agent_id: String,
    text: String,
    summary: Option<String>,
) -> Result<Option<InstrMeta>, String> {
    let root = agent_root(&agent_id).await.map_err(|e| e.to_string())?;
    append_version(&root, &text, summary).await.map_err(|e| format!("{e:#}"))
}

/// Brings an old version back **as a new one**. History is never rewritten: the
/// restored text becomes the newest entry and the old one stays where it was.
#[tauri::command]
pub async fn agent_instr_restore(agent_id: String, n: u32) -> Result<InstrVersion, String> {
    let root = agent_root(&agent_id).await.map_err(|e| e.to_string())?;
    let raw = tokio::fs::read_to_string(version_file(&root, n))
        .await
        .map_err(|_| format!("there is no version {n}"))?;
    let old: InstrVersion = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let made = append_version(&root, &old.text, Some(format!("Restored V{n}")))
        .await
        .map_err(|e| format!("{e:#}"))?;
    match made {
        Some(meta) => agent_instr_read(agent_id, meta.n).await,
        // Already the newest text: nothing to add, and the newest is the answer.
        None => {
            let latest = read_versions(&root).await.into_iter().next();
            latest.ok_or_else(|| "no versions".to_string())
        }
    }
}

// ---------------------------------------------------------------------------
// Memory: reads counted, notes forgotten
// ---------------------------------------------------------------------------

/// How often an agent read one note, and when it last did.
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct NoteUsage {
    pub count: u32,
    pub last_ms: u64,
}

fn usage_file(memory: &Path) -> PathBuf {
    memory.join(".usage.json")
}

async fn read_usage(memory: &Path) -> HashMap<String, NoteUsage> {
    tokio::fs::read_to_string(usage_file(memory))
        .await
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Counts one read of `name`. A sidecar next to the notes, dot-named so the
/// note listing (which only knows flat `.md` files) never shows it.
pub(crate) async fn bump_usage(memory: &Path, name: &str) -> Result<()> {
    let _guard = DISK.lock().await;
    let mut all = read_usage(memory).await;
    let entry = all.entry(name.to_string()).or_default();
    entry.count += 1;
    entry.last_ms = now_ms();
    atomic_write(&usage_file(memory), &serde_json::to_vec(&all)?).await
}

/// How often each note was read through the memory tool.
#[tauri::command]
pub async fn agent_memory_usage(agent_id: String) -> Result<HashMap<String, NoteUsage>, String> {
    let memory = agents::memory_dir_for(&agent_id).await?;
    Ok(read_usage(&memory).await)
}

fn trash_dir(root: &Path) -> PathBuf {
    root.join("trash")
}

/// The index line that points at `name`, taken out when a note is forgotten.
fn pop_index_line(index: &str, name: &str) -> (String, Option<String>) {
    let needle = format!("({name})");
    let mut kept = Vec::new();
    let mut taken = None;
    for line in index.lines() {
        if taken.is_none() && line.contains(&needle) {
            taken = Some(line.to_string());
        } else {
            kept.push(line);
        }
    }
    let mut out = kept.join("\n");
    if index.ends_with('\n') || taken.is_some() {
        out.push('\n');
    }
    (out, taken)
}

/// Moves a note to the agent's trash, outside the memory folder so the agent no
/// longer sees it, and takes its line out of the index. Nothing is deleted: the
/// Undo that follows is [`agent_memory_restore`].
#[tauri::command]
pub async fn agent_memory_forget(agent_id: String, name: String) -> Result<(), String> {
    forget(&agent_id, &name).await.map_err(|e| format!("{e:#}"))
}

async fn forget(agent_id: &str, name: &str) -> Result<()> {
    anyhow::ensure!(name != "MEMORY.md", "the index stays; clear its text instead");
    let memory = agents::memory_dir_for(agent_id).await.map_err(anyhow::Error::msg)?;
    let root = agent_root(agent_id).await?;
    let from = agents::note_path(&memory, name)?;
    let _guard = DISK.lock().await;

    let trash = trash_dir(&root);
    tokio::fs::create_dir_all(&trash).await?;
    tokio::fs::rename(&from, trash.join(name)).await.context("that note is not there")?;

    let index_path = memory.join("MEMORY.md");
    if let Ok(index) = tokio::fs::read_to_string(&index_path).await {
        let (rest, line) = pop_index_line(&index, name);
        tokio::fs::write(&index_path, rest).await?;
        match line {
            Some(line) => tokio::fs::write(trash.join(format!("{name}.index")), line).await?,
            None => {
                let _ = tokio::fs::remove_file(trash.join(format!("{name}.index"))).await;
            }
        }
    }
    Ok(())
}

/// Puts a forgotten note back, with its index line. Refuses when a note of that
/// name has been written since, rather than overwriting it.
#[tauri::command]
pub async fn agent_memory_restore(agent_id: String, name: String) -> Result<(), String> {
    restore(&agent_id, &name).await.map_err(|e| format!("{e:#}"))
}

async fn restore(agent_id: &str, name: &str) -> Result<()> {
    let memory = agents::memory_dir_for(agent_id).await.map_err(anyhow::Error::msg)?;
    let root = agent_root(agent_id).await?;
    let to = agents::note_path(&memory, name)?;
    let _guard = DISK.lock().await;

    anyhow::ensure!(!tokio::fs::try_exists(&to).await.unwrap_or(false), "a note with that name exists now");
    let trash = trash_dir(&root);
    tokio::fs::rename(trash.join(name), &to).await.context("that note is not in the trash")?;

    if let Ok(line) = tokio::fs::read_to_string(trash.join(format!("{name}.index"))).await {
        let index_path = memory.join("MEMORY.md");
        let index = tokio::fs::read_to_string(&index_path).await.unwrap_or_default();
        if !index.contains(&format!("({name})")) {
            let body = index.trim_end();
            let joined = if body.is_empty() { format!("{line}\n") } else { format!("{body}\n{line}\n") };
            tokio::fs::write(&index_path, joined).await?;
        }
        let _ = tokio::fs::remove_file(trash.join(format!("{name}.index"))).await;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tidy
// ---------------------------------------------------------------------------

/// The mark on the hidden prompt that asks an agent to tidy its memory, so the
/// transcript can leave the instruction out of the reader's chat.
pub const TIDY_MARK: &str = "<hz-tidy/>";

const TIDY_PROMPT: &str = "<hz-tidy/>Tidy your memory now. Use memory_list and memory_read to go through every note. \
Merge notes that say the same thing, fix ones that contradict a newer note, and forget the ones that are stale or \
empty, using memory_write to save the merged versions and writing nothing else. Do not touch notes that are still \
right. Reply with a short summary in the language of your instructions: what you merged, what you changed and what \
you dropped, one line each. If everything was already tidy, say so in one line.";

/// What the last tidy did, in the agent's own words.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Tidied {
    pub at_ms: u64,
    pub summary: String,
    /// Notes in the folder before and after, counted by the app and not by the
    /// agent, so the summary can be checked against them.
    pub before: u32,
    pub after: u32,
}

async fn count_notes(memory: &Path) -> u32 {
    let Ok(mut read) = tokio::fs::read_dir(memory).await else { return 0 };
    let mut n = 0;
    while let Ok(Some(entry)) = read.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name != "MEMORY.md" && agents::note_path(memory, &name).is_ok() {
            n += 1;
        }
    }
    n
}

/// Notes in an agent's memory folder, for deciding whether a tidy is worth a turn.
pub async fn note_count(agent_id: &str) -> u32 {
    match agents::memory_dir_for(agent_id).await {
        Ok(dir) => count_notes(&dir).await,
        Err(_) => 0,
    }
}

/// The last tidy, if the agent has ever done one.
#[tauri::command]
pub async fn agent_memory_tidied(agent_id: String) -> Result<Option<Tidied>, String> {
    let root = agent_root(&agent_id).await.map_err(|e| e.to_string())?;
    Ok(tokio::fs::read_to_string(root.join("tidied.json"))
        .await
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok()))
}

/// Asks the agent to consolidate its own notes and waits for its summary.
///
/// A real turn on the agent's own conversation, sent as a hidden prompt: the
/// agent decides what is a duplicate, and it does the merging with the same
/// memory tools it uses at any other time. Nothing here edits a note.
#[tauri::command]
pub async fn agent_memory_tidy(agent_id: String, app: tauri::AppHandle) -> Result<Tidied, String> {
    let agent = agents::by_id(&agent_id).ok_or("unknown agent")?;
    let memory = agents::memory_dir_for(&agent_id).await?;
    let root = agent_root(&agent_id).await.map_err(|e| e.to_string())?;
    let before = count_notes(&memory).await;

    let summary = crate::team::ask_hidden(&agent, TIDY_PROMPT, &app)
        .await
        .map_err(|e| format!("{e:#}"))?;

    let tidied = Tidied { at_ms: now_ms(), summary, before, after: count_notes(&memory).await };
    let _ = atomic_write(
        &root.join("tidied.json"),
        &serde_json::to_vec_pretty(&tidied).unwrap_or_default(),
    )
    .await;
    Ok(tidied)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hz-profile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_summary_names_the_size_of_the_edit() {
        assert_eq!(summarize("a\nb", "a\nb\nc\nd"), "Added 2 lines");
        assert_eq!(summarize("a\nb\nc", "a"), "Removed 2 lines");
        assert_eq!(summarize("a\nb", "a\nx"), "Added 1, removed 1 lines");
        assert_eq!(summarize("a", "a "), "Reworded");
    }

    #[tokio::test]
    async fn each_save_appends_a_version_and_an_unchanged_text_adds_none() {
        let root = temp();
        let first = append_version(&root, "one", None).await.unwrap().unwrap();
        assert_eq!((first.n, first.summary.as_str()), (1, "First version"));

        assert!(append_version(&root, "one", None).await.unwrap().is_none());

        let second = append_version(&root, "one\ntwo", None).await.unwrap().unwrap();
        assert_eq!((second.n, second.summary.as_str()), (2, "Added 1 line"));

        let listed = read_versions(&root).await;
        assert_eq!(listed.iter().map(|v| v.n).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(listed[1].text, "one", "an old version is never rewritten");
    }

    #[tokio::test]
    async fn a_restore_is_a_new_version_and_leaves_the_old_one_alone() {
        let root = temp();
        append_version(&root, "v1 text", None).await.unwrap();
        append_version(&root, "v2 text", None).await.unwrap();

        let made = append_version(&root, "v1 text", Some("Restored V1".into())).await.unwrap().unwrap();

        assert_eq!((made.n, made.summary.as_str()), (3, "Restored V1"));
        let all = read_versions(&root).await;
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].text, "v1 text");
        assert_eq!(all[2].text, "v1 text", "V1 itself is untouched");
    }

    #[tokio::test]
    async fn reads_are_counted_per_note() {
        let memory = temp();
        bump_usage(&memory, "a.md").await.unwrap();
        bump_usage(&memory, "a.md").await.unwrap();
        bump_usage(&memory, "b.md").await.unwrap();

        let usage = read_usage(&memory).await;
        assert_eq!(usage["a.md"].count, 2);
        assert_eq!(usage["b.md"].count, 1);
        assert!(usage["a.md"].last_ms > 0);
    }

    #[test]
    fn forgetting_takes_the_index_line_and_keeps_it_for_undo() {
        let index = "# Memory\n\n- [Pricing](pricing.md) — decision\n- [Tone](tone.md) — about you\n";
        let (rest, line) = pop_index_line(index, "pricing.md");

        assert_eq!(line.as_deref(), Some("- [Pricing](pricing.md) — decision"));
        assert!(!rest.contains("pricing.md") && rest.contains("tone.md"));
        let (same, none) = pop_index_line(index, "missing.md");
        assert!(none.is_none() && same == index);
    }
}
