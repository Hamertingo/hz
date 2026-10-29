//! Idempotency log: an operation that started but never finished is never run a second time.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Default number of entries kept on disk.
pub const DEFAULT_CAP: usize = 1000;

/// What `begin` tells the caller to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Begin {
    /// Never seen: run it.
    Fresh,
    /// Already finished: reuse this result instead of running again.
    Done(String),
    /// Started once and the outcome is lost: do not run it again, ask a person.
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum State {
    Started,
    Done,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    op_id: String,
    kind: String,
    state: State,
    result: Option<String>,
    at: i64,
}

/// Append-style log of operations, persisted as JSON lines.
pub struct OperationLog {
    path: PathBuf,
    cap: usize,
    entries: Vec<Entry>,
}

impl OperationLog {
    /// Opens (or creates) the log and marks every unfinished entry Unknown.
    pub fn open(path: &Path) -> Result<Self> {
        Self::open_with_cap(path, DEFAULT_CAP)
    }

    /// Same as `open` with an explicit cap on kept entries.
    pub fn open_with_cap(path: &Path, cap: usize) -> Result<Self> {
        let mut entries = Vec::new();
        if let Ok(text) = std::fs::read_to_string(path) {
            // A torn or hand-edited line costs that line only.
            for line in text.lines().filter(|l| !l.trim().is_empty()) {
                if let Ok(e) = serde_json::from_str::<Entry>(line) {
                    entries.push(e);
                }
            }
        }
        let mut log = OperationLog { path: path.to_path_buf(), cap: cap.max(1), entries };
        log.recover()?;
        Ok(log)
    }

    /// Turns every Started entry into Unknown; a crash mid-operation must never lead to a re-run.
    pub fn recover(&mut self) -> Result<()> {
        let mut changed = false;
        for e in self.entries.iter_mut().filter(|e| e.state == State::Started) {
            e.state = State::Unknown;
            changed = true;
        }
        if changed {
            self.save()?;
        }
        Ok(())
    }

    /// Registers an operation id and says whether to run it.
    pub fn begin(&mut self, op_id: &str, kind: &str) -> Result<Begin> {
        if op_id.is_empty() {
            bail!("operation id is empty");
        }
        if let Some(e) = self.entries.iter().find(|e| e.op_id == op_id) {
            return Ok(match (e.state, &e.result) {
                (State::Done, r) => Begin::Done(r.clone().unwrap_or_default()),
                // Started in this very process counts as in flight: also not to be run twice.
                _ => Begin::Unknown,
            });
        }
        self.entries.push(Entry {
            op_id: op_id.to_string(),
            kind: kind.to_string(),
            state: State::Started,
            result: None,
            at: chrono::Utc::now().timestamp(),
        });
        self.prune();
        self.save()?;
        Ok(Begin::Fresh)
    }

    /// Records the result of a started operation.
    pub fn finish(&mut self, op_id: &str, result_json: &str) -> Result<()> {
        match self.entries.iter_mut().find(|e| e.op_id == op_id) {
            Some(e) if e.state == State::Started => {
                e.state = State::Done;
                e.result = Some(result_json.to_string());
            }
            Some(_) => bail!("operation {op_id} is not in progress"),
            None => bail!("operation {op_id} was never begun"),
        }
        self.save()
    }

    /// Number of entries held.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when the log holds nothing.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn prune(&mut self) {
        if self.entries.len() > self.cap {
            let drop = self.entries.len() - self.cap;
            self.entries.drain(..drop);
        }
    }

    fn save(&self) -> Result<()> {
        let mut body = String::new();
        for e in &self.entries {
            body.push_str(&serde_json::to_string(e)?);
            body.push('\n');
        }
        let tmp = self.path.with_extension("tmp");
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&tmp, body)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        std::env::temp_dir().join(format!("ops-{}", uuid::Uuid::new_v4())).join("log.jsonl")
    }

    #[test]
    fn fresh_then_done() {
        let p = tmp();
        let mut l = OperationLog::open(&p).unwrap();
        assert_eq!(l.begin("a", "send_mail").unwrap(), Begin::Fresh);
        l.finish("a", "{\"ok\":true}").unwrap();
        assert_eq!(l.begin("a", "send_mail").unwrap(), Begin::Done("{\"ok\":true}".into()));
    }

    #[test]
    fn started_in_process_is_not_rerun() {
        let mut l = OperationLog::open(&tmp()).unwrap();
        l.begin("a", "k").unwrap();
        assert_eq!(l.begin("a", "k").unwrap(), Begin::Unknown);
    }

    #[test]
    fn crash_leaves_unknown_and_never_reruns() {
        let p = tmp();
        {
            let mut l = OperationLog::open(&p).unwrap();
            l.begin("a", "pay").unwrap();
        }
        let mut l = OperationLog::open(&p).unwrap();
        assert_eq!(l.begin("a", "pay").unwrap(), Begin::Unknown);
        let mut l2 = OperationLog::open(&p).unwrap();
        assert_eq!(l2.begin("a", "pay").unwrap(), Begin::Unknown);
    }

    #[test]
    fn new_id_runs_again() {
        let p = tmp();
        let mut l = OperationLog::open(&p).unwrap();
        l.begin("a", "k").unwrap();
        assert_eq!(l.begin("b", "k").unwrap(), Begin::Fresh);
    }

    #[test]
    fn done_survives_reopen() {
        let p = tmp();
        {
            let mut l = OperationLog::open(&p).unwrap();
            l.begin("a", "k").unwrap();
            l.finish("a", "42").unwrap();
        }
        let mut l = OperationLog::open(&p).unwrap();
        assert_eq!(l.begin("a", "k").unwrap(), Begin::Done("42".into()));
    }

    #[test]
    fn finish_requires_a_started_entry() {
        let mut l = OperationLog::open(&tmp()).unwrap();
        assert!(l.finish("ghost", "1").is_err());
        l.begin("a", "k").unwrap();
        l.finish("a", "1").unwrap();
        assert!(l.finish("a", "2").is_err());
    }

    #[test]
    fn cap_keeps_newest() {
        let p = tmp();
        let mut l = OperationLog::open_with_cap(&p, 3).unwrap();
        for i in 0..6 {
            l.begin(&format!("op{i}"), "k").unwrap();
        }
        assert_eq!(l.len(), 3);
        assert_eq!(l.begin("op5", "k").unwrap(), Begin::Unknown);
        assert_eq!(l.begin("op0", "k").unwrap(), Begin::Fresh);
        let reopened = OperationLog::open_with_cap(&p, 3).unwrap();
        assert_eq!(reopened.len(), 3);
    }

    #[test]
    fn corrupt_lines_are_skipped() {
        let p = tmp();
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "not json\n{\"op_id\":\"a\",\"kind\":\"k\",\"state\":\"done\",\"result\":\"7\",\"at\":1}\n{\"op_id\":\n").unwrap();
        let mut l = OperationLog::open(&p).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l.begin("a", "k").unwrap(), Begin::Done("7".into()));
    }

    #[test]
    fn empty_id_is_rejected() {
        let mut l = OperationLog::open(&tmp()).unwrap();
        assert!(l.begin("", "k").is_err());
    }

    #[test]
    fn no_temp_file_left_behind() {
        let p = tmp();
        let mut l = OperationLog::open(&p).unwrap();
        l.begin("a", "k").unwrap();
        assert!(!p.with_extension("tmp").exists());
        assert!(!l.is_empty());
    }
}
