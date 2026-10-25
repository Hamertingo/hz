//! Draft cards and the send state machine.

use serde::{Deserialize, Serialize};

/// Where a draft goes when sent: `gmail`, `app:<name>` or `clipboard`.
pub type Channel = String;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "reason", rename_all = "snake_case")]
pub enum State {
    Draft,
    SendRequested,
    Sent,
    Failed(String),
    Discarded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Draft {
    pub id: String,
    pub to: String,
    pub subject: String,
    pub body: String,
    pub attachments: Vec<String>,
    pub channel: Channel,
    pub state: State,
    /// Receipt from the sender (for example a time or message id), set on `Sent`.
    #[serde(default)]
    pub receipt: Option<String>,
}

/// Delivers a draft; returns a receipt such as "gmail at 10:02" on success.
pub trait Sender {
    fn send(&self, draft: &Draft) -> anyhow::Result<String>;
}

impl Draft {
    /// A fresh draft in `State::Draft`; the agent can only ever make these.
    pub fn new(id: &str, to: &str, subject: &str, body: &str, attachments: Vec<String>, channel: &str) -> Draft {
        Draft {
            id: id.into(),
            to: to.into(),
            subject: subject.into(),
            body: body.into(),
            attachments,
            channel: channel.into(),
            state: State::Draft,
            receipt: None,
        }
    }

    /// True for `gmail`, `clipboard` and `app:<non-empty name>`.
    pub fn channel_valid(&self) -> bool {
        match self.channel.as_str() {
            "gmail" | "clipboard" => true,
            c => c.strip_prefix("app:").is_some_and(|n| !n.trim().is_empty()),
        }
    }

    /// Replaces the body; only allowed while the card is a draft or failed.
    pub fn edit(&mut self, body: &str) -> Result<(), String> {
        match self.state {
            State::Draft | State::Failed(_) => {
                self.body = body.into();
                Ok(())
            }
            _ => Err(format!("cannot edit a draft that is {}", self.label())),
        }
    }

    /// The user pressed Send: `Draft`/`Failed` -> `SendRequested`. Only the user path calls this.
    pub fn request_send(&mut self) -> Result<(), String> {
        match self.state {
            State::Draft | State::Failed(_) => {
                if !self.channel_valid() {
                    return Err(format!("unknown channel '{}'", self.channel));
                }
                self.state = State::SendRequested;
                Ok(())
            }
            _ => Err(format!("cannot send a draft that is {}", self.label())),
        }
    }

    /// The user pressed Discard; allowed from `Draft` and `Failed` only.
    pub fn discard(&mut self) -> Result<(), String> {
        match self.state {
            State::Draft | State::Failed(_) => {
                self.state = State::Discarded;
                Ok(())
            }
            _ => Err(format!("cannot discard a draft that is {}", self.label())),
        }
    }

    /// Settles a `SendRequested` draft as `Sent` or `Failed`; refused from any other state.
    pub fn finish(&mut self, result: anyhow::Result<String>) -> Result<(), String> {
        if self.state != State::SendRequested {
            return Err(format!("nothing to finish: draft is {}", self.label()));
        }
        match result {
            Ok(r) => {
                self.state = State::Sent;
                self.receipt = Some(r);
            }
            Err(e) => self.state = State::Failed(e.to_string()),
        }
        Ok(())
    }

    fn label(&self) -> &'static str {
        match self.state {
            State::Draft => "a draft",
            State::SendRequested => "waiting to send",
            State::Sent => "sent",
            State::Failed(_) => "failed",
            State::Discarded => "discarded",
        }
    }

    /// One line the agent reads to learn what happened to its draft.
    pub fn outcome(&self) -> String {
        match &self.state {
            State::Draft => "still a draft, waiting for the user".into(),
            State::SendRequested => "send requested, in progress".into(),
            State::Sent => format!(
                "sent via {}{}",
                self.channel,
                self.receipt.as_deref().map(|r| format!(" at {r}")).unwrap_or_default()
            ),
            State::Failed(r) => format!("failed: {r}"),
            State::Discarded => "discarded".into(),
        }
    }
}

/// Runs the sender on a `SendRequested` draft and records the result; a no-op in every other state.
pub fn process(draft: &mut Draft, sender: &dyn Sender) {
    if draft.state != State::SendRequested {
        return;
    }
    let r = sender.send(draft);
    let _ = draft.finish(r);
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake(bool);
    impl Sender for Fake {
        fn send(&self, d: &Draft) -> anyhow::Result<String> {
            if self.0 { Ok(format!("10:02 to {}", d.to)) } else { Err(anyhow::anyhow!("smtp down")) }
        }
    }

    fn d() -> Draft {
        Draft::new("1", "a@b.c", "Hi", "body", vec!["f.pdf".into()], "gmail")
    }

    #[test]
    fn new_draft_starts_as_draft() {
        assert_eq!(d().state, State::Draft);
    }

    #[test]
    fn happy_path_sends() {
        let mut x = d();
        x.request_send().unwrap();
        process(&mut x, &Fake(true));
        assert_eq!(x.state, State::Sent);
        assert!(x.outcome().starts_with("sent via gmail at 10:02"));
    }

    #[test]
    fn failure_then_retry() {
        let mut x = d();
        x.request_send().unwrap();
        process(&mut x, &Fake(false));
        assert_eq!(x.state, State::Failed("smtp down".into()));
        assert_eq!(x.outcome(), "failed: smtp down");
        x.request_send().unwrap();
        process(&mut x, &Fake(true));
        assert_eq!(x.state, State::Sent);
    }

    #[test]
    fn never_sent_without_request() {
        let mut x = d();
        process(&mut x, &Fake(true));
        assert_eq!(x.state, State::Draft);
        assert!(x.finish(Ok("x".into())).is_err());
        assert_eq!(x.state, State::Draft);
        let mut y = d();
        y.discard().unwrap();
        process(&mut y, &Fake(true));
        assert_eq!(y.state, State::Discarded);
    }

    #[test]
    fn edit_rules() {
        let mut x = d();
        x.edit("new").unwrap();
        assert_eq!(x.body, "new");
        x.request_send().unwrap();
        assert!(x.edit("late").is_err());
        process(&mut x, &Fake(false));
        x.edit("fixed").unwrap();
        x.request_send().unwrap();
        process(&mut x, &Fake(true));
        assert!(x.edit("after sent").is_err());
        assert_eq!(x.body, "fixed");
    }

    #[test]
    fn discard_rules() {
        let mut x = d();
        x.discard().unwrap();
        assert_eq!(x.outcome(), "discarded");
        assert!(x.request_send().is_err());
        let mut y = d();
        y.request_send().unwrap();
        assert!(y.discard().is_err());
        process(&mut y, &Fake(true));
        assert!(y.discard().is_err());
    }

    #[test]
    fn sent_is_terminal() {
        let mut x = d();
        x.request_send().unwrap();
        process(&mut x, &Fake(true));
        assert!(x.request_send().is_err());
        process(&mut x, &Fake(false));
        assert_eq!(x.state, State::Sent);
    }

    #[test]
    fn channel_validation() {
        let mut x = d();
        assert!(x.channel_valid());
        x.channel = "app:Slack".into();
        assert!(x.channel_valid());
        x.channel = "app:".into();
        assert!(!x.channel_valid());
        assert!(x.request_send().is_err());
        x.channel = "fax".into();
        assert!(!x.channel_valid());
        x.channel = "clipboard".into();
        assert!(x.channel_valid());
    }

    #[test]
    fn serde_roundtrip() {
        let mut x = d();
        x.state = State::Failed("nope".into());
        let s = serde_json::to_string(&x).unwrap();
        let y: Draft = serde_json::from_str(&s).unwrap();
        assert_eq!(x, y);
    }
}
