//! The `memory` MCP tools: how an agent reads and writes its notes.
//!
//! Served on the same loopback port as the team's tools, at
//! `/mcp/<agent id>/memory`. The agent still gets plain Markdown back — the notes
//! are the same files the profile page edits — but reading through a tool is what
//! lets hz count it, which is the whole of "used in N answers".
//!
//! A note's tag and provenance live in a small front matter block at the top of
//! the file (`tag`, `by`, `learned`, `source`). The profile page reads the same
//! block; a note written by hand without one is just untagged.

use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{json, Value};

use crate::{agent_profile, agents};

/// The tags the page groups notes by. A tag outside these is kept as written but
/// gets no tab of its own.
pub const TAGS: [&str; 3] = ["About you", "Project", "Decision"];

pub(crate) fn tools() -> Value {
    json!([
        {
            "name": "memory_list",
            "description": "List your notes: file name, tag and the first line of each. Start here to see what \
                            you already know.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        },
        {
            "name": "memory_read",
            "description": "Read one of your notes by file name, as memory_list shows it. A name starting with \
                            shared/ is a note every teammate can read, when the team has shared memory on.",
            "inputSchema": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "The note's file name, ending in .md."}},
                "required": ["name"],
                "additionalProperties": false,
            },
        },
        {
            "name": "memory_write",
            "description": "Save a note, replacing the one with that name. Keep one subject to a note. Say where \
                            you learned it in `source` when it came from something the person said. Never store \
                            secrets.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "A short file name ending in .md, such as pricing-pro.md."},
                    "content": {"type": "string", "description": "The note, in Markdown. Start with a # title."},
                    "tag": {"type": "string", "enum": TAGS, "description": "What kind of note it is."},
                    "source": {"type": "string", "description": "A short quote or place it came from."},
                },
                "required": ["name", "content"],
                "additionalProperties": false,
            },
        },
    ])
}

/// A note split into its front matter pairs and its body. Only `key: value`
/// lines between two `---` fences count; anything else is body.
pub fn split_front(text: &str) -> (Vec<(String, String)>, &str) {
    let Some(rest) = text.strip_prefix("---\n") else { return (Vec::new(), text) };
    let Some(end) = rest.find("\n---") else { return (Vec::new(), text) };
    let block = &rest[..end];
    let after = &rest[end + 4..];
    let body = after.strip_prefix('\n').unwrap_or(after);

    let mut pairs = Vec::new();
    for line in block.lines() {
        let Some((k, v)) = line.split_once(':') else { return (Vec::new(), text) };
        pairs.push((k.trim().to_string(), unquote(v.trim())));
    }
    (pairs, body)
}

fn unquote(v: &str) -> String {
    match v.strip_prefix('"').and_then(|x| x.strip_suffix('"')) {
        Some(inner) => inner.replace("\\\"", "\"").replace("\\\\", "\\"),
        None => v.to_string(),
    }
}

/// Front matter then body. Values with a colon or quote are quoted so the block
/// reads back the way it was written.
pub fn compose(pairs: &[(String, String)], body: &str) -> String {
    if pairs.is_empty() {
        return body.to_string();
    }
    let mut out = String::from("---\n");
    for (k, v) in pairs {
        let flat = v.replace('\n', " ");
        if flat.contains([':', '"', '#']) || flat != flat.trim() {
            out.push_str(&format!("{k}: \"{}\"\n", flat.replace('\\', "\\\\").replace('"', "\\\"")));
        } else {
            out.push_str(&format!("{k}: {flat}\n"));
        }
    }
    out.push_str("---\n");
    out.push_str(body);
    out
}

fn get<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

fn set(pairs: &mut Vec<(String, String)>, key: &str, value: String) {
    match pairs.iter_mut().find(|(k, _)| k == key) {
        Some(slot) => slot.1 = value,
        None => pairs.push((key.to_string(), value)),
    }
}

/// The first line of a note worth showing in a list: past the front matter and
/// the title, a sentence of the body.
pub fn first_line(body: &str) -> String {
    body.lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| l.trim_start_matches(['-', '*', ' ']).chars().take(100).collect())
        .unwrap_or_default()
}

fn title_of(body: &str, name: &str) -> String {
    body.lines()
        .find_map(|l| l.strip_prefix("# "))
        .map(|t| t.trim().to_string())
        .unwrap_or_else(|| name.trim_end_matches(".md").replace('-', " "))
}

/// A note file name from whatever the agent sent: `.md` added, spaces to hyphens.
fn clean_name(raw: &str) -> String {
    let base = raw.trim().replace(' ', "-");
    if base.ends_with(".md") {
        base
    } else {
        format!("{base}.md")
    }
}

/// The prefix that sends a note name to the workspace's shared folder.
const SHARED_PREFIX: &str = "shared/";

/// The workspace folder every agent in it can read and write, when the reader
/// switched shared memory on. Created on first use with an index like any other.
async fn shared_dir(agent_id: &str) -> Result<std::path::PathBuf> {
    let agent = agents::by_id(agent_id).context("unknown agent")?;
    let ws = agent.workspace_id.context("this agent is in no workspace")?;
    anyhow::ensure!(
        crate::workspaces::defaults_of(&ws).shared_memory,
        "shared memory is off for this workspace; the reader can switch it on in Settings, Agent defaults"
    );
    let dir = crate::store::get_home_app_dir().await?.join("workspaces").join(&ws).join("memory");
    tokio::fs::create_dir_all(&dir).await?;
    let index = dir.join("MEMORY.md");
    if !tokio::fs::try_exists(&index).await.unwrap_or(false) {
        let _ = tokio::fs::write(&index, "# Shared memory\n\n").await;
    }
    Ok(dir)
}

/// Whether the shared folder is on for this agent's workspace.
fn shared_on(agent_id: &str) -> bool {
    agents::by_id(agent_id)
        .and_then(|a| a.workspace_id)
        .is_some_and(|ws| crate::workspaces::defaults_of(&ws).shared_memory)
}

/// Answers one tool call for `agent_id`.
pub async fn call(agent_id: &str, name: &str, args: &Value) -> Result<String> {
    anyhow::ensure!(agents::tool_enabled(agent_id, "memory"), "memory is switched off for you");
    let own = agents::memory_dir_for(agent_id).await.map_err(anyhow::Error::msg)?;
    let arg = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or_default();

    // A name under `shared/` lives in the workspace's folder; every other is the
    // agent's own.
    let raw_name = arg("name").trim();
    let (dir, raw_name) = match raw_name.strip_prefix(SHARED_PREFIX) {
        Some(rest) => (shared_dir(agent_id).await?, rest),
        None => (own.clone(), raw_name),
    };

    match name {
        "memory_list" => {
            let mut text = list(&own).await?;
            if shared_on(agent_id) {
                let shared = list(&shared_dir(agent_id).await?).await.unwrap_or_default();
                if !shared.starts_with("You have no notes") && !shared.is_empty() {
                    let prefixed = shared.lines().map(|l| l.replacen("- ", &format!("- {SHARED_PREFIX}"), 1)).collect::<Vec<_>>().join("\n");
                    text.push_str(&format!("\n\nShared with the whole team (use the {SHARED_PREFIX} prefix to read or write):\n{prefixed}"));
                }
            }
            Ok(text)
        }
        "memory_read" => {
            let note = clean_name(raw_name);
            let path = agents::note_path(&dir, &note)?;
            let text = tokio::fs::read_to_string(&path)
                .await
                .with_context(|| format!("no note named {note}; memory_list shows what there is"))?;
            // Counted only once the read has succeeded, so a guess at a name that
            // is not there does not raise a number it never earned.
            if note != "MEMORY.md" {
                let _ = agent_profile::bump_usage(&dir, &note).await;
            }
            Ok(text)
        }
        "memory_write" => write(&dir, &clean_name(raw_name), arg("content"), arg("tag"), arg("source")).await,
        other => anyhow::bail!("no tool {other}"),
    }
}

async fn list(dir: &Path) -> Result<String> {
    let mut read = tokio::fs::read_dir(dir).await?;
    let mut rows = Vec::new();
    while let Some(entry) = read.next_entry().await? {
        let file = entry.file_name().to_string_lossy().into_owned();
        if file == "MEMORY.md" || agents::note_path(dir, &file).is_err() {
            continue;
        }
        let text = tokio::fs::read_to_string(entry.path()).await.unwrap_or_default();
        let (front, body) = split_front(&text);
        let tag = get(&front, "tag").map_or(String::new(), |t| format!(" [{t}]"));
        rows.push(format!("- {file}{tag} — {}", first_line(body)));
    }
    rows.sort();
    if rows.is_empty() {
        return Ok("You have no notes yet. Save what should last with memory_write.".into());
    }
    Ok(rows.join("\n"))
}

async fn write(dir: &Path, name: &str, content: &str, tag: &str, source: &str) -> Result<String> {
    anyhow::ensure!(!content.trim().is_empty(), "memory_write needs `content`");
    anyhow::ensure!(name != "MEMORY.md", "the index is kept for you; write a note instead");
    let path = agents::note_path(dir, name)?;

    let existing = tokio::fs::read_to_string(&path).await.ok();
    let (mut front, _) = existing.as_deref().map_or((Vec::new(), ""), split_front);
    let (given, body) = split_front(content);
    // Front matter the agent wrote itself is honoured for what it names, then the
    // tool's own arguments win.
    for (k, v) in given {
        set(&mut front, &k, v);
    }
    if !tag.trim().is_empty() {
        set(&mut front, "tag", tag.trim().to_string());
    }
    if !source.trim().is_empty() {
        set(&mut front, "source", source.trim().chars().take(240).collect());
    }
    set(&mut front, "by", "agent".into());
    if get(&front, "learned").is_none() {
        set(&mut front, "learned", chrono::Local::now().format("%Y-%m-%d").to_string());
    }

    tokio::fs::write(&path, compose(&front, body)).await?;
    ensure_indexed(dir, name, &title_of(body, name), get(&front, "tag")).await;
    Ok(format!("Saved {name}."))
}

/// Adds the note to MEMORY.md unless the index already points at it, so the file
/// the agent falls back to without tools stays a true list.
async fn ensure_indexed(dir: &Path, name: &str, title: &str, tag: Option<&str>) {
    let index_path = dir.join("MEMORY.md");
    let index = tokio::fs::read_to_string(&index_path).await.unwrap_or_default();
    if index.contains(&format!("({name})")) {
        return;
    }
    let line = match tag {
        Some(t) => format!("- [{title}]({name}) — {}", t.to_lowercase()),
        None => format!("- [{title}]({name})"),
    };
    let body = index.trim_end();
    let next = if body.is_empty() { format!("# Memory\n\n{line}\n") } else { format!("{body}\n{line}\n") };
    let _ = tokio::fs::write(&index_path, next).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn front_matter_splits_and_composes_back() {
        let text = "---\ntag: Decision\nsource: \"Fechado: R$ 89\"\n---\n# Pricing\n\nR$ 89.\n";
        let (front, body) = split_front(text);

        assert_eq!(get(&front, "tag"), Some("Decision"));
        assert_eq!(get(&front, "source"), Some("Fechado: R$ 89"));
        assert_eq!(body, "# Pricing\n\nR$ 89.\n");
        assert_eq!(compose(&front, body), text);
    }

    #[test]
    fn a_note_without_front_matter_is_all_body() {
        let (front, body) = split_front("# Plain\n\nJust text.\n");
        assert!(front.is_empty());
        assert_eq!(body, "# Plain\n\nJust text.\n");

        // A fence with prose inside is a horizontal rule, not front matter.
        let (front, body) = split_front("---\nsome prose without a colon\n---\nrest");
        assert!(front.is_empty());
        assert!(body.starts_with("---"));
    }

    #[test]
    fn the_list_line_skips_the_title() {
        assert_eq!(first_line("# Title\n\n- Quer números antes de opinião.\n"), "Quer números antes de opinião.");
    }

    #[test]
    fn a_name_gets_its_extension() {
        assert_eq!(clean_name("pricing pro"), "pricing-pro.md");
        assert_eq!(clean_name("a.md"), "a.md");
    }

    #[tokio::test]
    async fn a_written_note_is_tagged_indexed_and_keeps_its_first_date() {
        let dir = std::env::temp_dir().join(format!("hz-memory-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();

        write(&dir, "pricing.md", "# Pricing\n\nR$ 89.", "Decision", "Fechado.").await.unwrap();
        let first = tokio::fs::read_to_string(dir.join("pricing.md")).await.unwrap();
        let (front, _) = split_front(&first);
        assert_eq!(get(&front, "tag"), Some("Decision"));
        assert_eq!(get(&front, "by"), Some("agent"));
        assert_eq!(get(&front, "source"), Some("Fechado."));
        let learned = get(&front, "learned").unwrap().to_string();

        // Rewriting keeps the date it was learned and does not double the index.
        write(&dir, "pricing.md", "# Pricing\n\nR$ 99.", "", "").await.unwrap();
        let again = tokio::fs::read_to_string(dir.join("pricing.md")).await.unwrap();
        let (front, body) = split_front(&again);
        assert_eq!(get(&front, "learned"), Some(learned.as_str()));
        assert_eq!(get(&front, "tag"), Some("Decision"));
        assert!(body.contains("R$ 99"));
        let index = tokio::fs::read_to_string(dir.join("MEMORY.md")).await.unwrap();
        assert_eq!(index.matches("(pricing.md)").count(), 1);

        let listed = list(&dir).await.unwrap();
        assert!(listed.contains("pricing.md [Decision] — R$ 99."));
    }
}
