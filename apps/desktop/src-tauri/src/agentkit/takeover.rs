//! You in control of an agent's screen: a mark file per screen, and the agent's request to be handed control.

use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A mark older than this is a forgotten takeover, not a live one.
pub const STALE_AFTER_MINUTES: i64 = 30;
/// How long a request to take over waits for an answer.
pub const REQUEST_EXPIRY_MINUTES: i64 = 15;

/// Where the mark for `screen` lives under `dir`.
pub fn mark_path(dir: &Path, screen: u32) -> PathBuf {
    dir.join(format!("takeover-{screen}.mark"))
}

/// The mark holds its own start time, so staleness never depends on file mtimes.
pub struct Takeover;

impl Takeover {
    /// Writes the mark: from now the user drives this screen.
    pub fn take(dir: &Path, screen: u32, now: DateTime<Utc>) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        std::fs::write(mark_path(dir, screen), now.to_rfc3339())
    }

    /// Removes the mark; handing back a screen that was never taken is not an error.
    pub fn give_back(dir: &Path, screen: u32) -> std::io::Result<()> {
        match std::fs::remove_file(mark_path(dir, screen)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }

    /// True while the mark is fresh; a stale or unreadable one is removed and counts as free.
    pub fn is_taken(dir: &Path, screen: u32, now: DateTime<Utc>) -> bool {
        let path = mark_path(dir, screen);
        let Ok(text) = std::fs::read_to_string(&path) else {
            return false;
        };
        let since = DateTime::parse_from_rfc3339(text.trim()).ok().map(|t| t.with_timezone(&Utc));
        match since {
            Some(t) if now.signed_duration_since(t) < chrono::Duration::minutes(STALE_AFTER_MINUTES) => true,
            _ => {
                let _ = std::fs::remove_file(path);
                false
            }
        }
    }
}

/// How a wait for the screen ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitOutcome {
    Free,
    TimedOut,
}

/// Polls the mark until the user hands the screen back or `timeout` passes; `clock` supplies the wall time the mark is judged against.
pub async fn wait_until_free(
    dir: &Path,
    screen: u32,
    poll: Duration,
    timeout: Duration,
    clock: &dyn Fn() -> DateTime<Utc>,
) -> WaitOutcome {
    let start = tokio::time::Instant::now();
    loop {
        if !Takeover::is_taken(dir, screen, clock()) {
            return WaitOutcome::Free;
        }
        if start.elapsed() >= timeout {
            return WaitOutcome::TimedOut;
        }
        tokio::time::sleep(poll).await;
    }
}

/// Why an agent wants the user at the wheel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Reason {
    Login,
    Captcha,
    Payment,
    Other(String),
}

/// Where a request stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RequestState {
    Pending,
    Granted,
    Declined,
    Expired,
}

/// An agent asking the user to take over its screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Request {
    pub reason: Reason,
    pub site: String,
    /// Unix seconds; plain integers keep the request serialisable without chrono's serde feature.
    pub created_at: i64,
    answer: Option<bool>,
}

impl Request {
    /// A fresh pending request made at `now`.
    pub fn new(reason: Reason, site: impl Into<String>, now: DateTime<Utc>) -> Self {
        Self { reason, site: site.into(), created_at: now.timestamp(), answer: None }
    }

    /// The user said yes; ignored once answered or expired.
    pub fn grant(&mut self, now: DateTime<Utc>) {
        if self.state(now) == RequestState::Pending {
            self.answer = Some(true);
        }
    }

    /// The user said no; ignored once answered or expired.
    pub fn decline(&mut self, now: DateTime<Utc>) {
        if self.state(now) == RequestState::Pending {
            self.answer = Some(false);
        }
    }

    /// An answer sticks; an unanswered request lapses after fifteen minutes.
    pub fn state(&self, now: DateTime<Utc>) -> RequestState {
        match self.answer {
            Some(true) => RequestState::Granted,
            Some(false) => RequestState::Declined,
            None if now.timestamp() - self.created_at >= REQUEST_EXPIRY_MINUTES * 60 => {
                RequestState::Expired
            }
            None => RequestState::Pending,
        }
    }

    /// One line shown to the user in the ask.
    pub fn prompt(&self) -> String {
        let why = match &self.reason {
            Reason::Login => "sign in".to_string(),
            Reason::Captcha => "solve a CAPTCHA".to_string(),
            Reason::Payment => "confirm a payment".to_string(),
            Reason::Other(s) => s.clone(),
        };
        format!("Your agent needs you to {why} on {}.", self.site)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("hz-takeover-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn t(min: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap() + chrono::Duration::minutes(min)
    }

    #[test]
    fn path_is_per_screen() {
        let d = Path::new("/x");
        assert_ne!(mark_path(d, 1), mark_path(d, 2));
        assert!(mark_path(d, 3).ends_with("takeover-3.mark"));
    }

    #[test]
    fn take_then_taken_then_give_back() {
        let d = tmp();
        assert!(!Takeover::is_taken(&d, 2, t(0)));
        Takeover::take(&d, 2, t(0)).unwrap();
        assert!(Takeover::is_taken(&d, 2, t(5)));
        Takeover::give_back(&d, 2).unwrap();
        assert!(!Takeover::is_taken(&d, 2, t(5)));
    }

    #[test]
    fn screens_are_independent() {
        let d = tmp();
        Takeover::take(&d, 1, t(0)).unwrap();
        assert!(!Takeover::is_taken(&d, 2, t(0)));
    }

    #[test]
    fn stale_mark_is_free_and_removed() {
        let d = tmp();
        Takeover::take(&d, 1, t(0)).unwrap();
        assert!(Takeover::is_taken(&d, 1, t(29)));
        assert!(!Takeover::is_taken(&d, 1, t(30)));
        assert!(!mark_path(&d, 1).exists());
    }

    #[test]
    fn garbage_mark_is_free() {
        let d = tmp();
        std::fs::write(mark_path(&d, 1), "not a time").unwrap();
        assert!(!Takeover::is_taken(&d, 1, t(0)));
        assert!(!mark_path(&d, 1).exists());
    }

    #[test]
    fn give_back_without_mark_is_ok() {
        assert!(Takeover::give_back(&tmp(), 9).is_ok());
    }

    #[tokio::test(start_paused = true)]
    async fn wait_returns_free_at_once_when_not_taken() {
        let d = tmp();
        let out = wait_until_free(&d, 1, Duration::from_secs(1), Duration::from_secs(10), &|| t(0)).await;
        assert_eq!(out, WaitOutcome::Free);
    }

    #[tokio::test(start_paused = true)]
    async fn wait_times_out_while_taken() {
        let d = tmp();
        Takeover::take(&d, 1, t(0)).unwrap();
        let out = wait_until_free(&d, 1, Duration::from_secs(1), Duration::from_secs(5), &|| t(1)).await;
        assert_eq!(out, WaitOutcome::TimedOut);
    }

    #[tokio::test(start_paused = true)]
    async fn wait_continues_on_hand_back() {
        let d = tmp();
        Takeover::take(&d, 1, t(0)).unwrap();
        let d2 = d.clone();
        let giver = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            Takeover::give_back(&d2, 1).unwrap();
        });
        let out = wait_until_free(&d, 1, Duration::from_secs(1), Duration::from_secs(60), &|| t(1)).await;
        giver.await.unwrap();
        assert_eq!(out, WaitOutcome::Free);
    }

    #[test]
    fn request_lifecycle() {
        let mut r = Request::new(Reason::Captcha, "example.com", t(0));
        assert_eq!(r.state(t(1)), RequestState::Pending);
        r.grant(t(2));
        assert_eq!(r.state(t(100)), RequestState::Granted);
        r.decline(t(3));
        assert_eq!(r.state(t(3)), RequestState::Granted);
    }

    #[test]
    fn request_expires_and_cannot_be_granted_late() {
        let mut r = Request::new(Reason::Login, "a.com", t(0));
        assert_eq!(r.state(t(14)), RequestState::Pending);
        assert_eq!(r.state(t(15)), RequestState::Expired);
        r.grant(t(16));
        assert_eq!(r.state(t(16)), RequestState::Expired);
    }

    #[test]
    fn declined_request() {
        let mut r = Request::new(Reason::Payment, "shop.com", t(0));
        r.decline(t(1));
        assert_eq!(r.state(t(2)), RequestState::Declined);
    }

    #[test]
    fn prompt_names_reason_and_site() {
        assert!(Request::new(Reason::Login, "a.com", t(0)).prompt().contains("sign in on a.com"));
        assert!(Request::new(Reason::Other("pick a seat".into()), "b.com", t(0)).prompt().contains("pick a seat"));
    }
}
