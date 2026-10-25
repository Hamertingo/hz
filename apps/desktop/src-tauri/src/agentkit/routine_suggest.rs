//! Notices a task asked for again and again and offers to make it a routine, once.

use chrono::{Datelike, Duration, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};
use std::path::Path;

const WINDOW_DAYS: i64 = 14;
const MIN_REPEATS: usize = 3;
const TIME_SPREAD: i64 = 60;

/// Where a request came from; only the user's own requests count toward a suggestion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    User,
    Routine,
    Group,
    Team,
    OtherAgent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Signature {
    pub task: String,
    /// 0 = Monday.
    pub weekday: u32,
    pub minute_of_day: u32,
    /// Local wall-clock time as seconds since 1970, with no zone applied.
    pub at: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Store {
    /// `(bot, signature)`.
    pub signatures: Vec<(String, Signature)>,
    /// `(bot, task)` pairs already offered; never offered again.
    pub offered: Vec<(String, String)>,
    /// `(bot, task)` pairs the user refused for good.
    pub declined: Vec<(String, String)>,
    /// `(bot, "YYYY-MM-DD")` of the last offer.
    pub last_offer: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Suggestion {
    pub task: String,
    /// `Some` when the pattern is a weekday, `None` when it is a time of day.
    pub weekday: Option<u32>,
    pub minute_of_day: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    Yes,
    /// "HH:MM" or "HHMM".
    OtherTime(String),
    No,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Schedule {
    pub task: String,
    pub weekday: Option<u32>,
    pub minute_of_day: u32,
}

impl Suggestion {
    /// Plain-language offer shown on the card.
    pub fn describe(&self) -> String {
        const D: [&str; 7] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        let t = format!("{:02}:{:02}", self.minute_of_day / 60, self.minute_of_day % 60);
        match self.weekday {
            Some(w) => format!("You ask for \"{}\" most {}s. Make it a routine at {t}?", self.task, D[(w % 7) as usize]),
            None => format!("You ask for \"{}\" around {t} often. Make it a routine?", self.task),
        }
    }
}

/// Loads the store; a missing or unreadable file is an empty store.
pub fn load(path: &Path) -> Store {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Saves the store atomically.
pub fn save(store: &Store, path: &Path) -> anyhow::Result<()> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec(store)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

/// Adds one signature to `store`; routine, group, team and other-agent requests are ignored. Returns whether it was kept.
pub fn record_in(store: &mut Store, bot: &str, task: &str, now: NaiveDateTime, origin: Origin) -> bool {
    let task = task.trim().to_lowercase();
    if origin != Origin::User || task.is_empty() {
        return false;
    }
    store.signatures.push((
        bot.into(),
        Signature { task, weekday: now.weekday().num_days_from_monday(), minute_of_day: now.hour() * 60 + now.minute(), at: now.and_utc().timestamp() },
    ));
    let cutoff = (now - Duration::days(WINDOW_DAYS * 4)).and_utc().timestamp();
    store.signatures.retain(|(_, s)| s.at >= cutoff);
    true
}

/// Loads the store at `path`, records one request, saves it back.
pub fn record(path: &Path, bot: &str, task: &str, now: NaiveDateTime, origin: Origin) -> anyhow::Result<bool> {
    let mut s = load(path);
    let kept = record_in(&mut s, bot, task, now, origin);
    if kept {
        save(&s, path)?;
    }
    Ok(kept)
}

fn circ(a: u32, b: u32) -> i64 {
    let d = (a as i64 - b as i64).abs();
    d.min(1440 - d)
}

/// Offers at most one routine per bot per day: 3+ repeats in 14 days within an hour of each other, or all on one weekday. Marks the offer as made.
pub fn suggest(store: &mut Store, bot: &str, now: NaiveDateTime) -> Option<Suggestion> {
    let today = now.date().to_string();
    if store.last_offer.iter().any(|(b, d)| b == bot && *d == today) {
        return None;
    }
    let from = (now - Duration::days(WINDOW_DAYS)).and_utc().timestamp();
    let to = now.and_utc().timestamp();
    let mut tasks: Vec<&str> = store.signatures.iter().filter(|(b, _)| b == bot).map(|(_, s)| s.task.as_str()).collect();
    tasks.sort();
    tasks.dedup();
    let mut found = None;
    for task in tasks {
        if store.offered.iter().chain(&store.declined).any(|(b, t)| b == bot && t == task) {
            continue;
        }
        let sigs: Vec<&Signature> =
            store.signatures.iter().filter(|(b, s)| b == bot && s.task == task && s.at >= from && s.at <= to).map(|(_, s)| s).collect();
        if sigs.len() < MIN_REPEATS {
            continue;
        }
        let best = sigs
            .iter()
            .map(|c| sigs.iter().filter(|s| circ(s.minute_of_day, c.minute_of_day) <= TIME_SPREAD).collect::<Vec<_>>())
            .max_by_key(|g| g.len())
            .unwrap_or_default();
        if best.len() >= MIN_REPEATS {
            let mut sum: i64 = 0;
            let base = best[0].minute_of_day as i64;
            for s in &best {
                let mut d = s.minute_of_day as i64 - base;
                if d > 720 {
                    d -= 1440;
                } else if d < -720 {
                    d += 1440;
                }
                sum += d;
            }
            let avg = (base + sum / best.len() as i64).rem_euclid(1440) as u32;
            found = Some(Suggestion { task: task.into(), weekday: None, minute_of_day: avg });
            break;
        }
        if sigs.iter().all(|s| s.weekday == sigs[0].weekday) {
            let avg = (sigs.iter().map(|s| s.minute_of_day as u64).sum::<u64>() / sigs.len() as u64) as u32;
            found = Some(Suggestion { task: task.into(), weekday: Some(sigs[0].weekday), minute_of_day: avg });
            break;
        }
    }
    let s = found?;
    store.offered.push((bot.into(), s.task.clone()));
    store.last_offer.retain(|(b, _)| b != bot);
    store.last_offer.push((bot.into(), today));
    Some(s)
}

fn parse_hhmm(s: &str) -> Option<u32> {
    let t = s.trim();
    let (h, m) = if let Some((h, m)) = t.split_once(':') {
        (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?)
    } else if t.len() == 4 && t.chars().all(|c| c.is_ascii_digit()) {
        (t[..2].parse().ok()?, t[2..].parse().ok()?)
    } else {
        return None;
    };
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// Applies the user's reply; `Yes` and `OtherTime` yield the schedule to create, `No` blocks the task forever.
pub fn answer(store: &mut Store, bot: &str, s: &Suggestion, a: Answer) -> Result<Option<Schedule>, String> {
    match a {
        Answer::No => {
            if !store.declined.iter().any(|(b, t)| b == bot && *t == s.task) {
                store.declined.push((bot.into(), s.task.clone()));
            }
            Ok(None)
        }
        Answer::Yes => Ok(Some(Schedule { task: s.task.clone(), weekday: s.weekday, minute_of_day: s.minute_of_day })),
        Answer::OtherTime(t) => {
            let m = parse_hhmm(&t).ok_or_else(|| format!("'{t}' is not a time like 08:30"))?;
            Ok(Some(Schedule { task: s.task.clone(), weekday: s.weekday, minute_of_day: m }))
        }
    }
}

/// Plain word-match normaliser used when no model can name the task: lowercase, no filler words, first four words, sorted.
pub fn task_name_fallback(text: &str) -> String {
    const STOP: [&str; 30] = [
        "please", "can", "could", "would", "you", "the", "a", "an", "my", "to", "for", "me", "i", "of", "and", "on", "in", "now", "again", "hey", "hi",
        "just", "need", "want", "do", "is", "it", "our", "your", "today",
    ];
    let lower = text.to_lowercase();
    let mut w: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !STOP.contains(w))
        .collect();
    w.truncate(4);
    w.sort();
    w.dedup();
    w.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn at(day: u32, h: u32, m: u32) -> NaiveDateTime {
        // 2026-03-02 is a Monday.
        NaiveDate::from_ymd_opt(2026, 3, day).unwrap().and_hms_opt(h, m, 0).unwrap()
    }

    fn rec(s: &mut Store, task: &str, t: NaiveDateTime) {
        assert!(record_in(s, "bot", task, t, Origin::User));
    }

    #[test]
    fn three_at_similar_time_suggests_time() {
        let mut s = Store::default();
        rec(&mut s, "check mail", at(2, 9, 0));
        rec(&mut s, "check mail", at(4, 9, 30));
        rec(&mut s, "check mail", at(6, 8, 45));
        let g = suggest(&mut s, "bot", at(7, 12, 0)).unwrap();
        assert_eq!(g.task, "check mail");
        assert_eq!(g.weekday, None);
        assert!((520..=560).contains(&g.minute_of_day));
        assert!(g.describe().contains("around"));
    }

    #[test]
    fn two_is_not_enough() {
        let mut s = Store::default();
        rec(&mut s, "t", at(2, 9, 0));
        rec(&mut s, "t", at(3, 9, 0));
        assert!(suggest(&mut s, "bot", at(4, 9, 0)).is_none());
    }

    #[test]
    fn spread_times_without_weekday_pattern_do_not_suggest() {
        let mut s = Store::default();
        rec(&mut s, "t", at(2, 6, 0));
        rec(&mut s, "t", at(3, 12, 0));
        rec(&mut s, "t", at(4, 20, 0));
        assert!(suggest(&mut s, "bot", at(5, 9, 0)).is_none());
    }

    #[test]
    fn same_weekday_different_times_suggests_weekday() {
        let mut s = Store::default();
        rec(&mut s, "weekly report", at(2, 22, 0));
        rec(&mut s, "weekly report", at(9, 14, 0));
        rec(&mut s, "weekly report", at(16, 20, 0));
        let g = suggest(&mut s, "bot", at(16, 21, 0)).unwrap();
        assert_eq!(g.weekday, Some(0));
        assert!(g.describe().contains("Monday"));
    }

    #[test]
    fn old_signatures_fall_out_of_window() {
        let mut s = Store::default();
        rec(&mut s, "t", at(1, 9, 0));
        rec(&mut s, "t", at(2, 9, 0));
        rec(&mut s, "t", at(3, 9, 0));
        let later = NaiveDate::from_ymd_opt(2026, 3, 30).unwrap().and_hms_opt(9, 0, 0).unwrap();
        assert!(suggest(&mut s, "bot", later).is_none());
    }

    #[test]
    fn one_per_day_and_never_twice_for_task() {
        let mut s = Store::default();
        for d in [2, 3, 4] {
            rec(&mut s, "a", at(d, 9, 0));
            rec(&mut s, "b", at(d, 15, 0));
        }
        assert_eq!(suggest(&mut s, "bot", at(5, 9, 0)).unwrap().task, "a");
        assert!(suggest(&mut s, "bot", at(5, 18, 0)).is_none());
        assert_eq!(suggest(&mut s, "bot", at(6, 9, 0)).unwrap().task, "b");
        assert!(suggest(&mut s, "bot", at(7, 9, 0)).is_none());
    }

    #[test]
    fn other_bot_unaffected() {
        let mut s = Store::default();
        for d in [2, 3, 4] {
            rec(&mut s, "a", at(d, 9, 0));
        }
        assert!(suggest(&mut s, "other", at(5, 9, 0)).is_none());
        assert!(suggest(&mut s, "bot", at(5, 9, 0)).is_some());
    }

    #[test]
    fn non_user_origins_ignored() {
        let mut s = Store::default();
        for o in [Origin::Routine, Origin::Group, Origin::Team, Origin::OtherAgent] {
            assert!(!record_in(&mut s, "bot", "a", at(2, 9, 0), o));
        }
        assert!(s.signatures.is_empty());
        assert!(!record_in(&mut s, "bot", "  ", at(2, 9, 0), Origin::User));
    }

    #[test]
    fn answers() {
        let mut s = Store::default();
        let g = Suggestion { task: "t".into(), weekday: None, minute_of_day: 540 };
        assert_eq!(answer(&mut s, "bot", &g, Answer::Yes).unwrap().unwrap().minute_of_day, 540);
        assert_eq!(answer(&mut s, "bot", &g, Answer::OtherTime("07:15".into())).unwrap().unwrap().minute_of_day, 435);
        assert_eq!(answer(&mut s, "bot", &g, Answer::OtherTime("1830".into())).unwrap().unwrap().minute_of_day, 1110);
        assert!(answer(&mut s, "bot", &g, Answer::OtherTime("25:00".into())).is_err());
        assert!(answer(&mut s, "bot", &g, Answer::OtherTime("soon".into())).is_err());
        assert!(answer(&mut s, "bot", &g, Answer::No).unwrap().is_none());
        assert_eq!(s.declined.len(), 1);
        answer(&mut s, "bot", &g, Answer::No).unwrap();
        assert_eq!(s.declined.len(), 1);
    }

    #[test]
    fn no_is_permanent() {
        let mut s = Store::default();
        for d in [2, 3, 4] {
            rec(&mut s, "a", at(d, 9, 0));
        }
        let g = suggest(&mut s, "bot", at(5, 9, 0)).unwrap();
        answer(&mut s, "bot", &g, Answer::No).unwrap();
        rec(&mut s, "a", at(12, 9, 0));
        rec(&mut s, "a", at(13, 9, 0));
        rec(&mut s, "a", at(14, 9, 0));
        assert!(suggest(&mut s, "bot", at(15, 9, 0)).is_none());
    }

    #[test]
    fn time_cluster_wraps_midnight() {
        let mut s = Store::default();
        rec(&mut s, "t", at(2, 23, 40));
        rec(&mut s, "t", at(3, 0, 10));
        rec(&mut s, "t", at(4, 23, 55));
        let g = suggest(&mut s, "bot", at(5, 9, 0)).unwrap();
        assert!(g.minute_of_day >= 1420 || g.minute_of_day <= 20, "{}", g.minute_of_day);
    }

    #[test]
    fn persistence_roundtrip() {
        let dir = std::env::temp_dir().join(format!("hz-rs-{}", uuid::Uuid::new_v4()));
        let f = dir.join("sig.json");
        assert!(record(&f, "bot", "Check Mail", at(2, 9, 0), Origin::User).unwrap());
        assert!(!record(&f, "bot", "x", at(2, 9, 0), Origin::Group).unwrap());
        let s = load(&f);
        assert_eq!(s.signatures.len(), 1);
        assert_eq!(s.signatures[0].1.task, "check mail");
        assert!(load(&dir.join("none")).signatures.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn fallback_names() {
        assert_eq!(task_name_fallback("Please check my email"), "check email");
        assert_eq!(task_name_fallback("check the EMAIL, please!"), task_name_fallback("Can you check my email"));
        assert_eq!(task_name_fallback("   "), "");
    }
}
