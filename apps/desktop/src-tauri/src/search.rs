//! Finding a word in the sessions this app has kept.
//!
//! **Every session's log, not the ones already loaded.** What a reader searches
//! for is a sentence they remember writing or reading, and the session it is in
//! is exactly the one they have not opened — searching the transcripts in memory
//! would answer "not here" for everything they are actually looking for.
//!
//! The price is reading files, so the read is bounded twice: a line over
//! [`MAX_LINE`] is skipped rather than searched, and the walk stops the moment it
//! has [`DEFAULT_LIMIT`] hits. Both are stated costs — a match inside a
//! multi-megabyte tool result is one this misses.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::process::Command;
use serde_json::Value;
use std::path::Path;
use tokio::{
    fs,
    io::{AsyncBufReadExt, BufReader},
};
use ts_rs::TS;

use crate::{
    proc::HideConsole,
    store::{self, SessionIndexItem},
    Fail,
};

/// How much of one line is looked at.
///
/// A log carries base64 images and whole file reads, and one of those is
/// megabytes on a single line. Well past any sentence a reader would search for,
/// and well under the point where a walk over a few hundred sessions is a wait.
const MAX_LINE: usize = 64 * 1024;

/// How much either side of a hit is shown.
const WINDOW: usize = 60;

/// What one look answers with. Twenty rows is more than a reader scrolls in a
/// palette, and the box narrows as they type rather than paging.
pub const DEFAULT_LIMIT: usize = 20;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct TranscriptMatch {
    pub session_id: String,
    /// The session's title, so a row draws without a second read.
    pub title: String,
    /// Position in that session's log — the ordering key, and what a reader
    /// would need to be taken to the sentence.
    pub seq: u32,
    /// The words around the hit, elided at both ends where they were cut.
    pub snippet: String,
}

/// Where `needle` sits in `text`, folded on ASCII case alone.
///
/// **Not `to_lowercase().find(…)`**, which is the obvious spelling and is wrong
/// for slicing: a fold can change byte lengths (`İ` lowercases to two chars), so
/// an index into the folded string can land inside a character of the original
/// and panicking on the slice is the ordinary outcome. This walks byte windows of
/// the *original* and folds each pair as it compares, which cannot be out of
/// step with what it returns. Cost, stated: case is folded only for ASCII, so
/// `über` does not find `Über`.
fn find_ascii_ci(text: &str, needle: &str) -> Option<usize> {
    let hay = text.as_bytes();
    let needle = needle.as_bytes();
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }

    (0..=hay.len() - needle.len()).find(|&at| {
        text.is_char_boundary(at)
            && hay[at..at + needle.len()].eq_ignore_ascii_case(needle)
    })
}

/// A window of `text` around the hit, elided at whichever end was cut.
fn window(text: &str, at: usize, width: usize) -> String {
    let start = at.saturating_sub(WINDOW);
    let end = (at + width + WINDOW).min(text.len());
    let start = (0..=start).rev().find(|&i| text.is_char_boundary(i)).unwrap_or(0);
    let end = (end..=text.len()).find(|&i| text.is_char_boundary(i)).unwrap_or(text.len());

    format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        text[start..end].trim(),
        if end < text.len() { "…" } else { "" },
    )
}

/// The first string **value** in this event that holds the query.
///
/// Two things it deliberately does not look at, and both are the difference
/// between a result list about the reader's words and one about the file format:
///
/// - **Keys.** A search for `text` against the raw JSON matches every line in
///   every log, since every line has that key.
/// - **`payload.type`.** The one *value* that is still schema: it is a closed
///   vocabulary — `assistant_text`, `tool_call`, `reasoning` — so searching it
///   finds every assistant message in the app rather than the sentence the reader
///   meant. Every other value under the payload is something a person or an agent
///   wrote, which is what is being searched.
pub fn snippet_of(event: &Value, needle: &str) -> Option<String> {
    find(event.get("payload")?, needle)
}

fn find(value: &Value, needle: &str) -> Option<String> {
    match value {
        Value::String(text) => hit(text, needle),
        Value::Array(items) => items.iter().find_map(|item| find(item, needle)),
        Value::Object(fields) => fields
            .iter()
            .filter(|(key, _)| key.as_str() != "type")
            .find_map(|(_, value)| find(value, needle)),
        _ => None,
    }
}

fn hit(text: &str, needle: &str) -> Option<String> {
    if text.len() > MAX_LINE {
        return None;
    }
    let at = find_ascii_ci(text, needle)?;
    Some(window(text, at, needle.len()))
}

/// What the walk needs from an index entry.
///
/// Its own shape rather than [`SessionIndexItem`]: three strings is what this
/// reads, and taking the whole entry would make the search depend on the shape of
/// a session — and the test's fixture, too.
pub struct Findable<'a> {
    pub session_id: &'a str,
    pub title: &'a str,
    pub modified: &'a str,
}

impl<'a> From<&'a SessionIndexItem> for Findable<'a> {
    fn from(item: &'a SessionIndexItem) -> Self {
        Self {
            session_id: &item.session_id,
            title: &item.title,
            modified: &item.modified,
        }
    }
}

/// Walks these sessions' logs, newest first, and answers with what matched.
///
/// The index is the caller's rather than read here so a test can hand in its own
/// rows: the reader's `~/.hz` is not something a test may write to.
pub async fn search_sessions(
    sessions_dir: &Path,
    index: &[Findable<'_>],
    query: &str,
    limit: usize,
) -> Result<Vec<TranscriptMatch>> {
    let needle = query.trim();
    if needle.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    // Newest first: a reader searching for something they wrote is far more
    // likely to want last week's session than one from March, and the limit has
    // to be spent on the likelier end.
    let mut ordered: Vec<&Findable> = index.iter().collect();
    ordered.sort_by(|a, b| b.modified.cmp(a.modified));

    let mut found = Vec::new();
    for item in ordered {
        if found.len() >= limit {
            break;
        }

        let path = sessions_dir.join(format!("{}.jsonl", item.session_id));
        let Ok(file) = fs::File::open(&path).await else {
            // A session in the index with no log yet is ordinary — the entry is
            // written before its process spawns.
            continue;
        };

        let mut lines = BufReader::new(file).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.len() > MAX_LINE {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };

            let Some(snippet) = snippet_of(&event, needle) else {
                continue;
            };
            let seq = event.get("seq").and_then(Value::as_u64).unwrap_or_default();

            found.push(TranscriptMatch {
                session_id: item.session_id.to_string(),
                title: item.title.to_string(),
                seq: seq as u32,
                snippet,
            });

            if found.len() >= limit {
                break;
            }
        }
    }

    Ok(found)
}

#[tauri::command]
pub async fn search_transcripts(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<TranscriptMatch>, Fail> {
    let dir = store::get_sessions_dir().await?;
    // Bound, not chained: `Findable` borrows the entries, so the read has to
    // outlive the map over it.
    let items = store::read_index().await?;
    let index: Vec<Findable> = items.iter().map(Into::into).collect();

    Ok(search_sessions(&dir, &index, &query, limit.unwrap_or(DEFAULT_LIMIT)).await?)
}

/// How many matches a project search may answer with.
///
/// More than a palette draws — the rows are sliced where they are built — and few
/// enough that the parse stays a walk over one buffer. A query this large an
/// answer to is a query somebody has to narrow.
pub const MAX_CONTENT_MATCHES: usize = 200;

/// One line of one file that a query was found on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ContentMatch {
    /// Absolute, so a row can open it: `git grep` answers relative to the root it
    /// was run in, and the reader's own cwd is what the app opens from.
    pub path: String,
    /// The same file as git spells it — the row's own text, and the shortest thing
    /// that tells two files with one basename apart.
    pub relative: String,
    /// One-based, because that is how every editor numbers a line and how the
    /// reader counts.
    pub line: u32,
    /// The line itself, trimmed at both ends: the row *is* the line, and leading
    /// indentation is the least interesting part of it.
    pub text: String,
}

/// What one search answers with.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ContentMatches {
    pub matches: Vec<ContentMatch>,
    /// Whether the cap cut the answer short — said rather than hidden, since a
    /// reader who narrowed nothing else would otherwise read a slice as the whole.
    pub truncated: bool,
}

/// What a query found in the files this session's project holds.
///
/// **`git grep`, not a walk of our own.** One process, `git`'s own view of the
/// project, and no dependency added to read a tree: the alternative is the `ignore`
/// crate walking and a read per file, which is more code to get the same answer
/// more slowly. It also decides *which* files — the repository's own ignore rules,
/// so `node_modules` and `target` are never searched.
///
/// **`--untracked` is the one flag the vendor's own search does not pass, and it is
/// the one that matters here.** A file the agent wrote a moment ago is exactly what
/// a reader searches for, and it is not in the index yet — without this the search
/// would answer "not here" about the file that is on their screen. `-I` keeps
/// binaries out of the answer; `-i`/`-F` are the same case-insensitive literal the
/// transcript search takes, so one habit works in both boxes.
///
/// **A session outside a repository finds nothing**, which the palette reads as no
/// results rather than as an error: there is nothing to be wrong about, and a
/// sentence about it would sit between the reader and the rows that did work.
#[tauri::command]
pub async fn search_content(cwd: String, query: String) -> Result<ContentMatches, Fail> {
    let needle = query.trim();
    if needle.is_empty() {
        return Ok(ContentMatches::default());
    }

    let root = Path::new(&cwd);
    if !root.is_dir() {
        return Ok(ContentMatches::default());
    }

    let Ok(out) = Command::new("git").hide_console()
        .args([
            "grep",
            "-z",
            "-n",
            "-I",
            "--untracked",
            "-i",
            "-F",
            "-e",
            needle,
            "--",
        ])
        .current_dir(root)
        // A search never takes the index lock; the reader is usually working.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
    else {
        return Ok(ContentMatches::default());
    };

    // **Exit 1 is an answer, not a failure**: it is how `git grep` says it found
    // nothing. Anything else (128 for "not a repository", a git that would not run)
    // is the case the palette reads as no results.
    match out.status.code() {
        Some(0) => {}
        Some(1) => return Ok(ContentMatches::default()),
        _ => return Ok(ContentMatches::default()),
    }

    let mut matches = Vec::new();
    let mut truncated = false;
    let mut rest = out.stdout.as_slice();

    while !rest.is_empty() {
        let Some((relative, after_path)) = take_nul(rest) else {
            break;
        };
        let Some((line, after_line)) = take_nul(after_path) else {
            break;
        };
        let text_end = line_text_end(after_line);
        let text = String::from_utf8_lossy(&after_line[..text_end]);
        rest = &after_line[text_end + 1..];

        if relative.is_empty() {
            continue;
        }
        if matches.len() >= MAX_CONTENT_MATCHES {
            truncated = true;
            break;
        }

        matches.push(ContentMatch {
            // `git grep` spells a path with `/` on every platform, so it is
            // translated rather than joined as it stands: a Windows path assembled
            // from a `/`-spelled relative comes out with both separators in it, and
            // every comparison against it downstream is then a string comparison
            // that fails for a reason nothing on screen explains.
            path: root
                .join(relative.replace('/', std::path::MAIN_SEPARATOR_STR))
                .to_string_lossy()
                .into_owned(),
            relative,
            line: line.parse().unwrap_or(1),
            // `-z` leaves the newline that ended the line on the text, and the last
            // line of a file has none.
            text: text.trim_end_matches('\n').trim().to_string(),
        });
    }

    Ok(ContentMatches { matches, truncated })
}

/// The bytes up to the next NUL, and what follows it. `None` where there is no
/// NUL left, which is how a truncated read ends.
fn take_nul(bytes: &[u8]) -> Option<(String, &[u8])> {
    let end = bytes.iter().position(|byte| *byte == 0)?;
    Some((
        String::from_utf8_lossy(&bytes[..end]).into_owned(),
        &bytes[end + 1..],
    ))
}

/// Where one matched line's text ends — the newline that closed it, or the end of
/// the buffer for a file whose last line has none.
fn line_text_end(bytes: &[u8]) -> usize {
    bytes.iter().position(|byte| *byte == b'\n').unwrap_or(bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    /// A repository with files in it, made for one test and removed with it.
    ///
    /// **A real `git init` rather than a mock**, because the whole command is one
    /// spawn: what it is asked, how its answer is shaped and which files it
    /// considers at all are `git`'s behaviour, and a fake would pin none of it.
    async fn repo(files: &[(&str, &str)]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hz-search-{}", Uuid::now_v7()));
        tokio::fs::create_dir_all(&dir).await.expect("temp dir");
        let ok = std::process::Command::new("git").hide_console()
            .args(["init", "-q"])
            .current_dir(&dir)
            .status()
            .expect("git init");
        assert!(ok.success());
        for (name, body) in files {
            let path = dir.join(name);
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await.expect("parent");
            }
            tokio::fs::write(&path, body).await.expect("file");
        }
        dir
    }

    /// The line, the file and the place in it — what a row draws and what it opens.
    #[tokio::test]
    async fn answers_with_the_line_and_the_file_it_is_in() {
        let dir = repo(&[
            ("a.txt", "alpha needle here\nsecond needle\n"),
            ("sub/b.txt", "needle down here\n"),
            ("clean.txt", "nothing to see\n"),
        ])
        .await;
        let found = search_content(dir.to_string_lossy().into_owned(), "needle".into())
            .await
            .expect("search");

        let lines: Vec<(String, u32, String)> = found
            .matches
            .iter()
            .map(|m| (m.relative.clone(), m.line, m.text.clone()))
            .collect();
        assert_eq!(
            lines,
            vec![
                ("a.txt".into(), 1, "alpha needle here".into()),
                ("a.txt".into(), 2, "second needle".into()),
                ("sub/b.txt".into(), 1, "needle down here".into()),
            ]
        );
        assert!(!found.truncated);
        // Absolute, so the row can hand it to the file view without joining again.
        assert!(found.matches[0].path.ends_with("a.txt"));
        // Absolute on every platform, which `/` is not: the point is that the row
        // can hand this to the file view without joining anything again.
        assert!(std::path::Path::new(&found.matches[0].path).is_absolute());

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    /// **The file the agent just wrote is the one a reader searches for**, and it is
    /// not in the index yet — which is why the spawn passes `--untracked`.
    #[tokio::test]
    async fn finds_a_file_that_was_never_added() {
        let dir = repo(&[("tracked.txt", "needle\n")]).await;
        tokio::fs::write(dir.join("fresh.txt"), "needle in a new file\n")
            .await
            .expect("new file");

        let found = search_content(dir.to_string_lossy().into_owned(), "NEEDLE".into())
            .await
            .expect("search");
        let relatives: Vec<&str> = found.matches.iter().map(|m| m.relative.as_str()).collect();
        assert!(relatives.contains(&"fresh.txt"), "{relatives:?}");
        // Case-insensitively, like the transcript box: one habit, two searches.
        assert!(relatives.contains(&"tracked.txt"), "{relatives:?}");

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    /// A query with nothing behind it, an empty box, a directory that is not a
    /// repository, and a cwd that is gone. None of them may reach the palette as an
    /// error.
    #[tokio::test]
    async fn answers_nothing_rather_than_failing() {
        let dir = repo(&[("a.txt", "needle\n")]).await;
        let cwd = dir.to_string_lossy().into_owned();

        assert_eq!(
            search_content(cwd.clone(), "absent".into()).await.unwrap(),
            ContentMatches::default()
        );
        assert_eq!(
            search_content(cwd.clone(), "   ".into()).await.unwrap(),
            ContentMatches::default()
        );
        assert_eq!(
            search_content(dir.join("gone").to_string_lossy().into_owned(), "needle".into())
                .await
                .unwrap(),
            ContentMatches::default()
        );
        let plain = std::env::temp_dir().join(format!("hz-search-plain-{}", Uuid::now_v7()));
        tokio::fs::create_dir_all(&plain).await.expect("temp dir");
        tokio::fs::write(plain.join("a.txt"), "needle")
            .await
            .expect("file");
        assert_eq!(
            search_content(plain.to_string_lossy().into_owned(), "needle".into())
                .await
                .unwrap(),
            ContentMatches::default()
        );

        let _ = tokio::fs::remove_dir_all(&dir).await;
        let _ = tokio::fs::remove_dir_all(&plain).await;
    }

    /// The cap is said, not silent: a reader who narrowed nothing else has to be
    /// able to tell a slice from the whole.
    #[tokio::test]
    async fn stops_at_the_cap_and_says_so() {
        let body: String = (0..MAX_CONTENT_MATCHES + 20).map(|_| "needle\n").collect();
        let dir = repo(&[("many.txt", &body)]).await;

        let found = search_content(dir.to_string_lossy().into_owned(), "needle".into())
            .await
            .expect("search");
        assert_eq!(found.matches.len(), MAX_CONTENT_MATCHES);
        assert!(found.truncated);

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    /// An ignored file is not part of the project, and `git grep` is what decides
    /// that — the reason this spawns git instead of walking.
    #[tokio::test]
    async fn leaves_ignored_files_out() {
        let dir = repo(&[(".gitignore", "*.log\n"), ("a.txt", "needle\n")]).await;
        tokio::fs::write(dir.join("noise.log"), "needle\n")
            .await
            .expect("ignored file");

        let found = search_content(dir.to_string_lossy().into_owned(), "needle".into())
            .await
            .expect("search");
        let relatives: Vec<&str> = found.matches.iter().map(|m| m.relative.as_str()).collect();
        assert_eq!(relatives, vec!["a.txt"]);

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    fn event(text: &str) -> Value {
        json!({ "seq": 7, "payload": { "type": "assistant_text", "text": text } })
    }

    #[test]
    fn a_hit_is_found_wherever_it_sits_in_the_event() {
        assert!(snippet_of(&event("the retry loop is wrong"), "retry").is_some());
        // Deep in an array of tool output.
        let nested = json!({ "payload": { "content": [{ "type": "text", "text": "x retry y" }] } });
        assert!(snippet_of(&nested, "retry").is_some());
        assert!(snippet_of(&event("nothing here"), "retry").is_none());
    }

    /// **The trap this walk exists for.** Every line names its own type, so
    /// searching the raw JSON for a schema word matches every line in the file —
    /// a result list made of the format rather than of anything written.
    #[test]
    fn neither_a_key_nor_the_discriminator_is_a_hit() {
        let line = json!({
            "seq": 7,
            "payload": { "type": "assistant_text", "text": "nothing to do with it" },
        });

        // A value, and still schema: matching it would find every assistant
        // message in the app rather than the sentence the reader meant.
        assert!(snippet_of(&line, "assistant_text").is_none());
        // And a key is not text at all — `text` is on every event there is.
        assert!(snippet_of(&line, "text").is_none());
        assert!(snippet_of(&line, "nothing").is_some());
    }

    #[test]
    fn case_is_folded_and_the_window_is_elided() {
        let long = format!("{}Retry{}", "a".repeat(200), "b".repeat(200));
        let snippet = snippet_of(&event(&long), "retry").unwrap();
        assert!(snippet.contains("Retry"), "the original spelling: {snippet}");
        assert!(snippet.starts_with('…') && snippet.ends_with('…'), "{snippet}");
        assert!(snippet.len() < long.len());
    }

    /// **The reason the fold is only ASCII, asserted rather than described.** `İ`
    /// lowercases to two characters, so an index into a folded copy can land
    /// inside a character of the original and slicing there panics. This walks
    /// byte windows of the original instead, so the worst a letter outside ASCII
    /// can do is not be found.
    #[test]
    fn a_letter_the_fold_cannot_touch_is_missed_rather_than_mangled() {
        let text = format!("{}İstanbul", "x".repeat(100));

        assert!(snippet_of(&event(&text), "istanbul").is_none(), "only ASCII folds");
        // Everything around it still matches, which is what proves the walk did
        // not fall over on the way past.
        assert!(snippet_of(&event(&text), "stanbul").is_some());
    }

    fn item<'a>(id: &'a str, title: &'a str, modified: &'a str) -> Findable<'a> {
        Findable {
            session_id: id,
            title,
            modified,
        }
    }

    #[tokio::test]
    async fn the_walk_stops_at_the_limit_and_reads_newest_first() {
        let dir = std::env::temp_dir().join(format!("hz-search-{}", Uuid::now_v7()));
        fs::create_dir_all(&dir).await.unwrap();

        for (id, text) in [("old", "retry one"), ("new", "retry two")] {
            let line = serde_json::to_string(&event(text)).unwrap();
            fs::write(dir.join(format!("{id}.jsonl")), format!("{line}\n"))
                .await
                .unwrap();
        }

        let index = [
            item("old", "the old one", "2026-01-01T00:00:00Z"),
            item("new", "the new one", "2026-09-01T00:00:00Z"),
        ];

        let all = search_sessions(&dir, &index, "retry", 10).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].session_id, "new", "newest first");
        assert_eq!(all[0].title, "the new one");

        let one = search_sessions(&dir, &index, "retry", 1).await.unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].session_id, "new");

        assert!(search_sessions(&dir, &index, "   ", 10).await.unwrap().is_empty());
        assert!(search_sessions(&dir, &index, "absent", 10).await.unwrap().is_empty());

        // An index entry with no log is ordinary, not an error.
        let index = [item("never-spawned", "no log", "2026-09-02T00:00:00Z")];
        assert!(search_sessions(&dir, &index, "retry", 10).await.unwrap().is_empty());

        fs::remove_dir_all(&dir).await.ok();
    }

    /// A screenshot's line is megabytes of base64. Reading it whole is the cost
    /// this cap exists for, and there is nothing in one to find.
    #[tokio::test]
    async fn an_enormous_line_is_skipped_rather_than_searched() {
        let dir = std::env::temp_dir().join(format!("hz-search-{}", Uuid::now_v7()));
        fs::create_dir_all(&dir).await.unwrap();

        let huge = serde_json::to_string(&event(&format!("retry{}", "x".repeat(MAX_LINE)))).unwrap();
        fs::write(dir.join("big.jsonl"), format!("{huge}\n")).await.unwrap();

        let index = [item("big", "screenshot", "2026-09-01T00:00:00Z")];
        assert!(search_sessions(&dir, &index, "retry", 10).await.unwrap().is_empty());

        fs::remove_dir_all(&dir).await.ok();
    }
}
