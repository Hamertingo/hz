//! Light and strong brain rotation: start cheap, climb for heavy requests, fall back after idle time.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

/// Which engine family a session runs on; decides how a level becomes settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Brain {
    Claude,
    Codex,
    OpenCode,
    Other,
}

/// What the reader picked: always light, always strong, or let the app move between them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Light,
    Strong,
    Rotate,
}

/// The brain size actually used for a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Light,
    Strong,
}

/// Minutes of calm before rotate mode steps back down.
pub const IDLE_MINUTES: i64 = 20;
/// Hours a turbo phrase holds the strong brain.
pub const TURBO_HOURS: i64 = 1;
/// Requests longer than this many characters count as heavy on size alone.
const HEAVY_LEN: usize = 600;

const HEAVY_WORDS: &[&str] = &[
    "explain", "design", "plan", "board", "page", "skill", "code", "coding", "analy", "computer",
    "debug", "refactor", "implement", "architect", "research", "compare", "report", "investigate",
    "strategy", "review", "migrate", "build", "write a", "spreadsheet", "presentation",
];

const TURBO_PHRASES: &[&str] = &["turbo", "upgrade brain", "upgrade your brain"];
const ECONOMY_PHRASES: &[&str] = &["economy mode"];

/// Everything rotation remembers between requests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rotation {
    pub mode: Mode,
    pub turbo_until: Option<DateTime<Utc>>,
    pub last_heavy_at: Option<DateTime<Utc>>,
    /// The level the last decision picked; held while a request is running.
    pub level: Level,
}

impl Rotation {
    /// A fresh state in the given mode; rotate and light start on the light brain.
    pub fn new(mode: Mode) -> Self {
        Rotation {
            mode,
            turbo_until: None,
            last_heavy_at: None,
            level: if mode == Mode::Strong { Level::Strong } else { Level::Light },
        }
    }
}

/// Whether a request looks like work that deserves the strong brain.
pub fn is_heavy(text: &str) -> bool {
    let t = text.to_lowercase();
    t.chars().count() > HEAVY_LEN || HEAVY_WORDS.iter().any(|w| t.contains(w))
}

/// Picks the level for a new request; `in_request` freezes the level because swapping brains mid-turn would drop its context.
pub fn decide(state: &mut Rotation, text: &str, now: DateTime<Utc>, in_request: bool) -> Level {
    if in_request {
        return state.level;
    }
    let lower = text.to_lowercase();
    if ECONOMY_PHRASES.iter().any(|p| lower.contains(p)) {
        state.mode = Mode::Light;
        state.turbo_until = None;
    } else if TURBO_PHRASES.iter().any(|p| lower.contains(p)) {
        state.turbo_until = Some(now + Duration::hours(TURBO_HOURS));
    }
    let heavy = is_heavy(text);
    if heavy {
        state.last_heavy_at = Some(now);
    }
    let turbo = state.turbo_until.is_some_and(|t| now < t);
    state.level = if turbo {
        Level::Strong
    } else {
        match state.mode {
            Mode::Light => Level::Light,
            Mode::Strong => Level::Strong,
            Mode::Rotate => {
                let recent = state
                    .last_heavy_at
                    .is_some_and(|t| now - t < Duration::minutes(IDLE_MINUTES));
                if heavy || (state.level == Level::Strong && recent) {
                    Level::Strong
                } else {
                    Level::Light
                }
            }
        }
    };
    state.level
}

/// Engine settings (key, value) that put `brain` on `level`, starting from the model it runs now.
pub fn settings_for(brain: Brain, level: Level, model_name: &str) -> Vec<(String, String)> {
    let strong = level == Level::Strong;
    let effort = if strong { "high" } else { "low" };
    match brain {
        Brain::Claude => {
            let long_ctx = if model_name.contains("[1m]") { "[1m]" } else { "" };
            let family = if strong { "opus" } else { "sonnet" };
            vec![("model".into(), format!("{family}{long_ctx}"))]
        }
        Brain::Codex | Brain::Other => vec![("reasoning_effort".into(), effort.into())],
        Brain::OpenCode => {
            let base = model_name.split('#').next().unwrap_or(model_name);
            vec![("model".into(), format!("{base}#{effort}"))]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t0() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-01T12:00:00Z").unwrap().into()
    }

    #[test]
    fn heavy_words_and_length() {
        assert!(is_heavy("Please explain how this works"));
        assert!(is_heavy("Design a landing PAGE"));
        assert!(!is_heavy("what time is it"));
        assert!(is_heavy(&"x ".repeat(400)));
    }

    #[test]
    fn rotate_starts_light() {
        let mut s = Rotation::new(Mode::Rotate);
        assert_eq!(decide(&mut s, "hi there", t0(), false), Level::Light);
    }

    #[test]
    fn heavy_request_goes_strong() {
        let mut s = Rotation::new(Mode::Rotate);
        assert_eq!(decide(&mut s, "plan my week", t0(), false), Level::Strong);
        assert_eq!(s.last_heavy_at, Some(t0()));
    }

    #[test]
    fn stays_strong_until_idle_window_passes() {
        let mut s = Rotation::new(Mode::Rotate);
        decide(&mut s, "plan my week", t0(), false);
        let soon = t0() + Duration::minutes(10);
        assert_eq!(decide(&mut s, "thanks", soon, false), Level::Strong);
        let late = soon + Duration::minutes(21);
        assert_eq!(decide(&mut s, "thanks", late, false), Level::Light);
    }

    #[test]
    fn never_changes_mid_request() {
        let mut s = Rotation::new(Mode::Rotate);
        assert_eq!(decide(&mut s, "plan my week", t0(), true), Level::Light);
        decide(&mut s, "plan my week", t0(), false);
        assert_eq!(decide(&mut s, "hi", t0() + Duration::hours(5), true), Level::Strong);
    }

    #[test]
    fn turbo_holds_one_hour() {
        let mut s = Rotation::new(Mode::Light);
        assert_eq!(decide(&mut s, "turbo please", t0(), false), Level::Strong);
        assert_eq!(decide(&mut s, "hi", t0() + Duration::minutes(59), false), Level::Strong);
        assert_eq!(decide(&mut s, "hi", t0() + Duration::minutes(61), false), Level::Light);
    }

    #[test]
    fn upgrade_brain_phrase_is_turbo() {
        let mut s = Rotation::new(Mode::Rotate);
        assert_eq!(decide(&mut s, "Upgrade brain", t0(), false), Level::Strong);
    }

    #[test]
    fn economy_overrides_everything() {
        let mut s = Rotation::new(Mode::Strong);
        decide(&mut s, "turbo", t0(), false);
        assert_eq!(decide(&mut s, "economy mode", t0(), false), Level::Light);
        assert_eq!(s.mode, Mode::Light);
        assert!(s.turbo_until.is_none());
    }

    #[test]
    fn fixed_modes_ignore_content() {
        let mut strong = Rotation::new(Mode::Strong);
        assert_eq!(decide(&mut strong, "hi", t0(), false), Level::Strong);
        let mut light = Rotation::new(Mode::Light);
        assert_eq!(decide(&mut light, "plan everything", t0(), false), Level::Light);
    }

    #[test]
    fn claude_settings_pick_model_and_keep_long_context() {
        let s = settings_for(Brain::Claude, Level::Strong, "sonnet[1m]");
        assert_eq!(s, vec![("model".to_string(), "opus[1m]".to_string())]);
        let l = settings_for(Brain::Claude, Level::Light, "opus");
        assert_eq!(l[0].1, "sonnet");
    }

    #[test]
    fn effort_and_variant_mappings() {
        assert_eq!(settings_for(Brain::Codex, Level::Light, "x")[0], ("reasoning_effort".into(), "low".into()));
        assert_eq!(settings_for(Brain::Other, Level::Strong, "x")[0].1, "high");
        let o = settings_for(Brain::OpenCode, Level::Strong, "anthropic/claude#low");
        assert_eq!(o[0], ("model".to_string(), "anthropic/claude#high".to_string()));
    }
}
