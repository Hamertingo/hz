//! The wire shape between the hz app and the `hz` CLI.
//!
//! Compiled into both sides so the two cannot drift. That is the whole reason
//! this is a crate rather than a struct in each: a drifted request shape is not
//! reported anywhere — the server fails to parse, answers an error, and the
//! command simply stops working. Same failure the harness's own control
//! protocol is typed against.
//!
//! Deliberately thin: serde, and the one function that decides where to
//! connect. No tokio and no tauri, so the CLI links none of either.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Bumped when an old side would answer a new request *wrongly and silently* —
/// the server refuses a version it doesn't know rather than guessing at it.
///
/// Not simply "a field changed meaning", which was the earlier rule and is too
/// narrow. What matters is whether the default an old side falls back to is
/// detectable. An added optional field usually needs no bump: an old app that
/// ignores `model` runs the session on its own default, which is a session the
/// caller can see and judge. `from` is the other kind — an old app ignores it,
/// starts the worktree from `origin/<default>`, and answers *identically to a
/// success*, so a session spawned to review unpushed work reviews none of it
/// and reports back that everything looks fine. Wrong work that looks like
/// right work is what earns a bump.
///
/// Refusing costs every command, not just the new one — but that cost falls
/// where it is cheapest. A CLI behind the app is told to run `hz update` and
/// fixes itself in one step; an app behind the CLI cannot be fixed from here at
/// all, and that is exactly the direction a silent default does the most
/// damage in. See [`Envelope`] and the app's own `mismatch`, which names which
/// half is behind so the reader — usually an agent, reading it as tool output —
/// runs the cure that applies rather than the one that doesn't.
///
/// ## What earned each bump
///
/// `v2` = `from`, `v3` = `issues` and `LinkIssues`, `v4` = `LinkIssues.identifiers`
/// renamed to `issues`, `v5` = `Browser`, `v6` = `fast`, **`v7` = [`Envelope::id`]**.
///
/// v7 is the first bump for a field whose *absence* is the hazard rather than a
/// wrong default. An app that ignores `id` runs the request — exactly as it does
/// today — and answers `ok`, so a caller told "retry with this id" retries and
/// the side effect happens twice with nothing anywhere saying so. The advice is
/// what is new and it is unkeepable below v7, which is the "wrong work that
/// looks like right work" this constant exists for.
pub const PROTOCOL_VERSION: u32 = 7;

/// Where the app listens, unless [`endpoint`] is overridden.
pub const SOCKET_NAME: &str = "hz.sock";

/// Where a `pnpm tauri dev` build listens instead.
///
/// One name per build, because the socket is a single file: a dev app binding
/// the release app's path unlinks it and takes the channel over, so from then
/// on every `hz` call reaches the dev app and the release app's own agents
/// write into a socket nothing is listening on. Restarting the release app
/// takes it back the same way. Two names let the two run side by side, which
/// is the ordinary state while developing this app.
pub const SOCKET_NAME_DEV: &str = "hz-dev.sock";

/// A line longer than this is refused unread. The socket is `0600`, so this is
/// hygiene rather than a threat model — but a length-prefixed-by-newline
/// protocol with no cap is one malformed writer away from an allocation the
/// size of the sender's patience.
pub const MAX_LINE: u64 = 1024 * 1024;

/// One request, with the protocol version flattened alongside it so the server
/// can check the version before it decides what the rest of the line means.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u32,
    /// The caller's name for this request, optional because most callers do not
    /// have one to give.
    ///
    /// **It exists so a retry can be answered rather than repeated.** A CLI
    /// killed mid-request — an agent's Bash timeout is the ordinary way — leaves
    /// its caller unable to tell "did not run" from "ran and I never heard".
    /// Retrying the first is correct and retrying the second sends the same
    /// prompt into a session twice. Given an id, the app remembers the answer
    /// and hands the second attempt that same answer without dispatching again,
    /// and a second attempt that arrives while the first is still running waits
    /// for it rather than starting its own.
    ///
    /// Opaque to the app: any non-empty string, chosen by the caller. Omitted
    /// rather than sent as `null`, so the line for a caller that has none is the
    /// one it always was.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(flatten)]
    pub request: Request,
}

impl Envelope {
    /// A line with no id: the shape every caller sent before v7, and what a
    /// one-shot command with nothing to retry still sends.
    pub fn new(request: Request) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            id: None,
            request,
        }
    }

    /// A line a caller can retry: see [`Envelope::id`].
    pub fn retryable(request: Request, id: impl Into<String>) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            id: Some(id.into()),
            request,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Request {
    CreateSession(CreateSession),
    ListSessions(ListSessions),
    SendMessage(SendMessage),
    LinkIssues(LinkIssues),
    Browser(BrowserRequest),
}

/// One step in a session's own browser — the tabs the app draws for it.
///
/// Every action lands on that session's active tab, so an agent can reach no
/// other session's pages by construction: there is no target id to guess, the
/// session is the address. The verbs follow agent-browser's, so an agent that
/// knows one knows the other.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserRequest {
    pub session_id: String,
    pub action: BrowserAction,
}

/// How an element is named. `Target` is what the line carries — `@e12` from
/// the last snapshot, or a CSS selector; the rest are `find`'s locators,
/// matched the way a person reads the page rather than the way it is built.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "by", rename_all = "snake_case")]
pub enum Locator {
    Target { target: String },
    Role {
        role: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        exact: bool,
    },
    Text {
        text: String,
        #[serde(default)]
        exact: bool,
    },
    Label {
        label: String,
        #[serde(default)]
        exact: bool,
    },
    Placeholder {
        placeholder: String,
        #[serde(default)]
        exact: bool,
    },
    Alt {
        alt: String,
        #[serde(default)]
        exact: bool,
    },
    Title {
        title: String,
        #[serde(default)]
        exact: bool,
    },
    TestId { id: String },
    /// One of a selector's matches; `-1` is the last.
    Nth { selector: String, index: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "what", rename_all = "snake_case")]
pub enum Get {
    Text,
    Html,
    Value,
    Attr { name: String },
    Title,
    Url,
    Count,
    /// The bounding box, in viewport pixels.
    Box,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Is {
    Visible,
    Enabled,
    Checked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BrowserAction {
    Open { url: String },
    Back,
    Forward,
    Reload,
    /// Close the active tab.
    Close,
    Tabs,
    TabNew {
        #[serde(default)]
        url: Option<String>,
    },
    TabSwitch { id: i32 },
    TabClose {
        #[serde(default)]
        id: Option<i32>,
    },
    /// Interactive elements and headings, each with a ref for the actions.
    Snapshot {
        #[serde(default)]
        interactive: bool,
        #[serde(default)]
        compact: bool,
        #[serde(default)]
        selector: Option<String>,
    },
    Click { at: Locator },
    DblClick { at: Locator },
    Focus { at: Locator },
    Hover { at: Locator },
    /// Keystrokes into an element, after whatever it holds.
    Type { at: Locator, text: String },
    /// Replace what an element holds.
    Fill { at: Locator, text: String },
    /// A key name (`Enter`, `Tab`, `Escape`, `ArrowDown`, `a`), with
    /// `Meta+`/`Ctrl+`/`Shift+`/`Alt+` prefixes.
    Press { key: String },
    Check { at: Locator },
    Uncheck { at: Locator },
    /// Pick an option by value or label.
    Select { at: Locator, value: String },
    /// `up`, `down`, `left`, `right` by `amount` pixels.
    Scroll { direction: String, amount: f64 },
    ScrollIntoView { at: Locator },
    Get {
        #[serde(flatten)]
        what: Get,
        #[serde(default)]
        at: Option<Locator>,
    },
    Is { what: Is, at: Locator },
    /// Whichever is set: a selector to appear, milliseconds, a URL fragment,
    /// visible text, or `load` for the page to finish loading.
    Wait {
        #[serde(default)]
        selector: Option<String>,
        #[serde(default)]
        ms: Option<u64>,
        #[serde(default)]
        url: Option<String>,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        load: Option<String>,
    },
    /// PNG to `path`, which must sit under the session's checkout, or a file
    /// under `~/.hz/browser/shots`; `full` is the whole document rather
    /// than the viewport.
    Screenshot {
        #[serde(default)]
        path: Option<String>,
        #[serde(default)]
        full: bool,
    },
    /// Evaluate JavaScript in the page and answer its JSON value.
    Eval { js: String },
    /// What the page logged since last asked.
    Console,
    /// Errors alone, since last asked.
    Errors,
    SetViewport { width: u32, height: u32 },
    /// A device preset by name, as the pane's device bar lists them.
    SetDevice { name: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSession {
    pub prompt: String,
    /// The repo the session runs in — the main worktree, which the CLI fills
    /// from `git worktree list` when `--project` is absent, so a call from a
    /// terminal lands in the repo it was made from and a call from inside a
    /// linked worktree still names the repo rather than that tree. `None` falls
    /// back to the parent session's project, and with neither the server
    /// refuses.
    #[serde(default)]
    pub project_path: Option<String>,
    /// `None` inherits the parent session's model, or the app's default with no
    /// parent. A bare alias (`opus`), matching what the composer stores.
    #[serde(default)]
    pub model: Option<String>,
    /// `low`..`max`. `None` inherits the parent's, and failing that the model's
    /// own default — which the app resolves, since a model with no effort
    /// levels must be sent none at all.
    #[serde(default)]
    pub effort: Option<String>,
    /// `claude_code` today. `None` inherits the parent's, and defaults to
    /// Claude Code with no parent.
    #[serde(default)]
    pub harness: Option<String>,
    /// The session whose agent is making this call, from `HZ_SESSION_ID`.
    /// Absent for a call from the user's own terminal, which is ordinary.
    #[serde(default)]
    pub parent_session_id: Option<String>,
    /// Where the new session's worktree starts from: a session id, a branch, or
    /// any git ref. `None` is the ordinary case and means `origin/<default>`,
    /// which is what the harness would have picked on its own.
    ///
    /// A session id is resolved to the branch that session's work lands on, and
    /// that resolution is the app's — the CLI has no index to read and no
    /// business learning how a session's branch is named.
    #[serde(default)]
    pub from: Option<String>,
    /// Issue identifiers (`DRA-53`) the new session's work is against.
    ///
    /// Resolved by the app, not here: the CLI holds no key and has no business
    /// learning what a tracker is. Each one becomes a link on the session and a
    /// line in the prompt — identifier and title, nothing more, since the agent
    /// has the tracker's own MCP server for the rest.
    #[serde(default)]
    pub issues: Vec<String>,
    /// Whether the session runs at its harness's faster, dearer tier.
    ///
    /// `None` inherits the parent's, and only within one harness — the same
    /// boundary `model` and `effort` stop at, for a nearer reason: a `true`
    /// carried from a Claude parent onto a Codex child turns on a paid tier on
    /// a different vendor's account, which is not what inheriting "run this one
    /// like me" can be taken to mean.
    ///
    /// **This is what earns the v6 bump.** An old app ignores the field and
    /// runs the session at ordinary speed — which answers *identically to a
    /// success*, since nothing in the transcript says which tier served it. An
    /// agent told to fan a deadline out fast would read every session back as
    /// fine and none of them would have been.
    #[serde(default)]
    pub fast: Option<bool>,
}

/// Tagging a session that already exists — or untagging it.
///
/// One request with a flag rather than two, because the halves differ by a
/// single word and every field is otherwise the same.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkIssues {
    pub session_id: String,
    pub issues: Vec<IssueInput>,
    /// Remove these links instead of adding them. Only `identifier` is read.
    #[serde(default)]
    pub unlink: bool,
}

/// One issue to tag a session with, as the caller already knows it.
///
/// **The app writes this down and asks the tracker nothing.** A link is a local
/// record — this session is about that work — and making it depend on a
/// reachable tracker meant a link could fail for reasons that have nothing to
/// do with what it records. The caller is an agent that has just read the issue
/// through the tracker's own MCP server, so it has the title and the URL in
/// hand; asking a second system for what the caller already holds is a round
/// trip that can only introduce a way to fail.
///
/// `title` and `url` are optional because a bare identifier is still a usable
/// link: the tag reads `#DRA-53` with no title after it, and stays plain text
/// rather than becoming a link to nowhere.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueInput {
    /// As a person writes it; case is the app's to normalize.
    pub identifier: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

/// A prompt sent into a session that already exists.
///
/// Both directions on purpose: a spawned session reporting a summary back to
/// its parent and a parent handing a child extra context are the same
/// operation, so there is one command rather than a reply channel and a
/// separate send.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessage {
    pub session_id: String,
    pub prompt: String,
    /// Who is sending, for the line the receiving agent actually reads. Absent
    /// from a terminal call, where the message is the user's own.
    #[serde(default)]
    pub from_session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessions {
    /// Every project rather than just the one this call resolves to.
    #[serde(default)]
    pub all: bool,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub parent_session_id: Option<String>,
}

/// Tagged rather than an `ok` boolean beside a bag of optional payloads: the
/// three answers carry disjoint fields, and a struct that can hold all of them
/// at once can also hold none of them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Response {
    Created {
        session: SessionSummary,
        /// What `from` resolved to, echoed back because the caller asked with a
        /// string and the answer is a branch: `--from <session-id>` names a
        /// session, and only the app can say which branch that session's work
        /// is on. `None` for an ordinary create, which starts where the harness
        /// would have started it anyway.
        ///
        /// Not a compatibility signal. It was one before [`PROTOCOL_VERSION`]
        /// was bumped for `from` — its absence stood in for "this app is too
        /// old to honour the flag" — and the bump is what made that job
        /// unreachable: such an app now refuses the envelope before it ever
        /// reads the request.
        #[serde(default)]
        base_ref: Option<String>,
    },
    Listed { sessions: Vec<SessionSummary> },
    /// Every issue the session carries *after* the change, so the caller sees
    /// the result rather than a diff it has to apply to what it believed.
    Linked { issues: Vec<IssueLink> },
    /// `queued` when the target had a turn in flight, so the prompt is held
    /// until it reaches a boundary rather than being dropped or interrupting.
    Sent { queued: bool },
    /// What a browser action answers: `output` as text for the agent to
    /// read, `data` the same answer for `--json`.
    Browser { output: String, data: serde_json::Value },
    Error { message: String },
}

impl Response {
    pub fn error(message: impl Into<String>) -> Self {
        Self::Error {
            message: message.into(),
        }
    }
}

/// What the CLI is told about a session. A deliberate subset of the app's own
/// `SessionIndexItem`: that type carries ts-rs derives and the app's model and
/// permission enums, none of which the CLI has any use for, and every field
/// named here is one the server has to keep answering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub title: String,
    /// Where the agent runs — the worktree for a worktree session, so this is
    /// the directory a reader would `cd` into.
    pub cwd: String,
    pub project_path: String,
    pub branch: Option<String>,
    pub worktree_name: Option<String>,
    /// `idle`, `in_progress` or `completed`, as the app's own index spells them.
    pub status: String,
    pub modified: String,
    /// Which session created this one, so a caller can answer "who spawned
    /// that" without reading the app's own index. Absent for a session started
    /// from the composer or from a terminal, and for one since detached.
    #[serde(default)]
    pub parent_session_id: Option<String>,
}

/// One issue a session is tagged with, as the CLI prints it.
///
/// A deliberate subset of the app's own `IssueRef`, for [`SessionSummary`]'s
/// reason: that type carries ts-rs derives and a tracker enum, neither of which
/// this side has any use for.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueLink {
    pub identifier: String,
    pub title: String,
    pub url: String,
}

/// Where to reach the app: `HZ_ENDPOINT` if set, else the socket under the
/// app's own directory.
///
/// The env var is what lets this survive the app moving to a server — a cloud
/// build hands the child an HTTPS URL instead, and nothing above this function
/// knows the difference.
pub fn endpoint() -> Option<String> {
    if let Ok(value) = std::env::var("HZ_ENDPOINT") {
        if !value.is_empty() {
            return Some(value);
        }
    }

    Some(socket_path(false)?.to_string_lossy().into_owned())
}

/// The socket one build of the app listens on, `~/.hz/hz.sock` by default.
/// Resolved through `dirs` rather than `$HOME` so it agrees with the app's own
/// `get_home_app_dir`, which creates the directory this sits in.
///
/// The CLI never asks for the dev one: `hz` typed in a terminal means the app
/// the reader installed, and a dev app hands its own children `HZ_ENDPOINT`
/// rather than leaving them to guess which build spawned them.
pub fn socket_path(dev: bool) -> Option<PathBuf> {
    let name = if dev { SOCKET_NAME_DEV } else { SOCKET_NAME };
    Some(std::env::home_dir()?.join(".hz").join(name))
}

/// One request or response as it goes on the wire. Newline-delimited JSON, the
/// same framing the harness pipe uses, so no second convention enters either
/// codebase.
pub fn encode_line<T: Serialize>(value: &T) -> serde_json::Result<String> {
    let mut line = serde_json::to_string(value)?;
    line.push('\n');
    Ok(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The id rides beside the flattened request and survives both directions,
    /// and a line without one still parses — the two halves of an optional field
    /// that an older caller and a newer one each depend on.
    #[test]
    fn the_request_id_round_trips_and_is_optional() {
        let with = Envelope::retryable(
            Request::ListSessions(ListSessions {
                all: false,
                project_path: None,
                parent_session_id: None,
            }),
            "abc-1",
        );
        let line = encode_line(&with).unwrap();
        assert!(line.contains(r#""id":"abc-1""#), "{line}");

        let back: Envelope = serde_json::from_str(&line).unwrap();
        assert_eq!(back.id.as_deref(), Some("abc-1"));
        assert_eq!(back.v, PROTOCOL_VERSION);

        // Absent, not null: a caller with no id sends the line it always sent.
        let bare: Envelope = serde_json::from_str(r#"{"v":7,"cmd":"list_sessions"}"#).unwrap();
        assert_eq!(bare.id, None);
        assert!(!encode_line(&Envelope::new(bare.request)).unwrap().contains("id"));
    }

    /// Deliberately a v1 line, and that is half the point: an envelope from a
    /// version we no longer speak still has to *parse*, or the app answers
    /// "could not parse the request" where it should be answering "run
    /// `hz update`". The version check is a layer above this, not a way in.
    #[test]
    fn absent_optionals_parse_as_none() {
        let envelope: Envelope =
            serde_json::from_str(r#"{"v":1,"cmd":"create_session","prompt":"hi"}"#).unwrap();
        assert_ne!(envelope.v, PROTOCOL_VERSION, "this line is the old shape");

        let Request::CreateSession(create) = envelope.request else {
            panic!("wrong variant");
        };
        assert_eq!(create.project_path, None);
        assert_eq!(create.parent_session_id, None);
        assert_eq!(create.model, None);
        assert_eq!(create.effort, None);
        assert_eq!(create.harness, None);
        assert_eq!(create.from, None);
    }

    #[test]
    fn endpoint_prefers_the_environment() {
        // Serialized against the other env-reading test by running in one
        // process; `set_var` is process-wide.
        std::env::set_var("HZ_ENDPOINT", "/tmp/custom.sock");
        assert_eq!(endpoint().as_deref(), Some("/tmp/custom.sock"));

        // Empty reads as unset rather than as an address, so an exported-but-
        // blank var falls back instead of failing to connect to "".
        std::env::set_var("HZ_ENDPOINT", "");
        assert!(endpoint().unwrap().ends_with("hz.sock"));

        std::env::remove_var("HZ_ENDPOINT");
    }
}
