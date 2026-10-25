//! The Preferences page's picks that this side acts on: how loud each kind of
//! banner is, when the reader does not want any, and the two background habits
//! (warming an agent up, checking CLIs for updates).
//!
//! Stored verbatim in `settings.json` under `studio` — the page owns the shape —
//! and read here leniently: a missing or odd field is its default, never an
//! error, because this sits on the path of every notification.

use chrono::Timelike;
use serde_json::Value;

/// How one kind of event reaches the reader.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    BannerSound,
    Banner,
    /// No desktop banner: the sidebar rail and the dock badge still say it.
    Badge,
    Off,
}

impl Level {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "bannerSound" => Some(Self::BannerSound),
            "banner" => Some(Self::Banner),
            "badge" => Some(Self::Badge),
            "off" => Some(Self::Off),
            _ => None,
        }
    }
}

/// A window of the day in minutes since midnight. It may wrap past midnight.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct QuietHours {
    pub from: u16,
    pub to: u16,
}

/// What the page stored, with every field defaulted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StudioPrefs {
    pub needs_you: Level,
    pub finishes: Level,
    pub mentions: Level,
    pub quiet: Option<QuietHours>,
    pub warm_up: bool,
    pub update_check: bool,
}

impl Default for StudioPrefs {
    fn default() -> Self {
        Self {
            needs_you: Level::BannerSound,
            finishes: Level::Badge,
            mentions: Level::Banner,
            quiet: None,
            warm_up: true,
            update_check: true,
        }
    }
}

/// `"22:30"` as minutes since midnight. Anything else is `None`.
pub fn parse_hhmm(raw: &str) -> Option<u16> {
    let (h, m) = raw.trim().split_once(':')?;
    let (h, m) = (h.parse::<u16>().ok()?, m.parse::<u16>().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// Whether `now` (minutes since midnight) falls inside the window. A window that
/// ends before it starts runs through midnight; one that starts and ends at the
/// same minute is empty, since "always quiet" is what turning the switch off is for.
pub fn in_quiet(q: QuietHours, now: u16) -> bool {
    match q.from.cmp(&q.to) {
        std::cmp::Ordering::Equal => false,
        std::cmp::Ordering::Less => now >= q.from && now < q.to,
        std::cmp::Ordering::Greater => now >= q.from || now < q.to,
    }
}

impl StudioPrefs {
    /// Reads the stored object. Unknown or malformed fields keep their default.
    pub fn from_value(raw: Option<&Value>) -> Self {
        let mut out = Self::default();
        let Some(raw) = raw else { return out };

        let level = |key: &str, into: &mut Level| {
            if let Some(l) = raw["notify"][key].as_str().and_then(Level::parse) {
                *into = l;
            }
        };
        level("needsYou", &mut out.needs_you);
        level("finishes", &mut out.finishes);
        level("mentions", &mut out.mentions);

        if raw["quiet"]["on"].as_bool() == Some(true) {
            let from = raw["quiet"]["from"].as_str().and_then(parse_hhmm);
            let to = raw["quiet"]["to"].as_str().and_then(parse_hhmm);
            if let (Some(from), Some(to)) = (from, to) {
                out.quiet = Some(QuietHours { from, to });
            }
        }
        if let Some(b) = raw["warmUp"].as_bool() {
            out.warm_up = b;
        }
        if let Some(b) = raw["updateCheck"].as_bool() {
            out.update_check = b;
        }
        out
    }
}

/// What to do with one banner.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Delivery {
    Banner { sound: bool },
    Badge,
    Off,
}

/// The level a kind of banner is set to. `asking` is "needs you", `mention` is a
/// mention in a channel and `completed` is a finished turn. Anything else (a pull
/// request going green, a worktree that would not go) has no pick on the page and
/// stays a plain banner, as it always was.
fn level_of(prefs: &StudioPrefs, kind: &str) -> Level {
    match kind {
        "asking" => prefs.needs_you,
        "mention" => prefs.mentions,
        "completed" => prefs.finishes,
        _ => Level::Banner,
    }
}

/// How `kind` is delivered at `now` minutes past midnight: the kind's own level,
/// then quiet hours, which turn a banner into a badge and leave the rest alone.
pub fn delivery(prefs: &StudioPrefs, kind: &str, now: u16) -> Delivery {
    let level = level_of(prefs, kind);
    let hushed = prefs.quiet.is_some_and(|q| in_quiet(q, now));
    match level {
        Level::Off => Delivery::Off,
        Level::Badge => Delivery::Badge,
        Level::Banner | Level::BannerSound if hushed => Delivery::Badge,
        Level::Banner => Delivery::Banner { sound: false },
        Level::BannerSound => Delivery::Banner { sound: true },
    }
}

/// Minutes since local midnight, now.
pub fn local_minutes() -> u16 {
    let now = chrono::Local::now();
    (now.hour() * 60 + now.minute()) as u16
}

/// The reader's stored picks, or the defaults.
pub async fn read() -> StudioPrefs {
    let settings = crate::settings::read().await;
    StudioPrefs::from_value(settings.studio.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_clock_time_parses_and_nonsense_does_not() {
        assert_eq!(parse_hhmm("22:00"), Some(1320));
        assert_eq!(parse_hhmm("08:05"), Some(485));
        assert_eq!(parse_hhmm("24:00"), None);
        assert_eq!(parse_hhmm("7"), None);
        assert_eq!(parse_hhmm("12:60"), None);
    }

    #[test]
    fn a_window_through_midnight_covers_both_sides_of_it() {
        let night = QuietHours { from: 22 * 60, to: 8 * 60 };
        assert!(in_quiet(night, 23 * 60));
        assert!(in_quiet(night, 0));
        assert!(in_quiet(night, 7 * 60 + 59));
        assert!(!in_quiet(night, 8 * 60), "the end minute is already awake");
        assert!(!in_quiet(night, 12 * 60));
        assert!(in_quiet(night, 22 * 60), "the start minute is quiet");
    }

    #[test]
    fn a_same_day_window_and_an_empty_one() {
        let nap = QuietHours { from: 13 * 60, to: 14 * 60 };
        assert!(in_quiet(nap, 13 * 60 + 30));
        assert!(!in_quiet(nap, 14 * 60));
        assert!(!in_quiet(QuietHours { from: 600, to: 600 }, 600));
    }

    #[test]
    fn the_defaults_match_the_pages_first_pick() {
        let p = StudioPrefs::from_value(None);
        assert_eq!(p.needs_you, Level::BannerSound);
        assert_eq!(p.finishes, Level::Badge);
        assert_eq!(p.mentions, Level::Banner);
        assert!(p.quiet.is_none() && p.warm_up && p.update_check);
    }

    #[test]
    fn stored_picks_override_and_junk_is_ignored() {
        let raw = json!({
            "notify": {"needsYou": "banner", "finishes": "off", "mentions": "wat"},
            "quiet": {"on": true, "from": "22:00", "to": "08:00"},
            "warmUp": false,
        });
        let p = StudioPrefs::from_value(Some(&raw));
        assert_eq!(p.needs_you, Level::Banner);
        assert_eq!(p.finishes, Level::Off);
        assert_eq!(p.mentions, Level::Banner, "an unknown level keeps the default");
        assert_eq!(p.quiet, Some(QuietHours { from: 1320, to: 480 }));
        assert!(!p.warm_up);

        let off = json!({"quiet": {"on": false, "from": "22:00", "to": "08:00"}});
        assert!(StudioPrefs::from_value(Some(&off)).quiet.is_none());
        let bad = json!({"quiet": {"on": true, "from": "late", "to": "08:00"}});
        assert!(StudioPrefs::from_value(Some(&bad)).quiet.is_none());
    }

    #[test]
    fn quiet_hours_turn_a_banner_into_a_badge_and_nothing_else() {
        let raw = json!({"quiet": {"on": true, "from": "22:00", "to": "08:00"}});
        let p = StudioPrefs::from_value(Some(&raw));

        assert_eq!(delivery(&p, "asking", 23 * 60), Delivery::Badge);
        assert_eq!(delivery(&p, "asking", 12 * 60), Delivery::Banner { sound: true });
        assert_eq!(delivery(&p, "mention", 12 * 60), Delivery::Banner { sound: false });
        assert_eq!(delivery(&p, "completed", 12 * 60), Delivery::Badge);
        assert_eq!(delivery(&p, "pr", 12 * 60), Delivery::Banner { sound: false });
        assert_eq!(delivery(&p, "pr", 23 * 60), Delivery::Badge, "quiet hours reach every banner");

        let off = StudioPrefs::from_value(Some(&json!({"notify": {"needsYou": "off"}})));
        assert_eq!(delivery(&off, "asking", 12 * 60), Delivery::Off);
    }
}
