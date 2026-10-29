//! One screen per agent on the shared VM: stable numbering, how many may be on, and the names derived from the number.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Screen 1 is the computer's own; agents start at 2.
pub const FIRST_AGENT_SCREEN: u32 = 2;
/// X display for screen n is `:(DISPLAY_BASE + n)`; the VM's own desktop is :0 so agents start well clear of it.
pub const DISPLAY_BASE: u32 = 100;
/// VNC port for screen n is `VNC_BASE + n` (5900 is the VNC convention).
pub const VNC_BASE: u16 = 5900;
/// Chrome DevTools port for screen n is `CDP_BASE + n`.
pub const CDP_BASE: u16 = 9200;
/// The noVNC web client of screen n is served on `NOVNC_BASE + n`.
pub const NOVNC_BASE: u16 = 6080;

/// X display name, e.g. `:102` for screen 2.
pub fn display_for(n: u32) -> String {
    format!(":{}", DISPLAY_BASE + n)
}

/// VNC port of screen n.
pub fn vnc_port(n: u32) -> u16 {
    VNC_BASE.saturating_add(n as u16)
}

/// Port the browser can open to see and drive screen n.
pub fn novnc_port(n: u32) -> u16 {
    NOVNC_BASE.saturating_add(n as u16)
}

/// Chrome DevTools port of screen n.
pub fn cdp_port(n: u32) -> u16 {
    CDP_BASE.saturating_add(n as u16)
}

/// Browser profile folder of screen n under `base`.
pub fn profile_dir(base: &Path, n: u32) -> PathBuf {
    base.join(format!("screen-{n}")).join("profile")
}

/// Systemd template instance on the VM for a service of screen n, e.g. `hz-screen@2.service`.
pub fn unit_name(n: u32) -> String {
    format!("hz-screen@{n}.service")
}

/// The persisted agent to screen map; numbers are handed out once and never recycled.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Allocator {
    assigned: BTreeMap<String, u32>,
    next: u32,
}

impl Allocator {
    /// Loads the map from `path`; a missing or broken file starts empty.
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    /// Writes the map to `path`, creating the folder.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }

    /// The agent's screen number, minted on first call and the same ever after.
    pub fn assign(&mut self, agent: &str) -> u32 {
        if let Some(n) = self.assigned.get(agent) {
            return *n;
        }
        let n = self.next.max(FIRST_AGENT_SCREEN);
        self.next = n + 1;
        self.assigned.insert(agent.to_string(), n);
        n
    }

    /// The agent's screen if it has one, without minting.
    pub fn get(&self, agent: &str) -> Option<u32> {
        self.assigned.get(agent).copied()
    }
}

/// Keeps at most `max_on_at_once` screens running; the one idle longest gives way.
#[derive(Debug)]
pub struct ScreenManager {
    max_on_at_once: usize,
    on: HashMap<String, DateTime<Utc>>,
}

impl ScreenManager {
    /// A manager allowing `max_on_at_once` screens (at least one).
    pub fn new(max_on_at_once: usize) -> Self {
        Self { max_on_at_once: max_on_at_once.max(1), on: HashMap::new() }
    }

    /// Turns the agent's screen on (or refreshes its use time) and returns the agents whose screens must now go off.
    pub fn turn_on(&mut self, agent: &str, now: DateTime<Utc>) -> Vec<String> {
        self.on.insert(agent.to_string(), now);
        let mut evicted = Vec::new();
        while self.on.len() > self.max_on_at_once {
            let oldest = self
                .on
                .iter()
                .filter(|(a, _)| a.as_str() != agent)
                .min_by(|a, b| a.1.cmp(b.1).then_with(|| a.0.cmp(b.0)))
                .map(|(a, _)| a.clone());
            match oldest {
                Some(a) => {
                    self.on.remove(&a);
                    evicted.push(a);
                }
                None => break,
            }
        }
        evicted
    }

    /// Marks the agent's screen as just used; no effect when it is off.
    pub fn touch(&mut self, agent: &str, now: DateTime<Utc>) {
        if let Some(t) = self.on.get_mut(agent) {
            *t = now;
        }
    }

    /// Turns a screen off; true if it was on.
    pub fn turn_off(&mut self, agent: &str) -> bool {
        self.on.remove(agent).is_some()
    }

    /// Whether the agent's screen is on.
    pub fn is_on(&self, agent: &str) -> bool {
        self.on.contains_key(agent)
    }

    /// How many screens are on.
    pub fn count(&self) -> usize {
        self.on.len()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_live_view_port_follows_the_screen_number() {
        assert_eq!(novnc_port(2), 6082);
        assert_eq!(novnc_port(7), 6087);
    }

    use super::*;
    use chrono::TimeZone;

    fn t(s: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap() + chrono::Duration::seconds(s)
    }

    #[test]
    fn naming_helpers() {
        assert_eq!(display_for(2), ":102");
        assert_eq!(vnc_port(2), 5902);
        assert_eq!(cdp_port(3), 9203);
        assert_eq!(unit_name(4), "hz-screen@4.service");
        assert_eq!(profile_dir(Path::new("/b"), 2), PathBuf::from("/b/screen-2/profile"));
    }

    #[test]
    fn ports_do_not_overflow() {
        assert_eq!(vnc_port(u32::MAX), u16::MAX);
    }

    #[test]
    fn assign_is_stable_and_starts_after_one() {
        let mut a = Allocator::default();
        assert_eq!(a.assign("ana"), 2);
        assert_eq!(a.assign("bo"), 3);
        assert_eq!(a.assign("ana"), 2);
        assert_eq!(a.get("zed"), None);
    }

    #[test]
    fn numbers_are_never_reused() {
        let mut a = Allocator::default();
        let ids: Vec<u32> = (0..20).map(|i| a.assign(&format!("a{i}"))).collect();
        let mut sorted = ids.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), 20);
        assert!(ids.iter().all(|n| *n >= 2));
    }

    #[test]
    fn persists_round_trip() {
        let p = std::env::temp_dir().join(format!("hz-screens-{}/a.json", uuid::Uuid::new_v4()));
        let mut a = Allocator::default();
        a.assign("ana");
        a.assign("bo");
        a.save(&p).unwrap();
        let mut b = Allocator::load(&p);
        assert_eq!(b.get("bo"), Some(3));
        assert_eq!(b.assign("cy"), 4);
    }

    #[test]
    fn broken_file_starts_empty() {
        let p = std::env::temp_dir().join(format!("hz-screens-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&p, "{nope").unwrap();
        assert_eq!(Allocator::load(&p), Allocator::default());
        assert_eq!(Allocator::load(Path::new("/definitely/missing.json")), Allocator::default());
    }

    #[test]
    fn under_limit_evicts_nothing() {
        let mut m = ScreenManager::new(2);
        assert!(m.turn_on("a", t(0)).is_empty());
        assert!(m.turn_on("b", t(1)).is_empty());
        assert_eq!(m.count(), 2);
    }

    #[test]
    fn evicts_idle_longest() {
        let mut m = ScreenManager::new(2);
        m.turn_on("a", t(0));
        m.turn_on("b", t(1));
        m.touch("a", t(5));
        assert_eq!(m.turn_on("c", t(6)), vec!["b".to_string()]);
        assert!(m.is_on("a") && m.is_on("c") && !m.is_on("b"));
    }

    #[test]
    fn newcomer_is_never_its_own_victim() {
        let mut m = ScreenManager::new(1);
        m.turn_on("a", t(100));
        assert_eq!(m.turn_on("b", t(0)), vec!["a".to_string()]);
        assert!(m.is_on("b"));
    }

    #[test]
    fn turn_off_reports_and_frees_room() {
        let mut m = ScreenManager::new(1);
        m.turn_on("a", t(0));
        assert!(m.turn_off("a"));
        assert!(!m.turn_off("a"));
        assert!(m.turn_on("b", t(1)).is_empty());
    }

    #[test]
    fn zero_limit_is_one() {
        let mut m = ScreenManager::new(0);
        m.turn_on("a", t(0));
        assert_eq!(m.count(), 1);
    }

    #[test]
    fn turning_on_again_does_not_evict() {
        let mut m = ScreenManager::new(1);
        m.turn_on("a", t(0));
        assert!(m.turn_on("a", t(1)).is_empty());
    }
}
