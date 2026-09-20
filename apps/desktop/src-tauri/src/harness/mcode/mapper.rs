//! mcode's ACP vocabulary onto hz's.
//!
//! The wire is ACP, the same one [`fx`](super::fx) speaks, so most of what is
//! here is the reading that harness already settled: no turn-started line, no
//! "requesting" ping, and nothing that closes a block — only the next thing
//! arriving does. Three things are mcode's own:
//!
//! - **A call is announced before it says anything.** `tool_call` carries a
//!   name, a title and a kind and no arguments; the arguments are on the
//!   `tool_call_update` behind it. So the row is committed on the update that
//!   has something to draw, and a call that ends without ever carrying an input
//!   is committed by its own end — otherwise a refused or cancelled tool would
//!   leave no trace on screen at all.
//! - **`rawOutput.details` is the machine-readable half**, and it is what
//!   reaches [`ToolResult::structured`]. A `todowrite` run puts its whole list
//!   there, which is where the plan panel reads it from; every other tool fills
//!   it with its own shape, so it is passed through untouched.
//! - **Thoughts carry a `messageId`**, so a thinking block is closed by the id
//!   changing rather than by the next kind of chunk arriving.

use crate::events::{
    usage::ContextWindow, AgentEvent, AgentEventPayload, BlockRef, BlockType, DeltaEvent,
    SessionInfo, ToolResult, ToolType, TurnStatus, Usage,
};
use crate::harness::{mentions_any, Harness};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::Arc;

use super::parser::{McodeEvent, PromptResponse, SessionUpdate, ToolKind, ToolStatus};

/// What mcode says when the account it is running on is not signed in. Written
/// to under-match, like fx's: a wording missed costs the login button and keeps
/// the sentence, which is the half that names the cure.
const LOGIN_NEEDLES: &[&str] = &["login", "log in", "sign in", "not authenticated", "unauthorized"];

/// The tool mcode spawns a nested agent with. Unlike fx's `subagent` the call is
/// the only account of the run there is, so the panel row is minted from it.
const SUBAGENT_TOOL: &str = "task";

/// A call announced but not yet drawn, kept until it has arguments to draw.
struct Announced {
    name: String,
    kind: ToolKind,
}

/// A streamed block still open, and the text it has accumulated so far — the
/// committed event supersedes the deltas, so the whole text is kept.
struct OpenBlock {
    id: String,
    kind: BlockType,
    text: String,
}

/// Per-session state the mapping needs across lines.
pub struct Mapper {
    /// hz's own id, never mcode's. Every event the frontend routes is keyed on
    /// this; the two are joined on the index entry.
    session_id: String,
    seq: Arc<AtomicU64>,
    /// Whether a prompt is running. Read by the read loop too.
    turn_open: bool,
    /// The one block streaming right now.
    open: Option<OpenBlock>,
    /// Calls announced and not yet committed, by the id the update will name.
    announced: HashMap<String, Announced>,
    /// Calls already committed, so a second update does not draw a second row.
    drawn: std::collections::HashSet<String>,
    /// Calls whose row opened a nested run, so the closing update can close it —
    /// a `tool_call_update` names an id and nothing else.
    subagents: std::collections::HashSet<String>,
    /// The newest spend the agent reported, folded onto the turn's own
    /// `usage.cost_usd` for the same reason [`occupancy`](Self::occupancy) is:
    /// it arrives on `usage_update`, which is never written to the log, and the
    /// composer's context panel reads a settled session back off the log.
    /// `None` until the agent reports one in dollars.
    spend: Option<f64>,
    /// The newest occupancy reading, folded onto the turn's own
    /// `TurnCompleted` — the composer's ring reads it back out of the log, and
    /// `UsageUpdate` is not persisted.
    occupancy: Option<ContextWindow>,
}

impl Mapper {
    pub fn new(session_id: String, seq: Arc<AtomicU64>) -> Self {
        Self {
            session_id,
            seq,
            turn_open: false,
            open: None,
            announced: HashMap::new(),
            drawn: Default::default(),
            subagents: Default::default(),
            occupancy: None,
            spend: None,
        }
    }

    pub fn map(&mut self, event: McodeEvent) -> Vec<AgentEvent> {
        match event {
            McodeEvent::Update(update) => self.update(*update),
            McodeEvent::PromptDone(response) => self.prompt_done(response),
            McodeEvent::PromptFailed { message } => self.prompt_failed(message),
            McodeEvent::Unknown => Vec::new(),
        }
    }

    fn update(&mut self, update: SessionUpdate) -> Vec<AgentEvent> {
        match update {
            SessionUpdate::AgentMessageChunk {
                message_id,
                content,
            } => {
                let Some(text) = content.as_ref().and_then(|c| c.text()) else {
                    return Vec::new();
                };
                let mut out = self.ensure_turn();
                out.extend(self.close_kind(BlockType::Thinking));
                // The id is the block's when mcode sends one, and a constant
                // otherwise: two messages in a row are one block here, since
                // nothing on the wire separates them.
                let id = message_id.unwrap_or_else(|| "message".to_string());
                out.extend(self.stream(id, BlockType::Text, text));
                out
            }

            SessionUpdate::AgentThoughtChunk {
                message_id,
                content,
            } => {
                let Some(text) = content.as_ref().and_then(|c| c.text()) else {
                    return Vec::new();
                };
                let mut out = self.ensure_turn();
                out.extend(self.close_kind(BlockType::Text));
                let id = message_id
                    .map(|id| format!("thought-{id}"))
                    .unwrap_or_else(|| "thought".to_string());
                out.extend(self.stream(id, BlockType::Thinking, text));
                out
            }

            // The announcement: remembered, not drawn. See the module note.
            SessionUpdate::ToolCall {
                tool_call_id,
                name,
                kind,
                ..
            } => {
                self.announced.insert(
                    tool_call_id,
                    Announced {
                        name: name.unwrap_or_else(|| kind_name(kind).to_string()),
                        kind,
                    },
                );
                Vec::new()
            }

            SessionUpdate::ToolCallUpdate {
                tool_call_id,
                status,
                raw_input,
                raw_output,
                ..
            } => {
                let mut out = Vec::new();

                // The row lands here, with the arguments, unless something
                // already drew it — an `in_progress` update carries them, and a
                // call that ends without ever having any is drawn by its end.
                if !self.drawn.contains(&tool_call_id) {
                    let drawable = raw_input.is_some() || status.is_final();
                    if drawable {
                        if let Some(announced) = self.announced.remove(&tool_call_id) {
                            out.extend(self.close_open());
                            out.push(self.tool_started(&tool_call_id, announced, raw_input));
                        }
                    }
                }

                let Some(status) = status.is_final().then_some(status) else {
                    return out;
                };

                let text = raw_output
                    .as_ref()
                    .and_then(|output| output.text())
                    .unwrap_or_default();
                let result = ToolResult {
                    text,
                    is_error: status == ToolStatus::Failed,
                    // mcode's own per-tool shape, passed through whole: the plan
                    // panel reads a `todowrite` run's list out of it, and nothing
                    // here knows what the other eleven tools put beside it.
                    structured: raw_output.as_ref().and_then(|o| o.details.clone()),
                    exit_code: exit_code(raw_output.as_ref().and_then(|o| o.details.as_ref())),
                    duration_ms: None,
                    images: Vec::new(),
                };

                out.push(self.event(AgentEventPayload::ToolCallCompleted {
                    call_id: tool_call_id.clone(),
                    result,
                }));
                // Closes the run the spawning call opened, or the panel row
                // shimmers for the rest of the session.
                if self.subagents.remove(&tool_call_id) {
                    out.push(self.event(AgentEventPayload::SubagentCompleted {
                        // Empty, and that is the honest answer: `agent_id` is the
                        // handle a stop request names, and mcode publishes none
                        // for a child over ACP.
                        agent_id: String::new(),
                        status: status_word(status).to_string(),
                        summary: None,
                        usage: None,
                    }));
                }
                // The model reads the result next — the same reading fx's mapper
                // makes, for the same working indicator.
                out.push(self.event(AgentEventPayload::ModelRequestStarted));
                out
            }

            SessionUpdate::UsageUpdate { used, size, cost } => {
                let window = match (used, size) {
                    (Some(used), Some(size)) if size > 0 => Some(ContextWindow {
                        used_tokens: used,
                        max_tokens: size,
                    }),
                    _ => None,
                };
                if window.is_some() {
                    self.occupancy = window;
                }
                // **The cost, which is the only figure here that money is.**
                // mcode reports USD per turn and nothing else reads it: the
                // composer's context panel is the one surface that shows what a
                // session has spent, and an amount in another currency is
                // dropped rather than drawn behind a `$`.
                let cost_usd = cost.filter(|c| is_usd(c.currency.as_deref())).and_then(|c| c.amount);
                if cost_usd.is_some() {
                    self.spend = cost_usd;
                }

                vec![self.event(AgentEventPayload::UsageUpdate(Usage {
                    context_window: window,
                    cost_usd,
                    ..Default::default()
                }))]
            }

            // Read by the read loop off the parsed update rather than mapped: a
            // title is a fact about the index row, and the mode is a control
            // state — neither is a transcript event. The command list is read by
            // the harness's own `commands`, where the slash menu asks for it.
            SessionUpdate::SessionInfoUpdate { .. }
            | SessionUpdate::AvailableCommandsUpdate { .. }
            | SessionUpdate::CurrentModeUpdate { .. } => Vec::new(),

            SessionUpdate::UserMessageChunk => Vec::new(),
            SessionUpdate::Plan => Vec::new(),
            SessionUpdate::Unknown => Vec::new(),
        }
    }

    /// The committed row for a call, from what its announcement said plus the
    /// arguments that have finally arrived.
    fn tool_started(
        &mut self,
        call_id: &str,
        announced: Announced,
        raw_input: Option<Value>,
    ) -> AgentEvent {
        let Announced { name, kind } = announced;
        let input = tool_input(raw_input);
        self.drawn.insert(call_id.to_string());
        if name == SUBAGENT_TOOL {
            self.subagents.insert(call_id.to_string());
        }

        self.event(AgentEventPayload::ToolCallStarted {
            call_id: call_id.to_string(),
            // mcode's own verb, lowercase — `write`, `bash` — which the tool
            // table in the frontend already conjugates from pi's rows.
            name: name.clone(),
            tool_type: tool_type(kind, &name),
            input,
            raw_input: None,
            // mcode's title is the tool's own name repeated — `bash` beside a
            // row already saying "Bash" — so it is dropped and the row's own
            // summary draws the command or the path off the input.
            title: None,
        })
    }

    fn prompt_done(&mut self, response: PromptResponse) -> Vec<AgentEvent> {
        let mut out = self.close_open();

        let (status, final_text) = match response.stop_reason.as_str() {
            "refused" | "refusal" => (
                TurnStatus::Error,
                Some("mcode refused this prompt.".to_string()),
            ),
            "max_tokens" => (
                TurnStatus::Error,
                Some("mcode stopped: the model hit its output token limit.".to_string()),
            ),
            "max_turn_requests" => (
                TurnStatus::Error,
                Some("mcode stopped: the turn hit its request limit.".to_string()),
            ),
            // `end_turn`, and `cancelled` — the reader's own Stop, reported as a
            // success carrying a reason nothing draws, the reading both other
            // ACP harnesses make.
            _ => (TurnStatus::Success, None),
        };

        out.push(self.turn_completed(
            status,
            Some(response.stop_reason),
            final_text,
            false,
            None,
        ));
        out
    }

    /// `session/prompt` refused outright. The sentence is mcode's own and
    /// usually names its cure (`mcode login`), so it is the row's text.
    fn prompt_failed(&mut self, message: String) -> Vec<AgentEvent> {
        let mut out = self.close_open();
        let auth_failed = mentions_any(&message, LOGIN_NEEDLES);
        out.push(self.turn_completed(
            TurnStatus::Error,
            None,
            Some(message),
            auth_failed,
            None,
        ));
        out
    }

    fn turn_completed(
        &mut self,
        status: TurnStatus,
        stop_reason: Option<String>,
        final_text: Option<String>,
        auth_failed: bool,
        usage: Option<Usage>,
    ) -> AgentEvent {
        let event = self.event(AgentEventPayload::TurnCompleted {
            status,
            stop_reason,
            auth_failed,
            final_text,
            usage: usage.or_else(|| {
                // Nothing at all where neither has been reported: an empty
                // `Usage` would draw a ring reading zero, which is a claim the
                // agent never made.
                if self.occupancy.is_none() && self.spend.is_none() {
                    return None;
                }
                Some(Usage {
                    context_window: self.occupancy,
                    cost_usd: self.spend,
                    ..Default::default()
                })
            }),
            duration_ms: None,
            // Filled by `session::ingest`, the only layer that knows the tree.
            head: None,
        });
        self.turn_open = false;
        self.announced.clear();
        self.drawn.clear();
        event
    }

    /// Opens the turn on its first update. ACP has no turn-started line: the
    /// prompt request is the start and its answer the end, and neither passes
    /// through here — so the first thing the model says is what opens it.
    fn ensure_turn(&mut self) -> Vec<AgentEvent> {
        if self.turn_open {
            return Vec::new();
        }
        self.turn_open = true;
        vec![
            self.event(AgentEventPayload::TurnStarted(SessionInfo {
                cwd: None,
                model: None,
                harness_version: None,
                tools: Vec::new(),
                mcp_servers: Vec::new(),
                subagent_types: Vec::new(),
                settings: None,
            })),
            self.event(AgentEventPayload::ModelRequestStarted),
        ]
    }

    /// Appends a chunk to the block `id`, opening it first where it is not the
    /// one already open.
    fn stream(&mut self, id: String, kind: BlockType, text: &str) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        let same = self
            .open
            .as_ref()
            .is_some_and(|block| block.id == id && block.kind == kind);
        if !same {
            out.extend(self.close_open());
            out.push(self.event(AgentEventPayload::Delta(DeltaEvent::BlockStart {
                block: block_ref(&id),
                block_type: kind.clone(),
            })));
            self.open = Some(OpenBlock {
                id: id.clone(),
                kind,
                text: String::new(),
            });
        }
        if let Some(block) = &mut self.open {
            block.text.push_str(text);
        }
        out.push(self.event(AgentEventPayload::Delta(DeltaEvent::TextDelta {
            block: block_ref(&id),
            text: text.to_string(),
        })));
        out
    }

    /// Closes the open block where it is of `kind` — the other kind of chunk
    /// arriving is what ends a run of one, since nothing on the wire does.
    fn close_kind(&mut self, kind: BlockType) -> Vec<AgentEvent> {
        match &self.open {
            Some(block) if block.kind == kind => self.close_open(),
            _ => Vec::new(),
        }
    }

    /// Closes the streaming block, committing its whole text: the deltas were a
    /// preview and this is what the transcript keeps.
    fn close_open(&mut self) -> Vec<AgentEvent> {
        let Some(block) = self.open.take() else {
            return Vec::new();
        };
        let stop = self.event(AgentEventPayload::Delta(DeltaEvent::BlockStop {
            block: block_ref(&block.id),
        }));
        let committed = match block.kind {
            BlockType::Thinking => self.event(AgentEventPayload::Reasoning {
                block: Some(block_ref(&block.id)),
                // Empty text is what a harness that redacts its reasoning sends;
                // mcode sends the words, so this is a real answer and not a
                // guess.
                encrypted: block.text.is_empty(),
                text: block.text,
            }),
            _ => self.event(AgentEventPayload::AssistantText {
                block: Some(block_ref(&block.id)),
                text: block.text,
            }),
        };
        vec![stop, committed]
    }

    /// Mints an event the read loop needs but no update carried — a permission
    /// request arrives as a JSON-RPC *request* and never reaches [`Self::map`].
    pub fn synthesize(&self, payload: AgentEventPayload) -> AgentEvent {
        self.event(payload)
    }

    fn event(&self, payload: AgentEventPayload) -> AgentEvent {
        AgentEvent {
            // Drained from the same counter every other event in this session
            // is numbered through, since `seq` and not `ts` orders the log: a
            // row that took an id from somewhere else would sort against rows
            // nothing else knows about.
            seq: self.seq.fetch_add(1, Relaxed),
            id: uuid::Uuid::now_v7().to_string(),
            session_id: self.session_id.clone(),
            harness: Harness::Mcode,
            // ACP stamps nothing on a line, so this is hz's own clock — and it
            // is the display time, never the ordering key. See [`seq`].
            ts: crate::events::now_rfc3339(),
            turn_id: None,
            subagent: None,
            payload,
            raw: None,
        }
    }
}

/// The word a closed nested run reports. mcode says nothing about a child's own
/// outcome over ACP beyond the call's status, which is where this comes from.
/// Whether an amount is in dollars. **Absent counts**: mcode's `cost` carries a
/// currency only sometimes, and dollars are what it means when it says nothing.
/// Another currency is dropped rather than drawn, because the one surface that
/// shows a spend would be showing it behind a `$`.
fn is_usd(currency: Option<&str>) -> bool {
    currency.is_none_or(|c| c.eq_ignore_ascii_case("usd"))
}

fn status_word(status: ToolStatus) -> &'static str {
    match status {
        ToolStatus::Completed => "completed",
        ToolStatus::Failed => "failed",
        ToolStatus::InProgress | ToolStatus::Pending | ToolStatus::Unknown => "cancelled",
    }
}

fn block_ref(id: &str) -> BlockRef {
    BlockRef {
        // The id is the whole of what matters here: one block is open at a
        // time, and the deltas of the next are matched on this.
        message_id: id.to_string(),
        index: 0,
    }
}

/// ACP's kind, which is the classification mcode actually sends — its own tool
/// names are lowercase verbs and would have to be known by heart otherwise.
/// `name` is the fallback for a call that arrived with no kind, and `task` is
/// the one name that overrides it: a nested agent is a run, not the file read
/// its kind would otherwise make it.
fn tool_type(kind: ToolKind, name: &str) -> ToolType {
    if name == SUBAGENT_TOOL {
        return ToolType::SubagentSpawn;
    }
    match kind {
        ToolKind::Read => ToolType::FileRead,
        ToolKind::Edit => ToolType::FileEdit,
        ToolKind::Delete => ToolType::FileEdit,
        ToolKind::Move => ToolType::FileEdit,
        ToolKind::Search => ToolType::Search,
        ToolKind::Execute => ToolType::Shell,
        ToolKind::Fetch => ToolType::Web,
        ToolKind::Think => ToolType::Other,
        ToolKind::SwitchMode => ToolType::Other,
        // No kind at all: mcode sends one on every call in the capture, so this
        // is the fallback for a tool it added after this was written.
        ToolKind::Other => ToolType::Other,
    }
}

/// The kind's own name, for a call that arrived without one.
fn kind_name(kind: ToolKind) -> &'static str {
    match kind {
        ToolKind::Read => "read",
        ToolKind::Edit => "edit",
        ToolKind::Delete => "delete",
        ToolKind::Move => "move",
        ToolKind::Search => "grep",
        ToolKind::Execute => "bash",
        ToolKind::Think => "think",
        ToolKind::Fetch => "fetch",
        ToolKind::SwitchMode => "mode",
        ToolKind::Other => "tool",
    }
}

/// The arguments as an object, which is what the row's summary reads.
fn tool_input(raw: Option<Value>) -> Value {
    match raw {
        Some(Value::Object(map)) => Value::Object(map),
        Some(Value::Null) | None => json!({}),
        Some(other) => json!({ "_unparsed": other.to_string() }),
    }
}

/// A shell call's exit status, out of mcode's own `details`. `None` where the
/// tool is not a shell or the shape is not what it was.
fn exit_code(details: Option<&Value>) -> Option<i32> {
    let details = details?.as_object()?;
    // A run that was killed reports no code at all, and `status` is then the
    // only word for it — which the row already draws from `is_error`.
    details
        .get("exitCode")
        .or_else(|| details.get("exit_code"))
        .and_then(Value::as_i64)
        .map(|code| code as i32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::mcode::parser::tests::inbound;
    use crate::events::AgentEventPayload as P;
    use crate::harness::mcode::Coalescer;

    const LIVE_TURN: &str = include_str!("fixtures/live_turn.jsonl");

    fn mapped(fixture: &str) -> Vec<AgentEvent> {
        let mut mapper = Mapper::new("s".to_string(), Arc::new(AtomicU64::new(0)));
        let mut out = Vec::new();
        for value in inbound(fixture) {
            if value.get("method").and_then(Value::as_str) == Some("session/update") {
                let params = value["params"].clone();
                let update = super::super::parser::parse_notification("session/update", params)
                    .expect("a capture update parses")
                    .expect("session/update is modelled");
                out.extend(mapper.map(McodeEvent::Update(Box::new(update))));
            }
            if value.get("id").and_then(Value::as_u64) == Some(3) {
                let response: PromptResponse =
                    serde_json::from_value(value["result"].clone()).expect("prompt response");
                out.extend(mapper.map(McodeEvent::PromptDone(response)));
            }
        }
        out
    }

    /// **The thinking commits as a `Reasoning` block carrying its text.** The
    /// capture is a real turn with 133 `agent_thought_chunk` lines, so this pins
    /// the one thing that makes a reader see the agent think: a Thinking block
    /// closes into a `reasoning` event with the words in it, and not into an
    /// empty one.
    #[test]
    fn the_thinking_of_a_real_turn_commits_with_its_text() {
        let events = mapped(LIVE_TURN);

        let reasoning: Vec<&str> = events
            .iter()
            .filter_map(|e| match &e.payload {
                P::Reasoning { text, encrypted, .. } if !*encrypted => Some(text.as_str()),
                _ => None,
            })
            .collect();

        assert_eq!(reasoning.len(), 2, "two thinking runs in the capture");
        assert!(
            reasoning[0].len() > 100,
            "the whole block, not a chunk: {:?}",
            reasoning[0]
        );
    }

    /// **The read loop's coalescer cannot eat a committed block.** It holds text
    /// deltas and nothing else, so walking the same capture through it must give
    /// back every event the mapper made, thinking included.
    #[test]
    fn the_coalescer_passes_a_committed_thinking_block_through() {
        let events = mapped(LIVE_TURN);
        let want = events
            .iter()
            .filter(|e| matches!(e.payload, P::Reasoning { .. }))
            .count();

        let mut coalescer = Coalescer::new();
        let got = events
            .into_iter()
            .flat_map(|e| coalescer.push(e))
            .filter(|e| matches!(e.payload, P::Reasoning { .. }))
            .count();

        assert_eq!(got, want);
        assert!(want > 0);
    }

    /// One turn, opened by the model's first word and closed by the prompt's own
    /// answer — ACP sends no line for either end.
    #[test]
    fn a_prompt_opens_a_turn_and_its_response_closes_it() {
        let events = mapped(LIVE_TURN);

        let turns: Vec<&AgentEvent> = events
            .iter()
            .filter(|e| matches!(e.payload, P::TurnStarted(_)))
            .collect();
        assert_eq!(turns.len(), 1);

        let completed = events
            .iter()
            .find_map(|e| match &e.payload {
                P::TurnCompleted {
                    status,
                    stop_reason,
                    usage,
                    ..
                } => Some((*status, stop_reason.clone(), usage.clone())),
                _ => None,
            })
            .expect("the turn closed");
        assert_eq!(completed.0, TurnStatus::Success);
        assert_eq!(completed.1.as_deref(), Some("end_turn"));
        // The ring reads its occupancy back out of the log, and `UsageUpdate` is
        // not persisted — so it has to ride the turn's own event.
        assert_eq!(
            completed.2.unwrap().context_window,
            Some(ContextWindow {
                used_tokens: 13955,
                max_tokens: 1000000
            })
        );
    }

    /// The four runs in the capture commit as four blocks, and the id mcode puts
    /// on a thought is what separates one from the next.
    #[test]
    fn every_run_of_chunks_commits_once() {
        let events = mapped(LIVE_TURN);

        let messages: Vec<&str> = events
            .iter()
            .filter_map(|e| match &e.payload {
                P::AssistantText { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        let thoughts: Vec<&str> = events
            .iter()
            .filter_map(|e| match &e.payload {
                P::Reasoning { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();

        // Three, not two: mcode puts a `messageId` on every chunk and gives
        // each message its own, so the id — not the kind of chunk arriving — is
        // what ends a run here. Two answers written back to back without one
        // would still commit as one block, which is the case fx has and this
        // one does not.
        assert_eq!(messages.len(), 3, "{messages:?}");
        assert_eq!(thoughts.len(), 2, "{thoughts:?}");
        assert!(thoughts[0].starts_with("The user asks to write a file"));
        assert_eq!(thoughts[1], "Now run wc -c.");
        assert_eq!(
            messages[0],
            "Quick one — writing the file, then checking its size."
        );
        assert!(messages[1].contains("Running the byte count now."));
        // The committed block is the whole message, not the first half of it.
        assert!(messages[2].contains("reports **2**"));
        assert!(messages[2].ends_with("File: [hello.txt](/tmp/hz-mcode-probe/hello.txt)"));
    }

    /// The row is committed with the arguments, not on the announcement — which
    /// is the opposite order to fx's and the whole reason this mapper keeps them.
    #[test]
    fn a_call_is_drawn_once_it_has_arguments() {
        let events = mapped(LIVE_TURN);
        let started: Vec<(&str, &Value)> = events
            .iter()
            .filter_map(|e| match &e.payload {
                P::ToolCallStarted { name, input, .. } => Some((name.as_str(), input)),
                _ => None,
            })
            .collect();

        assert_eq!(started.len(), 2, "one row each, not one row plus an echo");
        assert_eq!(started[0].0, "write");
        assert_eq!(started[0].1["path"], "/tmp/hz-mcode-probe/hello.txt");
        assert_eq!(started[0].1["content"], "hi");
        assert_eq!(started[1].0, "bash");
        assert_eq!(started[1].1["command"], "wc -c hello.txt");
    }

    /// `rawOutput` is the result, and its `details` is the machine-readable half
    /// the plan panel reads a `todowrite` run out of.
    #[test]
    fn a_result_carries_its_text_and_its_details() {
        let events = mapped(LIVE_TURN);
        let results: Vec<&ToolResult> = events
            .iter()
            .filter_map(|e| match &e.payload {
                P::ToolCallCompleted { result, .. } => Some(result),
                _ => None,
            })
            .collect();

        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].text,
            "Successfully wrote 2 bytes to /tmp/hz-mcode-probe/hello.txt"
        );
        assert!(!results[0].is_error);
        assert_eq!(results[0].structured.as_ref().unwrap()["bytes_written"], 2);

        assert_eq!(results[1].text, "       2 hello.txt\n");
        // A `bash` run reports a task id and the env vars it stripped; none of
        // it is read here, and all of it survives for whoever asks later.
        assert!(results[1].structured.is_some());
    }

    /// The classifications the tool rows draw from, which mcode sends as ACP
    /// kinds rather than as names this app would have to know.
    #[test]
    fn kinds_become_this_apps_own_tool_types() {
        assert_eq!(tool_type(ToolKind::Edit, "write"), ToolType::FileEdit);
        assert_eq!(tool_type(ToolKind::Execute, "bash"), ToolType::Shell);
        assert_eq!(tool_type(ToolKind::Read, "read"), ToolType::FileRead);
        assert_eq!(tool_type(ToolKind::Search, "grep"), ToolType::Search);
        // A nested agent is a run whatever kind it was filed under.
        assert_eq!(tool_type(ToolKind::Other, "task"), ToolType::SubagentSpawn);
    }
}
