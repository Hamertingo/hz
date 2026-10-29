//! Bulk Gmail organising: a preview plan, a 50-message trial, then the rest, with a 30-day undo.
//!
//! Safe by construction: [`Action`] has no variant that deletes or trashes, and label changes that
//! name the trash or spam labels are refused. Nothing here talks to Gmail; it builds the
//! `batchModify` bodies and keeps the undo book. Callers pass fetched mail text through
//! `crate::agentkit::untrusted::wrap` before any agent reads it.

use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// How many messages the trial touches before the reader is asked about the rest.
pub const TRIAL_SIZE: usize = 50;
/// Gmail's `batchModify` takes at most this many ids per call.
pub const BATCH_LIMIT: usize = 1000;
/// Days an undo entry stays valid.
pub const UNDO_DAYS: i64 = 30;
/// How many sample messages a plan shows.
pub const EXAMPLES: usize = 5;

/// What to do to every matched message. Deliberately no delete or trash variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Action {
    Archive,
    /// Label id to add; the message also leaves the inbox.
    MoveToLabel(String),
    /// Label id to add; the message stays where it is.
    AddLabel(String),
    MarkRead,
}

/// Label ids to add and remove in one `batchModify`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct LabelChange {
    pub add: Vec<String>,
    pub remove: Vec<String>,
}

fn forbidden_label(id: &str) -> bool {
    matches!(id.trim().to_ascii_uppercase().as_str(), "TRASH" | "DELETE" | "DELETED" | "SPAM")
}

fn check_label(id: &str) -> Result<()> {
    if id.trim().is_empty() {
        bail!("label id is empty");
    }
    if forbidden_label(id) {
        bail!("label {id} is not allowed: organising never trashes or deletes");
    }
    Ok(())
}

impl Action {
    /// The label ids this action adds and removes, or an error for a refused label.
    pub fn label_change(&self) -> Result<LabelChange> {
        Ok(match self {
            Action::Archive => LabelChange { add: vec![], remove: vec!["INBOX".into()] },
            Action::MarkRead => LabelChange { add: vec![], remove: vec!["UNREAD".into()] },
            Action::AddLabel(l) => {
                check_label(l)?;
                LabelChange { add: vec![l.clone()], remove: vec![] }
            }
            Action::MoveToLabel(l) => {
                check_label(l)?;
                LabelChange { add: vec![l.clone()], remove: vec!["INBOX".into()] }
            }
        })
    }

    /// One-line description for the preview card.
    pub fn describe(&self) -> String {
        match self {
            Action::Archive => "archive".into(),
            Action::MarkRead => "mark as read".into(),
            Action::AddLabel(l) => format!("add label {l}"),
            Action::MoveToLabel(l) => format!("move to {l}"),
        }
    }
}

/// `users.messages.batchModify` body for up to [`BATCH_LIMIT`] ids.
pub fn batch_modify_body(ids: &[String], action: &Action) -> Result<Value> {
    let c = action.label_change()?;
    modify_with(ids, &c)
}

fn modify_with(ids: &[String], c: &LabelChange) -> Result<Value> {
    if ids.is_empty() {
        bail!("no message ids");
    }
    if ids.len() > BATCH_LIMIT {
        bail!("batchModify takes at most {BATCH_LIMIT} ids");
    }
    for l in c.add.iter().chain(&c.remove) {
        if forbidden_label(l) {
            bail!("label {l} is not allowed");
        }
    }
    Ok(json!({ "ids": ids, "addLabelIds": c.add, "removeLabelIds": c.remove }))
}

/// Endpoint the bodies above are posted to.
pub const BATCH_MODIFY_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify";

/// One sample message shown in the preview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Example {
    pub id: String,
    pub from: String,
    pub subject: String,
}

/// What the reader approves before anything changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    pub query: String,
    pub action: Action,
    pub total: usize,
    pub examples: Vec<Example>,
    pub ids: Vec<String>,
}

impl Plan {
    /// Builds a plan from the ids a search found plus sample rows; refuses an empty result or a refused action.
    pub fn build(query: &str, action: Action, ids: Vec<String>, samples: Vec<Example>) -> Result<Plan> {
        action.label_change()?;
        if ids.is_empty() {
            bail!("the search matched no messages");
        }
        let mut seen = std::collections::HashSet::new();
        let ids: Vec<String> = ids.into_iter().filter(|i| seen.insert(i.clone())).collect();
        Ok(Plan {
            query: query.to_string(),
            action,
            total: ids.len(),
            examples: samples.into_iter().take(EXAMPLES).collect(),
            ids,
        })
    }

    /// The preview sentence an agent shows before asking to go ahead.
    pub fn summary(&self) -> String {
        format!("{} messages match \"{}\": {}", self.total, self.query, self.action.describe())
    }

    /// Splits the ids into the trial and the remainder.
    pub fn trial(&self) -> Trial {
        Trial::split(&self.ids)
    }
}

/// The first [`TRIAL_SIZE`] ids, then everything after them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trial {
    pub first: Vec<String>,
    pub rest: Vec<String>,
}

impl Trial {
    pub fn split(ids: &[String]) -> Trial {
        let n = ids.len().min(TRIAL_SIZE);
        Trial { first: ids[..n].to_vec(), rest: ids[n..].to_vec() }
    }

    /// The remainder cut into calls Gmail accepts.
    pub fn rest_batches(&self) -> Vec<Vec<String>> {
        self.rest.chunks(BATCH_LIMIT).map(<[String]>::to_vec).collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Entry {
    batch_id: String,
    at: i64,
    ids: Vec<String>,
    added: Vec<String>,
    removed: Vec<String>,
    undone: bool,
}

/// File-backed record of what changed, so a batch can be reversed for 30 days.
#[derive(Debug)]
pub struct UndoLog {
    path: PathBuf,
    entries: Vec<Entry>,
}

impl UndoLog {
    /// Opens the log at `path`; a missing file is an empty log, a corrupt one is an error.
    pub fn open(path: impl AsRef<Path>) -> Result<UndoLog> {
        let path = path.as_ref().to_path_buf();
        let entries = match std::fs::read_to_string(&path) {
            Ok(s) if s.trim().is_empty() => vec![],
            Ok(s) => serde_json::from_str(&s).with_context(|| format!("undo log {} is corrupt", path.display()))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(e) => return Err(e.into()),
        };
        Ok(UndoLog { path, entries })
    }

    fn save(&self) -> Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.entries)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Records that `action` was applied to exactly `ids`; returns the batch id to undo with.
    pub fn record(&mut self, ids: &[String], action: &Action, now: DateTime<Utc>) -> Result<String> {
        let c = action.label_change()?;
        if ids.is_empty() {
            bail!("nothing to record");
        }
        let batch_id = uuid::Uuid::new_v4().simple().to_string();
        self.entries.push(Entry {
            batch_id: batch_id.clone(),
            at: now.timestamp(),
            ids: ids.to_vec(),
            added: c.add,
            removed: c.remove,
            undone: false,
        });
        self.save()?;
        Ok(batch_id)
    }

    /// The inverse `batchModify` bodies for a batch (chunked); marks it undone so it cannot run twice.
    pub fn undo(&mut self, batch_id: &str) -> Result<Vec<Value>> {
        let e = self
            .entries
            .iter_mut()
            .find(|e| e.batch_id == batch_id)
            .ok_or_else(|| anyhow!("no undo entry {batch_id} (expired or unknown)"))?;
        if e.undone {
            bail!("batch {batch_id} was already undone");
        }
        let inverse = LabelChange { add: e.removed.clone(), remove: e.added.clone() };
        let bodies = e
            .ids
            .chunks(BATCH_LIMIT)
            .map(|chunk| modify_with(chunk, &inverse))
            .collect::<Result<Vec<_>>>()?;
        e.undone = true;
        self.save()?;
        Ok(bodies)
    }

    /// Drops entries older than 30 days; returns how many went.
    pub fn prune(&mut self, now: DateTime<Utc>) -> Result<usize> {
        let cutoff = (now - Duration::days(UNDO_DAYS)).timestamp();
        let before = self.entries.len();
        self.entries.retain(|e| e.at >= cutoff);
        let gone = before - self.entries.len();
        if gone > 0 {
            self.save()?;
        }
        Ok(gone)
    }

    /// Batch ids still open to undo, newest first.
    pub fn open_batches(&self) -> Vec<String> {
        self.entries.iter().rev().filter(|e| !e.undone).map(|e| e.batch_id.clone()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("m{i}")).collect()
    }
    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-03-01T00:00:00Z").unwrap().with_timezone(&Utc)
    }
    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hz-gmo-{}-{name}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&d).unwrap();
        d.join("undo.json")
    }

    #[test]
    fn archive_removes_inbox() {
        let b = batch_modify_body(&ids(2), &Action::Archive).unwrap();
        assert_eq!(b["removeLabelIds"], json!(["INBOX"]));
        assert_eq!(b["addLabelIds"], json!([]));
        assert_eq!(b["ids"], json!(["m0", "m1"]));
    }

    #[test]
    fn move_adds_label_and_leaves_inbox() {
        let b = batch_modify_body(&ids(1), &Action::MoveToLabel("Label_9".into())).unwrap();
        assert_eq!(b["addLabelIds"], json!(["Label_9"]));
        assert_eq!(b["removeLabelIds"], json!(["INBOX"]));
        let b = batch_modify_body(&ids(1), &Action::AddLabel("Label_9".into())).unwrap();
        assert_eq!(b["removeLabelIds"], json!([]));
        let b = batch_modify_body(&ids(1), &Action::MarkRead).unwrap();
        assert_eq!(b["removeLabelIds"], json!(["UNREAD"]));
    }

    #[test]
    fn never_emits_trash_or_delete() {
        let actions = [
            Action::Archive,
            Action::MarkRead,
            Action::AddLabel("Label_1".into()),
            Action::MoveToLabel("Label_1".into()),
        ];
        for a in &actions {
            let text = batch_modify_body(&ids(3), a).unwrap().to_string().to_ascii_uppercase();
            assert!(!text.contains("TRASH") && !text.contains("DELETE") && !text.contains("SPAM"));
        }
        for bad in ["TRASH", "trash", " Delete ", "SPAM", "DELETED"] {
            assert!(batch_modify_body(&ids(1), &Action::AddLabel(bad.into())).is_err(), "{bad}");
            assert!(batch_modify_body(&ids(1), &Action::MoveToLabel(bad.into())).is_err(), "{bad}");
        }
        assert!(batch_modify_body(&ids(1), &Action::AddLabel("".into())).is_err());
    }

    #[test]
    fn modify_body_limits() {
        assert!(batch_modify_body(&[], &Action::Archive).is_err());
        assert!(batch_modify_body(&ids(1000), &Action::Archive).is_ok());
        assert!(batch_modify_body(&ids(1001), &Action::Archive).is_err());
    }

    #[test]
    fn plan_dedupes_and_samples() {
        let samples: Vec<Example> = (0..9)
            .map(|i| Example { id: format!("m{i}"), from: "a".into(), subject: format!("s{i}") })
            .collect();
        let mut v = ids(4);
        v.push("m1".into());
        let p = Plan::build("older_than:1y", Action::Archive, v, samples).unwrap();
        assert_eq!(p.total, 4);
        assert_eq!(p.examples.len(), EXAMPLES);
        assert!(p.summary().starts_with("4 messages match"));
        assert!(p.summary().contains("archive"));
    }

    #[test]
    fn plan_refuses_empty_and_bad_label() {
        assert!(Plan::build("q", Action::Archive, vec![], vec![]).is_err());
        assert!(Plan::build("q", Action::AddLabel("TRASH".into()), ids(2), vec![]).is_err());
    }

    #[test]
    fn trial_is_first_fifty_then_rest() {
        let t = Plan::build("q", Action::Archive, ids(2500), vec![]).unwrap().trial();
        assert_eq!(t.first.len(), 50);
        assert_eq!(t.rest.len(), 2450);
        let b = t.rest_batches();
        assert_eq!(b.iter().map(Vec::len).collect::<Vec<_>>(), vec![1000, 1000, 450]);
        let small = Trial::split(&ids(10));
        assert_eq!(small.first.len(), 10);
        assert!(small.rest.is_empty() && small.rest_batches().is_empty());
        assert!(Trial::split(&[]).first.is_empty());
    }

    #[test]
    fn undo_inverts_labels() {
        let p = tmp("inv");
        let mut log = UndoLog::open(&p).unwrap();
        let id = log.record(&ids(3), &Action::MoveToLabel("L1".into()), now()).unwrap();
        let bodies = log.undo(&id).unwrap();
        assert_eq!(bodies.len(), 1);
        assert_eq!(bodies[0]["addLabelIds"], json!(["INBOX"]));
        assert_eq!(bodies[0]["removeLabelIds"], json!(["L1"]));
        assert_eq!(bodies[0]["ids"], json!(["m0", "m1", "m2"]));
    }

    #[test]
    fn undo_mark_read_restores_unread() {
        let p = tmp("read");
        let mut log = UndoLog::open(&p).unwrap();
        let id = log.record(&ids(1), &Action::MarkRead, now()).unwrap();
        assert_eq!(log.undo(&id).unwrap()[0]["addLabelIds"], json!(["UNREAD"]));
    }

    #[test]
    fn undo_twice_or_unknown_fails_and_chunks() {
        let p = tmp("twice");
        let mut log = UndoLog::open(&p).unwrap();
        let id = log.record(&ids(2100), &Action::Archive, now()).unwrap();
        assert_eq!(log.open_batches(), vec![id.clone()]);
        assert_eq!(log.undo(&id).unwrap().len(), 3);
        assert!(log.undo(&id).is_err());
        assert!(log.undo("nope").is_err());
        assert!(log.open_batches().is_empty());
    }

    #[test]
    fn log_persists_across_opens() {
        let p = tmp("persist");
        let id = {
            let mut log = UndoLog::open(&p).unwrap();
            log.record(&ids(2), &Action::Archive, now()).unwrap()
        };
        let mut again = UndoLog::open(&p).unwrap();
        assert_eq!(again.open_batches(), vec![id.clone()]);
        again.undo(&id).unwrap();
        let third = UndoLog::open(&p).unwrap();
        assert!(third.open_batches().is_empty());
    }

    #[test]
    fn prune_drops_after_thirty_days() {
        let p = tmp("prune");
        let mut log = UndoLog::open(&p).unwrap();
        let old = log.record(&ids(1), &Action::Archive, now() - Duration::days(31)).unwrap();
        let edge = log.record(&ids(1), &Action::Archive, now() - Duration::days(30)).unwrap();
        let fresh = log.record(&ids(1), &Action::Archive, now()).unwrap();
        assert_eq!(log.prune(now()).unwrap(), 1);
        assert!(log.undo(&old).is_err());
        assert!(log.undo(&edge).is_ok());
        assert!(log.undo(&fresh).is_ok());
        assert_eq!(log.prune(now()).unwrap(), 0);
    }

    #[test]
    fn corrupt_log_is_an_error_and_empty_file_is_fine() {
        let p = tmp("bad");
        std::fs::write(&p, "{not json").unwrap();
        assert!(UndoLog::open(&p).is_err());
        std::fs::write(&p, "  ").unwrap();
        assert!(UndoLog::open(&p).unwrap().open_batches().is_empty());
    }

    #[test]
    fn record_refuses_empty_and_forbidden() {
        let mut log = UndoLog::open(tmp("ref")).unwrap();
        assert!(log.record(&[], &Action::Archive, now()).is_err());
        assert!(log.record(&ids(1), &Action::AddLabel("TRASH".into()), now()).is_err());
    }
}
