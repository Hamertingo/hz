//! `omp --mode rpc`'s wire format, typed.
//!
//! Same conventions as the other three parsers: every enum that can grow carries
//! `#[serde(other)]`, fields omp may omit carry `#[serde(default)]`, and
//! genuinely volatile payloads stay as `Value`. A shape we have not modelled
//! must cost one field or one line, never the connection.
//!
//! **Structurally this is pi's.** omp is a fork of it and kept the framing: flat
//! `{id, type, …}` commands, answers tagged `type: "response"` carrying that id,
//! and events tagged by nothing but their own `type`. So one
//! `#[serde(tag = "type")]` enum covers the whole inbound stream, and the
//! `#[serde(other)]` catch-all is what stops a frame this build has never seen
//! from costing the line.
//!
//! Four shapes are omp's own, and each is here rather than inherited:
//!
//! - **`ready`**, written on spawn. pi says nothing at all, so its handshake is
//!   "send `get_state` and read the answer" — omp answers the same question, and
//!   this frame arrives first carrying the protocol version and the frame caps.
//! - **`agent_end` is the turn closer.** omp has no `agent_settled` anywhere; the
//!   run ends on this line and says whether it is final through `isTerminal`.
//!   See [`OmpEvent::AgentEnd`].
//! - **`available_commands_update`**, pushed rather than answered. omp does
//!   answer `get_available_commands` too, which is the route
//!   [`super::commands`] takes; the push is modelled so it is not filed as a
//!   coverage gap, and is where a later slice fills the picker without a probe.
//! - **`toolcall_start` carries no tool name.** pi puts `id` and `toolName` on
//!   the frame; omp puts the whole partial message in `partial` and the model's
//!   block inside it. [`AssistantEvent::tool_call`] reads it back out, which is
//!   the one place this parser has to reach into a nested shape to answer a
//!   question pi answers flat.
//!
//! Every shape here was taken from a live capture against `omp 18.1.20` under
//! `fixtures/`, not from `docs/rpc.md`. The doc got two things wrong that a
//! written-against-the-doc parser would have shipped: the turn has no
//! `agent_settled`, and `tool_execution_update` fires between a call's start and
//! its end rather than not existing.

use serde::Deserialize;
use serde_json::Value;

/// One line omp wrote, typed.
///
/// `Unknown` is a coverage gap and is filed as one. It is deliberately not the
/// same thing as a line we have modelled and chosen to draw nothing for, which
/// gets a variant of its own — folding the two turns the failure log from a
/// signal into noise, which is the `tool_progress` lesson from Claude Code.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum OmpEvent {
    /// The answer to a command, carrying the id it was sent with.
    ///
    /// Thin by design for `prompt`: omp answers `success: true` the moment the
    /// prompt is *accepted*, and its doc says failures after acceptance are
    /// reported through the event stream rather than as a second response. So
    /// awaiting this proves the prompt was taken and nothing else.
    Response(ResponseLine),

    /// The handshake frame, written before anything else and answered by
    /// nothing. Modelled so it is not filed as a gap; the version it carries is
    /// read where a v2 decision would be made, and this build stays on v1.
    Ready {
        #[serde(default)]
        protocol_version: Option<u32>,
        #[serde(default)]
        supported_protocol_versions: Option<Vec<u32>>,
        #[serde(default)]
        max_frame_bytes: Option<u64>,
        #[serde(default)]
        max_reassembled_frame_bytes: Option<u64>,
    },

    /// Dray's turn opens. One per prompt, however many model calls it takes.
    AgentStart,
    /// **Dray's turn closes, and this is the only line that closes one.**
    ///
    /// omp has no `agent_settled` — pi's settle line does not exist anywhere in
    /// it. The run ends here, and `isTerminal` says whether it is final:
    /// `false` means maintenance or async delivery has scheduled more work, so
    /// the session resumes before its true settle.
    ///
    /// **The field is optional and absent means terminal**, verbatim from
    /// `docs/rpc.md`: "the field is optional so frames from older runtimes,
    /// where it is absent, remain terminal-compatible." So the reader tests
    /// `is_terminal != Some(false)` — a parser or mapper testing
    /// `== Some(true)` closes no turn on a runtime that omits it, which is a
    /// session stuck `in_progress` with a complete transcript on screen.
    AgentEnd {
        #[serde(default)]
        is_terminal: Option<bool>,
        /// The whole conversation as omp sees it. Not read: the committed
        /// messages already drew it, and pulling it in would double every row.
        /// Carried so the shape is stated rather than guessed at.
        #[serde(default)]
        messages: Option<Value>,
    },

    /// One model call opens. Several per `agent_start` on any turn that calls a
    /// tool.
    TurnStart,
    TurnEnd {
        #[serde(default)]
        message: Option<OmpMessage>,
    },

    /// A message opens. The `user` and `toolResult` ones are echoes of what Dray
    /// already knows and are dropped by the mapper; the `assistant` one is where
    /// the block ids are minted.
    MessageStart { message: OmpMessage },
    /// The committed message. This wins over the deltas that preceded it, the
    /// same bargain Claude Code's `assistant` event makes.
    MessageEnd { message: OmpMessage },
    /// One streaming frame.
    ///
    /// Unlike pi's — and unlike Claude Code's — `usage` on these is *populated*
    /// on a real provider, but it is not read: the turn's figures come off the
    /// committed message and `turn_end`, which carry the same numbers once
    /// rather than dozens of times.
    MessageUpdate {
        assistant_message_event: AssistantEvent,
    },

    /// A tool is about to run. Distinct from the `toolCall` block above it: that
    /// one is the model *asking*, this one is omp *doing*.
    ToolExecutionStart {
        tool_call_id: String,
        tool_name: String,
        #[serde(default)]
        args: Value,
        /// omp's own one-line description of what the call is for. Not drawn —
        /// the row has the tool and its arguments already.
        #[serde(default)]
        intent: Option<String>,
    },
    /// Partial output while a tool runs, between its start and its end.
    ///
    /// Modelled and drawn as nothing: the tool row already shimmers for exactly
    /// as long as the call is pending, so there is no row for this to fill.
    /// Modelled rather than left to `Unknown` for the reason Claude Code's
    /// `tool_progress` was — a high-volume line nothing draws would be a third
    /// of the parse-failure file, and that file is only useful while everything
    /// in it is a real gap.
    ToolExecutionUpdate,

    /// A subagent's lifecycle — started driving the panel's header, completed
    /// closing it. Correlates on `parentToolCallId`, the *spawning* call's id,
    /// which is what nests the run under its tool row.
    ///
    /// Everything optional but the two ids: a status this build has never seen
    /// still opens or closes the run, since the frontend reads `done`, not the
    /// wire's word for why.
    SubagentLifecycle {
        payload: SubagentLifecyclePayload,
    },
    /// A subagent's heartbeat while it works. `progress` carries the live
    /// status line (`lastIntent`), the last tool it ran (`recentTools`), and
    /// its own token counts — the panel's row, not the main transcript's.
    SubagentProgress {
        payload: SubagentProgressPayload,
    },
    /// One of a subagent's own events, forwarded whole on its `id`. Inner
    /// frames are shaped like the main thread's — a `message_end` carries a
    /// message, a `tool_execution_start` a call — so the mapper reuses the same
    /// shapes rather than modelling a second wire.
    ///
    /// Only the two the panel draws are read: `message_end` for the subagent's
    /// words, `tool_execution_start`/`end` for its tool calls. Everything else
    /// (its own `agent_start`, streaming updates, retries) is traffic the
    /// panel has no row for.
    SubagentEvent {
        payload: SubagentEventPayload,
    },

     ToolExecutionEnd {
         tool_call_id: String,
         tool_name: String,
         #[serde(default)]
         result: Value,
         #[serde(default)]
         is_error: bool,
     },

    /// The only line that travels inbound expecting an answer, and the channel
    /// omp's *own* approval card rides.
    ///
    /// Captured with `--approval-mode always-ask`:
    ///
    /// ```json
    /// {"type":"extension_ui_request","id":"…","method":"select",
    ///  "title":"Allow tool: bash\nCommand: echo hi","options":["Approve","Deny"]}
    /// ```
    ///
    /// omp blocks the tool call until an `extension_ui_response` carrying this
    /// id comes back, so silence is not neutral — it stalls the session with a
    /// complete transcript on screen and nothing saying why. That is why the
    /// read loop refuses what it cannot draw rather than ignoring it.
    ExtensionUiRequest {
        id: String,
        method: String,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        message: Option<String>,
        #[serde(default)]
        options: Option<Vec<Value>>,
        /// Positionally aligned with `options`, and only sent when a row has
        /// one. Read and dropped: the card draws the option's label, and a
        /// second line of text under each choice is a surface this app has not
        /// built.
        #[serde(default)]
        option_details: Option<Value>,
    },

    /// omp confirming a setting moved, whether Dray asked or a reader typed a
    /// command into omp itself.
    ///
    /// Not read back into `Session`'s copy, deliberately: reconciling app state
    /// *from* a report quietly fails, because the app's own record is what the
    /// picker draws and what a resume replays. Modelled so the failure log stays
    /// a list of real gaps.
    ModelChanged,
    ThinkingLevelChanged,

    /// omp's own view of what is queued behind the running turn.
    ///
    /// Dray keeps its own queue in `Session` and draws from that, so this is
    /// omp's copy of a fact the app already owns.
    QueueUpdate,

    /// The command list, pushed rather than answered — at startup and whenever
    /// the metadata changes.
    ///
    /// Captured **three times in one turn**, two of them byte-identical, so
    /// whatever reads this has to be idempotent. Nothing does yet:
    /// [`super::commands`] asks `get_available_commands` instead, which is pi's
    /// route and needs no stream. Modelled so the repetition is visible rather
    /// than filed as a gap three times a turn.
    AvailableCommandsUpdate {
        #[serde(default)]
        commands: Value,
    },

    /// omp's name for the session changed. Dray writes and owns titles — omp's
    /// own generation is off in RPC mode — so there is nothing to adopt here.
    SessionInfoUpdate,

    AutoCompactionStart,
    /// A compaction finished, whether or not it produced anything.
    ///
    /// `aborted` and a missing `result` are the two ways it can end with nothing
    /// to report, and both still have to close the indicator its start opened.
    AutoCompactionEnd {
        #[serde(default)]
        reason: Option<String>,
        #[serde(default)]
        result: Option<CompactionResult>,
        #[serde(default)]
        aborted: bool,
    },

    /// A failed model request being tried again.
    AutoRetryStart {
        #[serde(default)]
        attempt: Option<u32>,
        #[serde(default)]
        max_attempts: Option<u32>,
        /// Why the request failed. omp names one where Claude Code mostly does
        /// not, so this is the cause the indicator gets to show.
        #[serde(default)]
        error_message: Option<String>,
    },
    AutoRetryEnd,

    /// A prompt that was accepted and later resolved without a model turn —
    /// a local-only slash command.
    ///
    /// **Load-bearing rather than informational.** Such a prompt emits no
    /// `agent_end`, so a session that waits for one sits `in_progress` forever
    /// after `/help`. It carries the id of the `prompt` that caused it.
    PromptResult {
        #[serde(default)]
        id: Option<String>,
        #[serde(default)]
        agent_invoked: Option<bool>,
    },

    /// An extension threw. omp carries on, and so does the session.
    ///
    /// Worth a row where the rest of this group is not: it is the reader's own
    /// extension failing in their own session, and nothing else on screen will
    /// say so — a permission extension that throws simply stops gating, which
    /// looks exactly like it working.
    ExtensionError {
        #[serde(default)]
        extension_path: Option<String>,
        #[serde(default)]
        error: Option<String>,
    },

    /// A line this build has never seen. Filed, and costs nothing else.
    #[serde(other)]
    Unknown,
}

/// What a compaction saved, where it got far enough to say.
///
/// Every field optional and unknown ones ignored, which is the rule the whole
/// parser follows: a compaction whose numbers cannot be read still closes the
/// indicator — the UI drops a saving it cannot compute rather than reporting a
/// wrong one.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionResult {
    #[serde(default)]
    pub tokens_before: Option<u64>,
    /// Estimated, and omp says so in its own field name. It is what the model
    /// will actually be handed next turn, which is the number the ring wants.
    #[serde(default)]
    pub estimated_tokens_after: Option<u64>,
}

/// The answer to one command.
///
/// `id` is optional because omp allows a command to be sent without one, in
/// which case the response carries none either and nothing can be matched to it.
///
/// **omp drops the id on failures, and pi does not.** An unknown command answers
/// `{"type":"response","command":"get_commands","success":false,"error":"Unknown
/// command: get_commands"}` with no `id` at all — verified live. The shared demux
/// settles by id, so that lands in its stray branch while the caller that
/// registered a slot waits out its full timeout instead of reading the
/// sentence. [`super::rpc`] is where that is handled; this stays `Option` so the
/// line itself costs nothing.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseLine {
    #[serde(default)]
    pub id: Option<String>,
    pub command: String,
    pub success: bool,
    #[serde(default)]
    pub data: Value,
    /// The sentence, on failure. Names exactly what was wrong — `Model not
    /// found: nope/nope` — which is why `models.rs` leaves omp's model ids
    /// unvalidated and lets this report them.
    #[serde(default)]
    pub error: Option<String>,
}

/// A message, by whose turn it is.
///
/// `toolResult` is a second copy of what `tool_execution_end` already said and
/// is dropped, the same way Claude Code's replayed user lines are.
#[derive(Debug, Deserialize)]
#[serde(tag = "role", rename_all = "camelCase")]
pub enum OmpMessage {
    User {
        #[serde(default)]
        content: Vec<ContentBlock>,
    },
    #[serde(rename_all = "camelCase")]
    Assistant {
        #[serde(default)]
        content: Vec<ContentBlock>,
        /// `toolUse` on a call, `stop` on a plain answer, `error` on a failure
        /// — **including an abort**, which is omp's behaviour and pi's alike.
        #[serde(default)]
        stop_reason: Option<String>,
        /// The whole sentence a failed turn should draw. This is the only place
        /// the cure is named: omp writes this onto the same box Dray is failing
        /// to send from, so for a login the reader sees it here first.
        #[serde(default)]
        error_message: Option<String>,
        #[serde(default)]
        usage: Option<Usage>,
        #[serde(default)]
        model: Option<String>,
        /// Milliseconds for the call, and to its first token. omp carries both
        /// where pi carries neither, so this is the first harness here whose
        /// timing figures are real — read off `turn_end` rather than this.
        #[serde(default)]
        duration: Option<f64>,
        #[serde(default)]
        ttft: Option<f64>,
    },
    #[serde(rename_all = "camelCase")]
    ToolResult {
        tool_call_id: String,
        #[serde(default)]
        is_error: bool,
    },
    #[serde(other)]
    Unknown,
}

/// One block of a message's content.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ContentBlock {
    Text {
        #[serde(default)]
        text: String,
    },
    Thinking {
        #[serde(default)]
        thinking: String,
        /// omp's own marker for a provider's reasoning channel — DeepSeek's
        /// `reasoning_content`. Carried by the wire and ignored here: the text
        /// is what draws.
        #[serde(default)]
        thinking_signature: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    ToolCall {
        id: String,
        name: String,
        #[serde(default)]
        arguments: Value,
    },
    #[serde(other)]
    Unknown,
}

/// A streaming frame from the assistant message being written.
///
/// Keyed by `contentIndex` within one message, which with the message itself
/// unidentified is the whole of omp's correlation — so `BlockRef.message_id`
/// has to be minted by the mapper rather than read off the wire.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum AssistantEvent {
    TextStart {
        content_index: u32,
    },
    TextDelta {
        content_index: u32,
        delta: String,
    },
    TextEnd {
        content_index: u32,
        #[serde(default)]
        content: String,
    },

    ThinkingStart {
        content_index: u32,
    },
    ThinkingDelta {
        content_index: u32,
        delta: String,
    },
    ThinkingEnd {
        content_index: u32,
        #[serde(default)]
        content: String,
    },

    /// Names the tool before any argument has arrived, which is what lets the
    /// header of a tool row be drawn from the stream while its body waits for
    /// the committed block.
    ///
    /// **The identity is nested here, unlike pi's.** pi puts `id` and `toolName`
    /// on this frame; omp sends `contentIndex` and the whole partial message in
    /// `partial`, with the model's block inside it. So [`Self::tool_call`] reads
    /// it back out, and that is the one place this parser reaches into a nested
    /// shape to answer a question pi answers flat.
    ///
    /// It is worth reaching: the field is emitted on the *first* frame of the
    /// call, before any argument has streamed, which is the whole of what makes
    /// a tool row's header draw from the stream.
    ToolcallStart {
        content_index: u32,
        #[serde(default)]
        partial: Option<Value>,
    },
    /// A fragment of the argument JSON.
    ///
    /// Unlike pi's — which the capture showed firing **once** with the whole
    /// object — omp streams this properly, one fragment at a time with
    /// `partialArgs` growing beside it. So the streaming-preview split is worth
    /// wiring here rather than a formality, and `delta` is the frame's own
    /// fragment rather than something reconstructed from `partial`.
    ToolcallDelta {
        content_index: u32,
        #[serde(default)]
        delta: String,
    },
    ToolcallEnd {
        content_index: u32,
        #[serde(default)]
        tool_call: Option<ToolCallBlock>,
    },

    #[serde(other)]
    Unknown,
}

impl AssistantEvent {
    /// Which block within the message this frame belongs to.
    pub fn content_index(&self) -> Option<u32> {
        match self {
            AssistantEvent::TextStart { content_index }
            | AssistantEvent::TextDelta { content_index, .. }
            | AssistantEvent::TextEnd { content_index, .. }
            | AssistantEvent::ThinkingStart { content_index }
            | AssistantEvent::ThinkingDelta { content_index, .. }
            | AssistantEvent::ThinkingEnd { content_index, .. }
            | AssistantEvent::ToolcallStart { content_index, .. }
            | AssistantEvent::ToolcallDelta { content_index, .. }
            | AssistantEvent::ToolcallEnd { content_index, .. } => Some(*content_index),
            AssistantEvent::Unknown => None,
        }
    }

    /// The tool a `toolcall_start` announces, read out of the nested partial
    /// message.
    ///
    /// `partial` is `{role, content: [...]}` — the assistant message as it
    /// stands — so the block is the one at `contentIndex`. A `toolCall` block
    /// carries `id` and `name` from the first frame, with `arguments` still
    /// empty and `partialArgs` holding the JSON that is arriving.
    ///
    /// `None` where the shape is not what we expect, which is the honest answer
    /// rather than a guess: the caller drops the frame, and the committed
    /// message draws the row regardless. Nothing is lost but the preview.
    pub fn tool_call(&self) -> Option<ToolCallBlock> {
        let AssistantEvent::ToolcallStart {
            content_index,
            partial: Some(partial),
        } = self
        else {
            return None;
        };

        let block = partial
            .get("content")?
            .as_array()?
            .get(*content_index as usize)?;

        serde_json::from_value(block.clone()).ok()
    }
}

/// One event from inside a subagent, forwarded on the run's `id`.
///
/// Shaped like the main thread's events — omp forwards its own lines, not a
/// second vocabulary — so the message and tool shapes are reused rather than
/// re-modelled. Only the drawn ones are read: `message_end` for the
/// subagent's words, `tool_execution_start`/`end` for its tool calls. Its own
/// `agent_start`, streaming updates and retries are forwarded too and dropped
/// by the mapper, which is why this is an enum with a catch-all rather than a
/// struct of the two it reads.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum InnerEvent {
    MessageEnd { message: OmpMessage },
    ToolExecutionStart {
        tool_call_id: String,
        tool_name: String,
        #[serde(default)]
        args: Value,
    },
    ToolExecutionEnd {
        tool_call_id: String,
        #[serde(default)]
        tool_name: Option<String>,
        #[serde(default)]
        result: Value,
        #[serde(default)]
        is_error: bool,
    },
    /// The run's own closing line, forwarding its whole inner conversation.
    /// The last assistant text beside the tool calls is the report — what the
    /// completion's `summary` draws.
    AgentEnd {
        #[serde(default)]
        messages: Vec<InnerMessage>,
    },
    #[serde(other)]
    Unknown,
}

/// One message of a finished run's forwarded conversation. Shaped like the
/// main thread's, but without the usage and timing the mapper never reads —
/// kept separate so a field omp adds there cannot fail this line.
///
/// `content` is usually blocks, but omp also forwards bare strings — a
/// supervisor note like "process sleep45 exited" arrives as one. A struct
/// insisting on an array fails the whole `agent_end` line, which costs the
/// run's summary; a string reads as one text block.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InnerMessage {
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default, deserialize_with = "blocks_or_string")]
    pub content: Vec<ContentBlock>,
}

fn blocks_or_string<'de, D>(de: D) -> Result<Vec<ContentBlock>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize as _;
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum BlocksOrString {
        Blocks(Vec<ContentBlock>),
        Text(String),
    }
    match BlocksOrString::deserialize(de)? {
        BlocksOrString::Blocks(blocks) => Ok(blocks),
        BlocksOrString::Text(text) => Ok(vec![ContentBlock::Text { text }]),
    }
}

/// omp wraps the run's own frames in `payload`: lifecycle, heartbeat, and one
/// forwarded event each. Flat on the run's `id`, so every frame correlates the
/// same way — the mapper reads `parentToolCallId` off the first two and the
/// registry off the third.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentLifecyclePayload {
    pub id: String,
    #[serde(default)]
    pub parent_tool_call_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    /// Which subagent ran — omp's agent name (`task`), not the run's title.
    /// Carried, not drawn: the row is titled from the spawn's brief.
    #[serde(default)]
    pub agent: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentProgressPayload {
    #[serde(default)]
    pub parent_tool_call_id: Option<String>,
    #[serde(default)]
    pub progress: Option<SubagentProgressDetail>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentEventPayload {
    pub id: String,
    pub event: InnerEvent,
}

/// The live half of a `subagent_progress` line: what the run is doing now, the
/// last tool it ran, and its own counts. `task`/`assignment` beside it are the
/// spawn's brief repeated, so they are not read here — the panel titles from
/// the spawn already on screen.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentProgressDetail {
    #[serde(default)]
    pub id: Option<String>,
    /// The run's own lifecycle word — `running` while it works, `completed`
    /// when it lands. Read beside the lifecycle frames, since a lost `completed`
    /// there leaves the run shimmering forever.
    #[serde(default)]
    pub status: Option<String>,
    /// The status line the panel draws — omp rewrites it per event.
    #[serde(default)]
    pub last_intent: Option<String>,
    /// Newest last, so the panel's tool is the final entry's.
    #[serde(default)]
    pub recent_tools: Vec<RecentTool>,
    #[serde(default)]
    pub tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentTool {
    #[serde(default)]
    pub tool: Option<String>,
}

 #[derive(Debug, Deserialize)]
 #[serde(rename_all = "camelCase")]
 pub struct ToolCallBlock {
     pub id: String,
     pub name: String,
     #[serde(default)]
     pub arguments: Value,
 }

/// Token counts on a committed message.
///
/// Read from the committed message and from `turn_end`, never from the
/// streaming frames beside them — those carry the same numbers dozens of times
/// per turn and are dropped by the read loop anyway.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    #[serde(default)]
    pub input: u64,
    #[serde(default)]
    pub output: u64,
    #[serde(default)]
    pub cache_read: u64,
    #[serde(default)]
    pub cache_write: u64,
    #[serde(default)]
    pub reasoning: u64,
    #[serde(default)]
    pub total_tokens: u64,
    /// What the call cost, in the provider's own units. omp is the first
    /// harness here to report one; nothing draws it yet.
    #[serde(default)]
    pub cost: Option<Value>,
}

/// One line of omp's stdout, or `Err` with the line for the failure log.
pub fn parse_line(line: &str) -> Result<OmpEvent, serde_json::Error> {
    serde_json::from_str(line)
}

/// What a line this build could not use called itself, for the failure log.
///
/// `#[serde(other)]` needs a unit variant, so [`OmpEvent::Unknown`] cannot carry
/// the type it swallowed and every gap would be filed under one word — which
/// makes the triage command in `CLAUDE.md` (`jq … | sort | uniq -c`) count them
/// all as one thing. The raw line is recorded beside it; this is the part that
/// has to be readable without opening the file.
///
/// The `id` half is the more urgent of the two. Every line omp sends that
/// *expects an answer* carries one, and an unanswered request blocks the turn —
/// so an unknown line with an id is not a missing row, it is a session about to
/// hang.
pub fn describe_line(line: &str) -> String {
    #[derive(Deserialize)]
    struct Head {
        #[serde(default)]
        r#type: Option<String>,
        #[serde(default)]
        id: Option<String>,
    }

    let Ok(head) = serde_json::from_str::<Head>(line) else {
        return "unmodelled line, and not an object".to_string();
    };

    let named = head.r#type.unwrap_or_else(|| "no type field".to_string());

    match head.id {
        Some(_) => format!("unmodelled request `{named}` — the turn may be blocked behind it"),
        None => format!("unmodelled type `{named}`"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(fixture: &str) -> Vec<String> {
        fixture
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(str::to_string)
            .collect()
    }
    const TURN: &str = include_str!("fixtures/turn.jsonl");
    const TOOL: &str = include_str!("fixtures/tool_approval.jsonl");
    const ABORT: &str = include_str!("fixtures/steer_abort.jsonl");
    const HANDSHAKE: &str = include_str!("fixtures/handshake.jsonl");
    const SUBAGENT: &str = include_str!("fixtures/subagent.jsonl");

    const EVERY_FIXTURE: &[(&str, &str)] = &[
        ("turn", TURN),
        ("tool_approval", TOOL),
        ("steer_abort", ABORT),
        ("handshake", HANDSHAKE),
        ("subagent", SUBAGENT),
    ];

    /// Every line of every capture parses, and none of them lands in `Unknown`.
    ///
    /// `Unknown` is the coverage gap, so this is the assertion that says the
    /// parser covers the wire it was written against rather than shrugging at
    /// it.
    #[test]
    fn every_captured_line_is_modelled() {
        for (name, fixture) in EVERY_FIXTURE {
            for line in lines(fixture) {
                let event = parse_line(&line)
                    .unwrap_or_else(|e| panic!("{name} did not parse: {e}\n  {line}"));

                assert!(
                    !matches!(event, OmpEvent::Unknown),
                    "{name} carries a line this parser does not model:\n  {line}"
                );
            }
        }
    }

    /// The handshake omp writes before anything else. pi sends nothing at all,
    /// so a reader ported from it without this waits for a frame that never
    /// comes — or, worse, treats the caps as a command answer.
    #[test]
    fn the_spawn_writes_a_ready_frame() {
        let ready = lines(HANDSHAKE)
            .iter()
            .find_map(|l| match parse_line(l) {
                Ok(OmpEvent::Ready {
                    protocol_version,
                    supported_protocol_versions,
                    max_frame_bytes,
                    ..
                }) => Some((protocol_version, supported_protocol_versions, max_frame_bytes)),
                _ => None,
            })
            .expect("the capture opens with a ready frame");

        assert_eq!(ready.0, Some(1), "v1 is what this build speaks");
        assert_eq!(ready.1, Some(vec![1, 2]));
        assert_eq!(ready.2, Some(1_048_576), "the v1 physical frame cap");
    }

    /// The one line that closes a turn, and it is not the one pi uses.
    ///
    /// omp has no `agent_settled`. Reading a turn off `turn_start`/`turn_end`
    /// would close it at the first model call of every tool-using run and reopen
    /// it — which draws as the session finishing and restarting itself. This is
    /// pinned rather than described because it is the documented way to strand a
    /// session `in_progress` forever.
    #[test]
    fn the_turn_closes_on_a_terminal_agent_end() {
        let endings: Vec<Option<bool>> = lines(TOOL)
            .iter()
            .filter_map(|l| match parse_line(l) {
                Ok(OmpEvent::AgentEnd { is_terminal, .. }) => Some(is_terminal),
                _ => None,
            })
            .collect();

        assert_eq!(endings, vec![Some(true)], "one prompt, one run");

        // The same capture's inner lifecycle: two model calls in one turn, one
        // of them the bash call the approval was raised for.
        let turns = lines(TOOL)
            .iter()
            .filter(|l| l.contains(r#""type":"turn_start""#))
            .count();
        assert_eq!(turns, 2, "one prompt, two model calls");
    }

    /// An absent `isTerminal` reads as terminal, which the doc states outright
    /// and which the mapper depends on. A mapper testing `== Some(true)` closes
    /// no turn at all on a runtime that omits it.
    #[test]
    fn an_absent_is_terminal_still_reads_as_terminal() {
        let Ok(OmpEvent::AgentEnd {
            is_terminal,
            messages,
        }) = parse_line(r#"{"type":"agent_end"}"#)
        else {
            panic!("a bare agent_end has to parse");
        };

        assert_eq!(is_terminal, None);
        assert!(messages.is_none());
    }

    /// `toolcall_start` names the tool inside `partial` rather than on the
    /// frame, and the preview's header is what breaks if that is read flat.
    #[test]
    fn a_toolcall_start_names_its_tool_out_of_the_partial_message() {
        let named = lines(TOOL)
            .iter()
            .filter_map(|l| match parse_line(l) {
                Ok(OmpEvent::MessageUpdate {
                    assistant_message_event,
                }) => assistant_message_event.tool_call(),
                _ => None,
            })
            .next()
            .expect("the capture calls a tool");

        assert_eq!(named.name, "bash");
        assert!(!named.id.is_empty());
    }

    /// And a frame with nothing to read answers `None` rather than a guess: the
    /// caller drops it, and the committed message draws the row regardless.
    #[test]
    fn a_toolcall_start_with_no_partial_answers_nothing() {
        let Ok(OmpEvent::MessageUpdate {
            assistant_message_event,
        }) = parse_line(r#"{"type":"message_update","assistantMessageEvent":{"type":"toolcall_start","contentIndex":1}}"#)
        else {
            panic!("parses");
        };

        assert_eq!(assistant_message_event.content_index(), Some(1));
        assert!(assistant_message_event.tool_call().is_none());
    }

    /// The approval card is an `extension_ui_request`, the same channel pi's
    /// extensions use — so `dialog.rs` answers it without a new sub-protocol.
    #[test]
    fn the_approval_card_rides_the_extension_channel() {
        let asked = lines(TOOL)
            .iter()
            .filter_map(|l| match parse_line(l) {
                Ok(OmpEvent::ExtensionUiRequest {
                    method,
                    title,
                    options,
                    ..
                }) => Some((method, title, options.map(|o| o.len()))),
                _ => None,
            })
            .collect::<Vec<_>>();

        let select = asked
            .iter()
            .find(|(m, _, _)| m == "select")
            .expect("omp raised its own approval");
        assert_eq!(select.2, Some(2), "Approve and Deny");
        assert!(
            select
                .1
                .as_deref()
                .is_some_and(|t| t.contains("Allow tool")),
            "the card names what it is asking: {:?}",
            select.1
        );

        // And an announcement rides the same channel, which is why the read
        // loop has to classify by list rather than by the frame's presence.
        assert!(asked.iter().any(|(m, _, _)| m == "setWidget"));
    }

    /// A response carries the id it answers — the half that stays true — while
    /// a *failure* drops it, which is omp's own behaviour and the reason the
    /// client cannot rely on the id alone.
    #[test]
    fn an_answer_echoes_its_id_and_a_refusal_does_not() {
        for line in lines(HANDSHAKE) {
            let Ok(OmpEvent::Response(r)) = parse_line(&line) else {
                continue;
            };
            if r.success {
                assert!(r.id.is_some(), "a success answers the id it was sent");
            }
        }

        let refusal = parse_line(
            r#"{"type":"response","command":"get_commands","success":false,
                "error":"Unknown command: get_commands"}"#,
        )
        .unwrap();
        assert!(
            matches!(refusal, OmpEvent::Response(_)),
            "a refusal is still a response line, just one the demux cannot route"
        );
    }

    /// omp forwards supervisor notes as bare strings inside the run's own
    /// `agent_end` — a struct insisting on blocks failed the whole line and
    /// cost the run's summary. Pinned, because the failure is silent: the line
    /// lands in the failure log and the panel shows no summary.
    #[test]
    fn a_bare_string_message_content_reads_as_one_text_block() {
        let event = parse_line(
            r#"{"type":"subagent_event","payload":{"id":"R1","event":{"type":"agent_end","messages":[{"role":"assistant","content":"Supervised process sleep45 exited with exit code 0."}]}}}"#,
        )
        .expect("a string content parses");

        let OmpEvent::SubagentEvent { payload } = event else {
            panic!("expected a subagent event");
        };
        let InnerEvent::AgentEnd { messages } = payload.event else {
            panic!("expected the run's closing line");
        };
        assert_eq!(messages.len(), 1);
        assert!(matches!(
            messages[0].content[0],
            ContentBlock::Text { .. }
        ));
    }

    /// A gap names itself in the log, and says when it is the urgent kind.
    #[test]
    fn an_unmodelled_line_names_itself_and_says_if_it_blocks() {
        let plain = describe_line(r#"{"type":"weather_changed","sunny":true}"#);
        assert!(plain.contains("weather_changed"), "{plain}");
        assert!(!plain.contains("blocked"), "nothing is waiting on it: {plain}");

        let request = describe_line(r#"{"type":"consent_request","id":"abc"}"#);
        assert!(request.contains("consent_request"), "{request}");
        assert!(request.contains("blocked"), "{request}");

        assert!(!describe_line("{}").is_empty());
        assert!(!describe_line("not json at all").is_empty());
    }

    /// A line omp grows later must cost one line, never the connection.
    #[test]
    fn an_unmodelled_line_reads_as_unknown_rather_than_failing() {
        let event = parse_line(r#"{"type":"something_omp_ships_later","data":{"a":1}}"#).unwrap();

        assert!(matches!(event, OmpEvent::Unknown));
    }

    /// And an unmodelled *frame* costs one frame, not the message around it.
    #[test]
    fn an_unmodelled_frame_reads_as_unknown() {
        let event =
            parse_line(r#"{"type":"message_update","assistantMessageEvent":{"type":"nope"}}"#)
                .unwrap();

        match event {
            OmpEvent::MessageUpdate {
                assistant_message_event,
            } => {
                assert!(matches!(assistant_message_event, AssistantEvent::Unknown));
                assert_eq!(assistant_message_event.content_index(), None);
            }
            other => panic!("expected a message_update, got {other:?}"),
        }
    }

    /// A local-only slash command emits no `agent_end` at all, so the turn
    /// would never close — this is the frame that says so.
    #[test]
    fn a_local_only_prompt_says_it_invoked_no_agent() {
        let Ok(OmpEvent::PromptResult {
            id,
            agent_invoked,
        }) = parse_line(r#"{"type":"prompt_result","id":"p1","agentInvoked":false}"#)
        else {
            panic!("parses");
        };

        assert_eq!(id.as_deref(), Some("p1"));
        assert_eq!(agent_invoked, Some(false));
    }
}
