//! "Wake me when done": watch a process, wake the agent when it ends.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A watch older than this wakes the agent anyway.
pub const MAX_AGE_SECS: i64 = 6 * 3600;
const TAIL_LINES: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Watch {
    pub id: String,
    pub bot: String,
    pub pid: u32,
    pub log_path: Option<PathBuf>,
    /// Unix seconds.
    pub started: i64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wake {
    pub bot: String,
    pub label: String,
    pub duration_secs: i64,
    pub log_tail: String,
    /// True when the process is still alive and the watch just timed out.
    pub still_running: bool,
}

impl Wake {
    /// The message that wakes the agent in its chat.
    pub fn message(&self) -> String {
        let mins = self.duration_secs / 60;
        let head = if self.still_running {
            format!("Watch \"{}\" is still running after {mins} min, take a look.", self.label)
        } else {
            format!("\"{}\" finished after {mins} min.", self.label)
        };
        if self.log_tail.is_empty() { head } else { format!("{head}\nLast log lines:\n{}", self.log_tail) }
    }
}

/// Watches kept in a JSON file; every change is written back atomically.
#[derive(Debug)]
pub struct WatchStore {
    path: PathBuf,
    watches: Vec<Watch>,
}

impl WatchStore {
    /// Opens the store; a missing or unreadable file starts empty.
    pub fn open(path: &Path) -> WatchStore {
        let watches = std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        WatchStore { path: path.to_path_buf(), watches }
    }

    fn persist(&self) -> anyhow::Result<()> {
        if let Some(d) = self.path.parent() {
            std::fs::create_dir_all(d)?;
        }
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.watches)?)?;
        std::fs::rename(tmp, &self.path)?;
        Ok(())
    }

    /// All current watches.
    pub fn list(&self) -> &[Watch] {
        &self.watches
    }

    /// Adds a watch; pid 0 is refused (kill(0) would probe the whole process group).
    pub fn add(&mut self, w: Watch) -> anyhow::Result<()> {
        if w.pid == 0 {
            anyhow::bail!("pid must be a real process id");
        }
        self.watches.retain(|x| x.id != w.id);
        self.watches.push(w);
        self.persist()
    }

    /// Removes a watch by id; returns whether it existed.
    pub fn remove(&mut self, id: &str) -> anyhow::Result<bool> {
        let before = self.watches.len();
        self.watches.retain(|w| w.id != id);
        let removed = self.watches.len() != before;
        if removed {
            self.persist()?;
        }
        Ok(removed)
    }
}

/// The last `n` lines of a file, safe on non-UTF-8 bytes and cut mid-character.
pub fn log_tail(path: &Path, n: usize) -> String {
    const READ: u64 = 64 * 1024;
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(READ);
    let mut buf = Vec::new();
    if f.seek(SeekFrom::Start(start)).is_err() || f.read_to_end(&mut buf).is_err() {
        return String::new();
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = text.lines().collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    let skip = lines.len().saturating_sub(n);
    lines[skip..].join("\n").trim_end().to_string()
}

/// Wakes for every finished process and every watch older than `MAX_AGE_SECS`, and drops those watches from the store.
pub fn poll(store: &mut WatchStore, is_alive: &dyn Fn(u32) -> bool, now: i64) -> Vec<Wake> {
    let mut wakes = Vec::new();
    let mut gone = Vec::new();
    for w in &store.watches {
        let alive = is_alive(w.pid);
        let aged = now - w.started >= MAX_AGE_SECS;
        if alive && !aged {
            continue;
        }
        wakes.push(Wake {
            bot: w.bot.clone(),
            label: w.label.clone(),
            duration_secs: (now - w.started).max(0),
            log_tail: w.log_path.as_deref().map(|p| log_tail(p, TAIL_LINES)).unwrap_or_default(),
            still_running: alive,
        });
        gone.push(w.id.clone());
    }
    if !gone.is_empty() {
        store.watches.retain(|w| !gone.contains(&w.id));
        let _ = store.persist();
    }
    wakes
}

/// True when the process exists; EPERM means it exists but belongs to someone else.
pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    // SAFETY: signal 0 only checks existence and permission.
    let r = unsafe { libc::kill(pid as libc::pid_t, 0) };
    r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("hz-watch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn w(id: &str, pid: u32, started: i64, log: Option<PathBuf>) -> Watch {
        Watch { id: id.into(), bot: "bot".into(), pid, log_path: log, started, label: format!("job {id}") }
    }

    #[test]
    fn finished_process_wakes_with_duration_and_tail() {
        let d = dir();
        let log = d.join("o.log");
        let lines: Vec<String> = (1..=30).map(|i| format!("line {i}")).collect();
        std::fs::write(&log, lines.join("\n")).unwrap();
        let mut s = WatchStore::open(&d.join("w.json"));
        s.add(w("1", 42, 1000, Some(log))).unwrap();
        let wk = poll(&mut s, &|_| false, 1000 + 125);
        assert_eq!(wk.len(), 1);
        assert_eq!(wk[0].duration_secs, 125);
        assert!(!wk[0].still_running);
        let tail: Vec<&str> = wk[0].log_tail.lines().collect();
        assert_eq!(tail.len(), 20);
        assert_eq!(tail[0], "line 11");
        assert_eq!(tail[19], "line 30");
        assert!(wk[0].message().contains("finished after 2 min"));
        assert!(s.list().is_empty());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn alive_young_watch_is_left_alone() {
        let d = dir();
        let mut s = WatchStore::open(&d.join("w.json"));
        s.add(w("1", 42, 0, None)).unwrap();
        assert!(poll(&mut s, &|_| true, 100).is_empty());
        assert_eq!(s.list().len(), 1);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn old_watch_wakes_anyway() {
        let d = dir();
        let mut s = WatchStore::open(&d.join("w.json"));
        s.add(w("1", 42, 0, None)).unwrap();
        assert!(poll(&mut s, &|_| true, MAX_AGE_SECS - 1).is_empty());
        let wk = poll(&mut s, &|_| true, MAX_AGE_SECS);
        assert_eq!(wk.len(), 1);
        assert!(wk[0].still_running);
        assert!(wk[0].message().contains("still running"));
        assert!(s.list().is_empty());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn persists_across_open() {
        let d = dir();
        let f = d.join("sub/w.json");
        let mut s = WatchStore::open(&f);
        s.add(w("1", 42, 5, None)).unwrap();
        s.add(w("2", 43, 6, None)).unwrap();
        let s2 = WatchStore::open(&f);
        assert_eq!(s2.list().len(), 2);
        let mut s3 = s2;
        assert!(s3.remove("1").unwrap());
        assert!(!s3.remove("1").unwrap());
        assert_eq!(WatchStore::open(&f).list().len(), 1);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn poll_removal_persists() {
        let d = dir();
        let f = d.join("w.json");
        let mut s = WatchStore::open(&f);
        s.add(w("1", 42, 0, None)).unwrap();
        s.add(w("2", 43, 0, None)).unwrap();
        let wk = poll(&mut s, &|p| p == 43, 10);
        assert_eq!(wk.len(), 1);
        assert_eq!(WatchStore::open(&f).list()[0].id, "2");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn add_same_id_replaces_and_pid_zero_refused() {
        let d = dir();
        let mut s = WatchStore::open(&d.join("w.json"));
        s.add(w("1", 42, 0, None)).unwrap();
        s.add(w("1", 50, 0, None)).unwrap();
        assert_eq!(s.list().len(), 1);
        assert_eq!(s.list()[0].pid, 50);
        assert!(s.add(w("z", 0, 0, None)).is_err());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn tail_is_char_safe_and_tolerates_junk() {
        let d = dir();
        let log = d.join("o.log");
        let mut bytes = "é".repeat(50_000).into_bytes();
        bytes.extend_from_slice(b"\nlast \xff\xfe line\n");
        std::fs::write(&log, bytes).unwrap();
        let t = log_tail(&log, 20);
        assert!(t.ends_with("line"));
        assert!(t.contains("last"));
        assert!(!t.contains('é'));
        assert_eq!(log_tail(&d.join("missing"), 20), "");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn tail_short_file_whole() {
        let d = dir();
        let log = d.join("o.log");
        std::fs::write(&log, "a\nb\n").unwrap();
        assert_eq!(log_tail(&log, 20), "a\nb");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn corrupt_store_opens_empty() {
        let d = dir();
        let f = d.join("w.json");
        std::fs::write(&f, "not json").unwrap();
        assert!(WatchStore::open(&f).list().is_empty());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn pid_alive_real_process() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(0));
        assert!(!pid_alive(u32::MAX));
    }
}
