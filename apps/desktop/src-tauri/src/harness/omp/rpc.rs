//! Talking to `omp --mode rpc`.
//!
//! omp is a peer that does **not** speak JSON-RPC, exactly as pi is. Commands go
//! out as JSON lines carrying an `id` and a `type`; answers come back tagged
//! `type: "response"` with that id and the `command` it answers; everything else
//! on the pipe is an event tagged by nothing but its own `type`.
//!
//! So the framing differs from [`codex::rpc`](crate::harness::codex::rpc) and the
//! *correlation* does not: outbound requests carrying an id, a pending map, and
//! a demux that settles answers before anything else sees the line. That core
//! lives in [`crate::harness::rpc`]; what is left here is omp's framing and its
//! write gate.
//!
//! **Records split on `\n` only.** `U+2028` and `U+2029` are legal inside JSON
//! strings, so a reader treating them as line breaks corrupts any record
//! containing one. Rust's `BufRead::lines` is correct here by construction.
//!
//! **Two things pi's client does not have to think about.** The first is `ready`:
//! omp writes a frame on spawn where pi says nothing, and it is not a response,
//! so it falls through to the event side and the read loop drops it — the shape
//! is modelled so it is not filed as a coverage gap, not because anything acts
//! on it. The second is the **id-less refusal**, below.

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::Arc;
use tokio::process::ChildStdin;
use tokio::sync::mpsc;
use tokio::time::Duration;

use super::parser::ResponseLine;
use crate::harness::rpc::{spawn_writer, Outbound, Pending};

/// How long a command may go unanswered before it is given up on.
///
/// Nothing here waits on *work*: omp answers `prompt` the moment it accepts one,
/// and its doc says failures after acceptance arrive through the event stream
/// rather than as a second response. So an unanswered command means omp has
/// stopped listening.
///
/// A dead child needs none of this — the pipe closes and every waiter wakes.
/// This covers the child that stays alive and goes quiet, where a send would
/// otherwise hang with nothing on screen saying why.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// The first command's own bound, wider than the rest.
///
/// omp writes a `ready` frame on spawn, so unlike pi there *is* a sign of life
/// before the handshake — but it is written before the session is up, so it
/// says the process started and nothing about whether it can answer. The
/// handshake is still the first command, and this is how long it may take.
///
/// pi's is 45s because pi holds an auth lock a killed predecessor can strand.
/// **omp has no such lock** — `~/.omp/agent` carries `config.yml.lock` and
/// `mcp.json.lock` and no auth one, and its credentials live in SQLite — so that
/// particular reason does not carry across. The width is kept anyway because the
/// cost of being wrong is asymmetric: too short turns a slow start into a
/// session that cannot be created at all, too long costs a wait.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(45);

/// One line read off omp, sorted by what it is rather than what it says.
pub enum Incoming {
    /// An event. Handed on for the parser to type.
    Event(String),
    /// An answer to something we sent. Already routed to its waiter; carried
    /// here only so a stray one can be filed.
    Response { matched: bool },
    /// Not JSON at all.
    Malformed,
}

/// The write side of the connection, plus the map of what we are waiting on.
///
/// Cloneable because the read loop needs it: omp's one inbound request —
/// `extension_ui_request` — has to be answered from where it is read, exactly as
/// Claude's unanswerable `control_request` is, and omp blocks the tool call
/// until it is.
#[derive(Clone, Debug)]
pub struct OmpClient {
    tx: mpsc::UnboundedSender<Outbound>,
    next_id: Arc<AtomicU64>,
    pending: Pending<String, String>,
    /// Whether stdin has been closed, and the gate every write passes through.
    ///
    /// A `Mutex<bool>` rather than an atomic, because the flag and the queue
    /// have to move together. The queue accepts lines it will never write:
    /// `close` enqueues a `Close` marker and the writer drops everything behind
    /// it, while `tx.send` answers `Ok` for each — so an answered dialog took
    /// that `Ok` as delivery and retired its card claiming a reply had reached
    /// an omp that never saw it. Checking a flag and then sending is two steps,
    /// and a close landing between them lands in exactly that hole; under one
    /// lock there is no between.
    closed: Arc<std::sync::Mutex<bool>>,
}

impl OmpClient {
    /// Takes the child's stdin and spawns the one task allowed to write to it.
    pub fn new(stdin: ChildStdin) -> Self {
        Self::over(spawn_writer(stdin))
    }

    fn over(tx: mpsc::UnboundedSender<Outbound>) -> Self {
        Self {
            tx,
            next_id: Arc::new(AtomicU64::new(1)),
            closed: Arc::new(std::sync::Mutex::new(false)),
            pending: Pending::new(),
        }
    }

    /// A client with nothing on the other end, for tests.
    ///
    /// The receiver is dropped, so a `send` fails the way one to a closed pipe
    /// does. That is what a test of the *shape* of a line wants: it builds the
    /// line and never needs it to arrive.
    #[cfg(test)]
    pub fn detached() -> Self {
        let (tx, _rx) = mpsc::unbounded_channel();
        Self::over(tx)
    }

    /// Sends a command and waits for its answer, up to [`REQUEST_TIMEOUT`].
    pub async fn request(&self, command: &str, extra: Value) -> Result<Value> {
        self.request_within(command, extra, REQUEST_TIMEOUT).await
    }

    /// [`Self::request`] with the bound named, so the handshake can be tighter
    /// and a test need not wait one out.
    ///
    /// `extra` is merged into the line rather than nested under a `params` key:
    /// omp's commands are flat objects, so `prompt` carries its `message`
    /// alongside `id` and `type`.
    pub async fn request_within(
        &self,
        command: &str,
        extra: Value,
        timeout: Duration,
    ) -> Result<Value> {
        let id = format!("d{}", self.next_id.fetch_add(1, Relaxed));

        let mut line = json!({"id": id, "type": command});
        if let (Some(target), Some(fields)) = (line.as_object_mut(), extra.as_object()) {
            for (key, value) in fields {
                target.insert(key.clone(), value.clone());
            }
        }

        let rx = self.pending.register(id.clone());

        // The slot goes back if the write never happened. Registering first is
        // what closes the race against an answer arriving before this line
        // returns, but leaving the entry behind on a failed write leaks one per
        // attempt — and they are never collected, since the id that would clear
        // one was never sent.
        if let Err(err) = self.send(&line) {
            self.pending.forget(&id);
            return Err(err);
        }

        // omp names exactly what was wrong — `Model not found: nope/nope` —
        // which is why `models.rs` leaves omp's ids unvalidated and lets the
        // failure report them.
        self.pending.wait(&id, rx, timeout, command, "omp").await
    }

    /// Writes a line built by the caller.
    ///
    /// For the one shape that is neither a command nor a response to one:
    /// `extension_ui_response`, which carries omp's *own* id rather than one
    /// this client minted, and so must not go near the pending map.
    pub fn send(&self, line: &Value) -> Result<()> {
        let line = serde_json::to_string(line)?;

        // Held across the queue write, so a `close` cannot land between the two.
        let closed = self.closed.lock().expect("omp stdin flag poisoned");
        if *closed {
            bail!("omp's stdin is closed");
        }

        self.tx
            .send(Outbound::Line(line))
            .context("omp's stdin writer has stopped")
    }

    /// Closes omp's stdin, which is how omp is asked to exit.
    ///
    /// Best effort by construction — a writer that has already stopped means the
    /// child is gone, which is the state this was asking for.
    ///
    /// pi's version of this is load-bearing for a reason omp does not share: pi
    /// holds `~/.pi/agent/auth.json.lock` and a `SIGKILL`ed one strands it, so
    /// the cost of killing pi lands on the *next* pi. **omp has no such lock.**
    /// This is kept as an ordinary courtesy — a child asked to leave runs its
    /// own teardown, releasing its SQLite handles and its session file — rather
    /// than as the thing that keeps the next spawn from stalling.
    pub fn close(&self) {
        // Flagged and queued under one lock, so every write is either wholly
        // before this or refused by it.
        let mut closed = self.closed.lock().expect("omp stdin flag poisoned");
        *closed = true;
        let _ = self.tx.send(Outbound::Close);
    }

    /// Routes one line off omp's stdout.
    ///
    /// Answers are settled here and reported as [`Incoming::Response`] so a
    /// stray one can be filed; everything else is handed back for the parser.
    ///
    /// **The id-less refusal is why this is not simply pi's.** omp echoes the id
    /// on a success and **drops it on a failure** — an unknown command answers
    /// `{"type":"response","command":"get_commands","success":false,"error":…}`
    /// with no `id` at all, verified live. The pending map is keyed by id, so
    /// that line cannot settle anything: the caller it belongs to waits out its
    /// whole timeout and reports a timeout instead of omp's own sentence, which
    /// named exactly what was wrong.
    ///
    /// There is no safe way to attribute it here — a failure with no id could
    /// belong to any command in flight — so the line is filed as a stray, which
    /// is the same treatment an answer to nobody gets, and the read loop's log
    /// carries omp's sentence. The real defence is one level up: **Dray sends
    /// only commands omp defines**, and each is verified against the build
    /// before it is wired, so this path is a report rather than a routine.
    pub async fn accept(&self, line: &str) -> Incoming {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Incoming::Malformed;
        };

        if value.get("type").and_then(Value::as_str) != Some("response") {
            return Incoming::Event(line.to_string());
        }

        // The parser's own shape, rather than walked by hand a second time. A
        // response it cannot read is filed as a stray, like one nobody waits on.
        let Ok(response) = serde_json::from_value::<ResponseLine>(value) else {
            return Incoming::Response { matched: false };
        };

        // A response with no id answers a command sent without one, or is a
        // refusal — see the note above. Dray always sends an id, so there is
        // nothing of ours it could be settling.
        let Some(id) = response.id else {
            return Incoming::Response { matched: false };
        };

        let answer = if response.success {
            Ok(response.data)
        } else {
            Err(response
                .error
                .unwrap_or_else(|| "omp refused the command and said nothing about why".to_string()))
        };

        Incoming::Response {
            matched: self.pending.settle(&id, answer),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A client with no child behind it, writing into a drain.
    ///
    /// The drain is not decoration: dropping the receiver makes every `send`
    /// fail, so a client built without one exercises the write-failure path on
    /// every test rather than the demux these are about.
    fn detached() -> OmpClient {
        let (tx, mut rx) = mpsc::unbounded_channel::<Outbound>();
        tokio::spawn(async move { while rx.recv().await.is_some() {} });

        OmpClient {
            tx,
            next_id: Arc::new(AtomicU64::new(1)),
            closed: Arc::new(std::sync::Mutex::new(false)),
            pending: Pending::new(),
        }
    }

    /// A real child, ended by EOF rather than by force.
    ///
    /// `cat` stands in for omp: what is being pinned is that [`OmpClient::close`]
    /// closes stdin, and a reader that ends on EOF is the only witness to that.
    #[tokio::test]
    async fn close_ends_the_child_rather_than_leaving_it_running() {
        let mut child = tokio::process::Command::new("/bin/cat")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("spawn cat");

        let client = OmpClient::new(child.stdin.take().expect("stdin"));

        // Held like the read loop holds one, so this proves `close` rather than
        // the last clone being dropped.
        let reader = client.clone();

        client.close();

        let status = tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .expect("the child outlived its EOF")
            .expect("wait");

        assert!(status.success());
        drop(reader);
    }

    /// The handshake frame goes down the *event* side, never the answer side.
    ///
    /// It is written on spawn where pi writes nothing, and treating it as a
    /// response would settle a pending request that nothing sent.
    #[tokio::test]
    async fn the_ready_frame_is_an_event_and_not_an_answer() {
        let client = detached();

        let line = r#"{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],
            "maxFrameBytes":1048576,"maxReassembledFrameBytes":67108864}"#;

        assert!(matches!(client.accept(line).await, Incoming::Event(_)));
    }

    #[tokio::test]
    async fn an_event_is_never_mistaken_for_an_answer() {
        let client = detached();

        for line in [
            r#"{"type":"agent_start"}"#,
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}"#,
            // Carries an id, and is still not a response: only `type` decides.
            r#"{"type":"extension_ui_request","id":"x1","method":"confirm"}"#,
        ] {
            assert!(matches!(client.accept(line).await, Incoming::Event(_)));
        }
    }

    #[tokio::test]
    async fn an_answer_reaches_the_caller_that_asked() {
        let client = detached();

        let waiting = {
            let client = client.clone();
            tokio::spawn(async move { client.request("get_state", Value::Null).await })
        };

        let settled = {
            let client = client.clone();
            tokio::spawn(async move {
                loop {
                    let outcome = client
                        .accept(
                            r#"{"id":"d1","type":"response","command":"get_state",
                                "success":true,"data":{"model":{"id":"x"}}}"#,
                        )
                        .await;
                    if matches!(outcome, Incoming::Response { matched: true }) {
                        return;
                    }
                    tokio::task::yield_now().await;
                }
            })
        };

        settled.await.unwrap();
        let answer = waiting.await.unwrap().expect("the request should settle");

        assert_eq!(answer["model"]["id"], "x");
    }

    /// A failure is the same line with `success: false`, and omp's sentence is
    /// the only place the cure is named — so it has to reach the caller rather
    /// than being flattened to "the command failed".
    #[tokio::test]
    async fn a_refusal_carries_omps_own_sentence() {
        let client = detached();

        let waiting = {
            let client = client.clone();
            tokio::spawn(async move { client.request("set_model", json!({"model": "nope"})).await })
        };

        let settled = {
            let client = client.clone();
            tokio::spawn(async move {
                loop {
                    let outcome = client
                        .accept(
                            r#"{"id":"d1","type":"response","command":"set_model",
                                "success":false,"error":"Model not found: nope/nope"}"#,
                        )
                        .await;
                    if matches!(outcome, Incoming::Response { matched: true }) {
                        return;
                    }
                    tokio::task::yield_now().await;
                }
            })
        };

        settled.await.unwrap();
        let err = waiting.await.unwrap().expect_err("the command was refused");

        assert!(
            err.to_string().contains("Model not found: nope/nope"),
            "omp's sentence was lost: {err}"
        );
    }

    /// **A refusal with no id is filed, not attributed.** omp drops the id on a
    /// failure, so it cannot settle the caller it belongs to — and guessing
    /// which one it was would answer the wrong request with someone else's
    /// error. The caller times out and the log carries omp's sentence, which is
    /// the honest pair of outcomes.
    #[tokio::test]
    async fn an_id_less_refusal_is_filed_rather_than_guessed_at() {
        let client = detached();

        let outcome = client
            .accept(
                r#"{"type":"response","command":"get_commands","success":false,
                    "error":"Unknown command: get_commands"}"#,
            )
            .await;

        assert!(matches!(outcome, Incoming::Response { matched: false }));
    }

    /// An answer to an id nobody is waiting on must cost one line, not a panic
    /// and not a hung caller. A reply landing after its caller timed out is the
    /// ordinary way this happens.
    #[tokio::test]
    async fn a_stray_answer_is_filed_rather_than_dropped_silently() {
        let client = detached();

        let outcome = client
            .accept(r#"{"id":"d99","type":"response","command":"prompt","success":true}"#)
            .await;

        assert!(matches!(outcome, Incoming::Response { matched: false }));
    }

    #[tokio::test]
    async fn a_line_that_is_not_json_is_reported_rather_than_parsed() {
        let client = detached();

        assert!(matches!(
            client.accept("omp wrote something that isn't JSON").await,
            Incoming::Malformed
        ));
    }

    /// Giving up on an answer has to give up the slot, or an unresponsive child
    /// leaks one entry per attempt for the life of the session.
    #[tokio::test]
    async fn a_timed_out_request_leaves_no_slot_behind() {
        let client = detached();

        let err = client
            .request_within("get_state", Value::Null, Duration::from_millis(20))
            .await
            .expect_err("nothing answered it");

        assert!(err.to_string().contains("get_state"));
        assert!(client.pending.is_empty());
    }

    /// And so does a write that never happened.
    #[tokio::test]
    async fn a_failed_write_leaves_no_slot_behind() {
        let (tx, rx) = mpsc::unbounded_channel::<Outbound>();
        drop(rx);

        let client = OmpClient {
            tx,
            next_id: Arc::new(AtomicU64::new(1)),
            closed: Arc::new(std::sync::Mutex::new(false)),
            pending: Pending::new(),
        };

        client
            .request("get_state", Value::Null)
            .await
            .expect_err("the pipe is closed");

        assert!(client.pending.is_empty());
    }

    /// Nothing is told its line was taken once stdin is closed.
    ///
    /// `close` only *enqueues* a `Close`, and the writer drops everything behind
    /// it while `tx.send` answers `Ok` for each — so an answered dialog took that
    /// `Ok` as delivery and retired its card claiming a reply had reached an omp
    /// that never saw it. The flag and the queue move under one lock.
    #[tokio::test]
    async fn a_closed_client_refuses_rather_than_queueing() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let client = OmpClient {
            tx,
            next_id: Arc::new(AtomicU64::new(1)),
            closed: Arc::new(std::sync::Mutex::new(false)),
            pending: Pending::new(),
        };

        client.send(&json!({"type": "before"})).expect("stdin is open");
        client.close();
        client
            .send(&json!({"type": "after"}))
            .expect_err("a line behind the close would be dropped, not written");

        assert!(matches!(rx.recv().await, Some(Outbound::Line(_))));
        assert!(matches!(rx.recv().await, Some(Outbound::Close)));
        assert!(
            rx.try_recv().is_err(),
            "nothing may be queued behind the close"
        );
    }
}
