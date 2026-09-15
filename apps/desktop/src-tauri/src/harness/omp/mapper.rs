//! omp's typed events → Dray's [`AgentEvent`] vocabulary.
//!
//! **One fact shapes everything here, and it is where the port from pi breaks.**
//! omp has no `agent_settled`. pi's turn closes on that line alone, and its
//! mapper deliberately treats `agent_end` as noise because pi may retry after
//! it. omp merged the two: `agent_end` *is* the closer, and `isTerminal` is how
//! it says whether more work is scheduled. So:
//!
//! - [`OmpEvent::AgentEnd`] closes the turn when `is_terminal != Some(false)`.
//!   The comparison is written that way rather than `== Some(true)` because the
//!   field is optional and **absent means terminal** — omp's own doc says so
//!   outright. A mapper testing for the explicit `true` closes no turn at all on
//!   a runtime that omits it, which is a session stuck `in_progress` forever
//!   with a complete transcript on screen. That is the documented way to strand
//!   a session, and it is the one thing this file must not get wrong.
//! - `turn_start`/`turn_end` are still the inner lifecycle — one *model call*
//!   each, several per turn — and still draw nothing. Mapping the turn off those
//!   ends it at the first tool call and reopens it a moment later, which draws
//!   as the session finishing and restarting itself.
//!
//! **A second closer is not an event.** A prompt that resolves locally — a
//! slash command that produces output without a model turn — answers
//! `agentInvoked: false` and emits **no `agent_end` at all**. Since Dray sends
//! every slash command as prompt text, a mapper that only knows the first rule
//! sits `in_progress` forever after `/help`. [`OmpEvent::PromptResult`] is where
//! that is caught.
//!
//! Nothing on the wire is identified: no thread id, no turn id, no message id,
//! no block id. `contentIndex` within one streaming message is the whole of
//! omp's correlation, so [`BlockRef::message_id`] has to be minted here — one id
//! per assistant message, so two messages in one turn cannot collide on index
//! `0`.
use super::parser::{AssistantEvent, ContentBlock, InnerEvent, OmpEvent, OmpMessage};
use crate::events::{
    usage::ContextWindow, AgentEvent, AgentEventPayload, BlockRef, BlockType, DeltaEvent,
    ErrorSource, SessionInfo, Subagent, ToolResult, ToolType, TurnStatus, Usage,
};
use crate::harness::Harness;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::Arc;
use uuid::Uuid;

/// What omp calls the tools it ships, folded onto Dray's vocabulary.
///
/// Unknown names read as [`ToolType::Other`] rather than being guessed at: omp
/// registers 31 built-ins and lets an extension register any name at all, and a
/// wrong `tool_type` draws the wrong row — a shell card for a file read, say —
/// where `Other` draws a plain one that is merely less specific.
///
/// The set is wider than pi's, which is the surface difference between the two
/// rather than a new rule: omp ships LSP, AST, debugger, browser and desktop
/// tools that pi has no counterpart for, and each lands on the vocabulary it
/// is nearest to rather than on `Other`.
fn tool_type(name: &str) -> ToolType {
    match name {
        "bash" | "shell" | "powershell" | "eval" => ToolType::Shell,
        "read" => ToolType::FileRead,
        "edit" | "write" | "ast_edit" | "apply_patch" => ToolType::FileEdit,
        "grep" | "glob" | "find" | "ls" | "ast_grep" => ToolType::Search,
        "web_search" | "web_fetch" | "browser" => ToolType::Web,
        // The spawn: omp names it `task`, and the run's own frames arrive on
        // the subscription this build now takes. Without this the spawn draws
        // a plain row in the transcript and the run never nests under it.
        "task" => ToolType::SubagentSpawn,
        // Everything else — `lsp`, `debug`, `todo`, `ask`, `computer`,
        // `github`, the memory tools, and every extension's own — is left as
        // `Other` on purpose. Only each tool's author knows which of Dray's
        // rows it would want, and a wrong guess draws a diff viewer over
        // something that is not a diff.
        _ => ToolType::Other,
    }
}

pub struct Mapper {
    session_id: String,
    seq: Arc<AtomicU64>,
    /// The assistant message being streamed, minted on `message_start`.
    ///
    /// omp identifies messages by nothing at all, so without this every message
    /// in a turn would stream under the same `BlockRef` and the second one's
    /// blocks would land on the first one's previews.
    message_id: Option<String>,
    /// Which `toolCallId` each open call's block belongs to, keyed by
    /// `contentIndex`.
    ///
    /// `toolcall_start` names the call; `toolcall_delta` carries only the index.
    /// Without this the argument fragments could not be attributed to the call
    /// they belong to. Recorded on the start frame rather than read off
    /// [`super::parser::AssistantEvent::tool_call`] again, which would re-parse
    /// the nested partial on every fragment.
    open_calls: std::collections::HashMap<u32, String>,
    /// Which spawning call each live run belongs under, keyed by the run's own
    /// `id`. omp correlates on `parentToolCallId` — the *spawning* call's id —
    /// on every frame, which is exactly the key the panel selects by. Without
    /// this `subagent_event`'s inner `toolCallId`s would file the run's own
    /// calls under the spawn.
    subagents: std::collections::HashMap<String, String>,
    /// The stop reason and sentence from the newest committed assistant
    /// message, held until the turn closes.
    ///
    /// omp has no error *event*: a failed turn is an assistant message carrying
    /// `stopReason: "error"` and the whole sentence in `errorMessage`, and that
    /// sentence is the only place the cure is named.
    outcome: Option<Outcome>,
    /// Token counts off the newest committed assistant message.
    ///
    /// Not from the streaming frames beside them: those carry the same numbers
    /// on every one of ~190 frames in a tool turn.
    usage: Option<Usage>,
    /// How long the last model call took, off `turn_end`.
    ///
    /// omp is the first harness wired here that reports it, so it is carried
    /// where pi's is `None`. Read from `turn_end` rather than the committed
    /// message because that is the line that closes the call, and the last one
    /// before the turn closes is the one that describes the turn.
    duration_ms: Option<u64>,
    /// The running model's context window, the ring's denominator.
    ///
    /// `0` until the handshake fills it. Shared rather than passed because the
    /// reader runs *before* the handshake it settles the answer for — nothing
    /// but a line off stdout resolves a request, so the mapper exists a moment
    /// before its window does. Shared for a second reason too: Dray respawns for
    /// a model change (`applies_model_in_place: false`) but omp *itself* moves
    /// its model when a reader runs `/model`, so [`super::omp`] re-reads this on
    /// `model_changed`.
    context_window: Arc<AtomicU64>,
    /// Whether a compaction has landed since the reading in `usage` was taken.
    ///
    /// A compaction *lowers* occupancy and publishes what it kept on
    /// `context_compacted`, so a turn closing after one must not re-attach the
    /// message total from before it — the ring is settled by the newest event
    /// carrying a figure, and a stale one there jumps it back to its
    /// pre-compaction level and keeps it there for the rest of the session.
    ///
    /// Never armed by a compaction that *aborted*: nothing left the window, so
    /// the held total still describes it — and withholding a window there leaves
    /// the reader settling on that compaction's own absent count, which blanks
    /// the gauge outright.
    compacted_since_usage: bool,
}

#[derive(Debug, Clone)]
struct Outcome {
    stop_reason: Option<String>,
    error_message: Option<String>,
}
impl Mapper {
    pub fn new(session_id: String, seq: Arc<AtomicU64>, context_window: Arc<AtomicU64>) -> Self {
        Self {
            session_id,
            seq,
            message_id: None,
            open_calls: std::collections::HashMap::new(),
            subagents: std::collections::HashMap::new(),
            outcome: None,
            usage: None,
            duration_ms: None,
            context_window,
            compacted_since_usage: false,
        }
    }

    /// The slot holding the ring's denominator, for the one caller that has to
    /// write it: a model changing under a running child leaves the window
    /// describing the model that left.
    pub fn context_window(&self) -> Arc<AtomicU64> {
        self.context_window.clone()
    }

    /// Puts the ring's pair on a turn's usage: the committed message's
    /// `totalTokens` against the model's window.
    ///
    /// `totalTokens` **is** the occupancy, not a per-turn sum — it is one model
    /// call's prompt plus its answer, so the last call of a turn describes the
    /// context that turn left behind. That is the same arithmetic pi's is, and
    /// omp inherits it.
    ///
    /// Both halves must be real. A window of `0` is an omp that never said, and
    /// a count of `0` is a turn that reached no model at all — an auth failure
    /// reports zeros where the real occupancy is the system prompt — and a ring
    /// drawn empty there claims a fresh context rather than an unknown one.
    ///
    /// Two turns carry no reading at all rather than a wrong one: one that
    /// **failed or was aborted**, whose message describes a call that did not
    /// land, and one closing **after a compaction** the message predates. In
    /// both the previous reading stands, which is the safe direction —
    /// under-reporting occupancy costs nothing where over-reporting claims a
    /// context that was thrown away.
    fn with_occupancy(&self, mut usage: Usage, status: TurnStatus) -> Usage {
        let max = self.context_window.load(Relaxed);

        if self.compacted_since_usage || !matches!(status, TurnStatus::Success) {
            return usage;
        }

        if let Some(used) = usage.total_tokens.filter(|used| *used > 0 && max > 0) {
            usage.context_window = Some(ContextWindow {
                used_tokens: used,
                max_tokens: max,
            });
        }

        usage
    }

    /// The turn closing, from whatever closed it.
    ///
    /// Shared by the two closers — a terminal `agent_end` and a local-only
    /// `prompt_result` — so the verdict, the usage and the duration are read the
    /// same way whichever arrives. Two copies would drift on exactly the field
    /// nobody is watching.
    fn closing(&mut self) -> Vec<AgentEvent> {
        let outcome = self.outcome.take();
        let duration_ms = self.duration_ms.take();

        let (status, stop_reason, final_text) = match outcome {
            Some(o) if o.stop_reason.as_deref() == Some("error") => {
                (TurnStatus::Error, o.stop_reason, o.error_message)
            }
            other => (TurnStatus::Success, other.and_then(|o| o.stop_reason), None),
        };

        // Read after the verdict, since a failed turn's counts describe a model
        // call that did not land.
        let usage = self.usage.take().map(|u| self.with_occupancy(u, status));

        vec![self.event(AgentEventPayload::TurnCompleted {
            status,
            stop_reason,
            auth_failed: matches!(status, TurnStatus::Error)
                && final_text.as_deref().is_some_and(is_auth_failure),
            final_text,
            usage,
            duration_ms,
            // The session layer freezes this: only it knows the cwd to snapshot.
            head: None,
        })]
    }

    pub fn map(&mut self, event: OmpEvent) -> Vec<AgentEvent> {
        match event {
            OmpEvent::AgentStart => {
                // A fresh run, so last run's verdict must not survive into it — a
                // turn that fails and is prompted again would otherwise report
                // the old failure a second time.
                self.outcome = None;
                self.usage = None;
                self.duration_ms = None;
                vec![self.event(AgentEventPayload::TurnStarted(SessionInfo::default()))]
            }

            // The turn closer, and the one line that must not be read the way pi
            // reads it. `is_terminal != Some(false)` is the test: absent means
            // terminal, so only an explicit `false` — maintenance or async
            // delivery having scheduled more work — leaves the turn open.
            OmpEvent::AgentEnd { is_terminal, .. } => {
                if is_terminal == Some(false) {
                    Vec::new()
                } else {
                    self.closing()
                }
            }

            // A prompt that resolved without a model turn: a slash command that
            // produced output and nothing else. It is the *only* signal its turn
            // is over — no `agent_end` follows one — so dropping it leaves the
            // session `in_progress` forever with the command's own output on
            // screen and nothing saying the turn ended.
            //
            // Gated on `agent_invoked: false`, and gated at all because the same
            // frame is also emitted for a prompt that *did* run an agent, where
            // `agent_end` closes the turn and this would close it early.
            OmpEvent::PromptResult {
                agent_invoked: Some(false),
                ..
            } => self.closing(),

            // One model call inside the run. Dray's transcript groups by user
            // message, so these draw nothing — the turn they sit inside is the
            // one the reader sees. `turn_end` is also where the call's duration
            // comes from, which is why it is not a plain catch-all: the *last*
            // call before the turn closes is the one that describes it, so a
            // call reporting none clears what an earlier one set rather than
            // leaving it to be attributed to the wrong stretch.
            OmpEvent::TurnStart => Vec::new(),
            OmpEvent::TurnEnd { message } => {
                self.duration_ms = message.as_ref().and_then(OmpMessage::duration_ms);
                Vec::new()
            }

            OmpEvent::MessageStart { message } => match message {
                // Minted per message so two in one turn cannot collide on
                // `contentIndex` 0.
                OmpMessage::Assistant { .. } => {
                    self.message_id = Some(Uuid::now_v7().to_string());
                    self.open_calls.clear();
                    Vec::new()
                }
                // The prompt Dray itself sent, echoed back, and the tool result
                // `tool_execution_end` already reported. Both are second copies
                // of what the app already knows.
                _ => Vec::new(),
            },

            OmpEvent::MessageEnd { message } => self.committed(message),

            OmpEvent::MessageUpdate {
                assistant_message_event,
            } => self.streamed(assistant_message_event),

            OmpEvent::ToolExecutionStart {
                tool_call_id,
                tool_name,
                args,
                ..
            } => vec![self.event(AgentEventPayload::ToolCallStarted {
                call_id: tool_call_id,
                tool_type: tool_type(&tool_name),
                name: tool_name,
                input: if args.is_object() {
                    args
                } else {
                    Value::Object(Default::default())
                },
                raw_input: None,
                title: None,
            })],

            OmpEvent::ToolExecutionEnd {
                tool_call_id,
                result,
                is_error,
                ..
            } => vec![self.event(AgentEventPayload::ToolCallCompleted {
                call_id: tool_call_id,
                result: ToolResult {
                    text: flatten_content(&result),
                    is_error,
                    structured: Some(result),
                    exit_code: None,
                    duration_ms: None,
                    images: Vec::new(),
                },
            })],
            // A subagent opened or closed. The spawn is its parent call's id —
            // the key the panel selects by — so this registers the run under it
            // and announces the lifecycle beside it.
            OmpEvent::SubagentLifecycle { payload } => {
                let Some(spawn) = payload.parent_tool_call_id.clone() else {
                    return Vec::new();
                };
                self.subagents.insert(payload.id.clone(), spawn.clone());
                let done = matches!(
                    payload.status.as_deref(),
                    Some("completed") | Some("failed")
                );
                let id = payload.id.clone();
                let inner = if done {
                    // The run is over, so it leaves the registry — a later run
                    // spawned by the same call must not inherit this one's id.
                    self.subagents.remove(&id);
                    AgentEventPayload::SubagentCompleted {
                        agent_id: id,
                        status: payload.status.clone().unwrap_or_default(),
                        // omp's lifecycle carries no text of its own; the final
                        // report arrives as the run's own inner events, and the
                        // panel draws those beside this. Filled below, not here.
                        summary: None,
                        // The run's own counts arrive on `progress`, beside this.
                        usage: None,
                    }
                } else {
                    AgentEventPayload::SubagentStarted {
                        agent_id: id.clone(),
                        // The row is titled from the spawn's brief below; the
                        // agent name (`task`) is the honest fallback where no
                        // envelope label exists yet.
                        label: payload.agent.clone().unwrap_or(id),
                        // omp's lifecycle carries no brief either — the spawn's
                        // own arguments are the prompt this run was given, and
                        // the panel draws those from the spawn already.
                        description: None,
                        prompt: None,
                    }
                };
                vec![self.subagent_event(spawn, inner)]
            }

            // A subagent's heartbeat: its live status line and last tool. Filed
            // under the spawn, beside the run's own events. A `completed` here
            // closes the run too — the lifecycle frame beside it says the same,
            // but a lost one leaves the run shimmering forever, and this line
            // arrives on every heartbeat so it cannot be lost the same way.
            OmpEvent::SubagentProgress { payload } => {
                let (Some(spawn), Some(detail)) =
                    (payload.parent_tool_call_id, payload.progress)
                else {
                    return Vec::new();
                };
                let last_tool = detail.recent_tools.last().and_then(|t| t.tool.clone());
                let usage = detail.tokens.map(|total_tokens| Usage {
                    total_tokens: Some(total_tokens),
                    ..Usage::default()
                });
                // omp's own token count for the run. The panel's gauge, not the
                // session ring's — that one still reads the main thread's
                // committed messages.
                let mut out = vec![self.subagent_event(
                    spawn.clone(),
                    AgentEventPayload::SubagentProgress {
                        agent_id: detail.id.clone().unwrap_or_default(),
                        description: detail.last_intent,
                        last_tool,
                        usage,
                    },
                )];
                if matches!(detail.status.as_deref(), Some("completed") | Some("failed")) {
                    out.push(self.subagent_event(
                        spawn,
                        AgentEventPayload::SubagentCompleted {
                            agent_id: detail.id.unwrap_or_default(),
                            status: detail.status.unwrap_or_default(),
                            summary: None,
                            usage: None,
                        },
                    ));
                }
                out
            }

            // One of the run's own events. Only the drawn ones are read: its
            // words and its tool calls. Filed under the spawn, so the panel
            // nests them under the spawning row.
            OmpEvent::SubagentEvent { payload } => {
                let Some(spawn) = self.subagents.get(&payload.id).cloned() else {
                    return Vec::new();
                };
                match payload.event {
                    InnerEvent::MessageEnd { message } => self.subagent_message(spawn, message),
                    InnerEvent::ToolExecutionStart {
                        tool_call_id,
                        tool_name,
                        args,
                    } => vec![self.subagent_event(
                        spawn,
                        AgentEventPayload::ToolCallStarted {
                            call_id: tool_call_id,
                            tool_type: tool_type(&tool_name),
                            name: tool_name,
                            input: if args.is_object() {
                                args
                            } else {
                                Value::Object(Default::default())
                            },
                            raw_input: None,
                            title: None,
                        },
                    )],
                    InnerEvent::ToolExecutionEnd {
                        tool_call_id,
                        result,
                        is_error,
                        ..
                    } => vec![self.subagent_event(
                        spawn,
                        AgentEventPayload::ToolCallCompleted {
                            call_id: tool_call_id,
                            result: ToolResult {
                                text: flatten_content(&result),
                                is_error,
                                structured: Some(result),
                                exit_code: None,
                                duration_ms: None,
                                images: Vec::new(),
                            },
                        },
                    )],
                    // The run's own closing line. omp forwards the whole inner
                    // conversation on it, so the last assistant text beside the
                    // tool calls is the report — what `summary` draws. Read off
                    // the messages rather than the lifecycle, which carries none.
                    // A run that only ran tools leaves no assistant text — this
                    // one's whole report is `PONG` inside a tool result — so the
                    // last tool result's text is the fallback, never a guess.
                    InnerEvent::AgentEnd { messages } => {
                        let summary = last_assistant_text(&messages)
                            .or_else(|| last_tool_result_text(&messages));
                        match summary.filter(|s| !s.trim().is_empty()) {
                            Some(text) => vec![self.subagent_event(
                                spawn,
                                AgentEventPayload::SubagentCompleted {
                                    agent_id: payload.id.clone(),
                                    status: "completed".to_string(),
                                    summary: Some(text),
                                    usage: None,
                                },
                            )],
                            None => Vec::new(),
                        }
                    }
                    InnerEvent::Unknown => Vec::new(),
                }
            }

            // A failed model request being tried again. It drives the retry
            // indicator, which takes the working one's place — the turn is
            // genuinely open and drawing nothing, so every working test passes,
            // but the agent is not thinking, it is waiting on a retry.
            OmpEvent::AutoRetryStart {
                attempt,
                max_attempts,
                error_message,
            } => vec![self.event(AgentEventPayload::ApiRetry {
                // Defaulted rather than dropped: the indicator's whole message is
                // "attempt N of M", so a retry that arrives without them still
                // has to draw something, and `1` is the honest floor for a count
                // nobody sent.
                attempt: attempt.unwrap_or(1),
                max_retries: max_attempts.unwrap_or(1),
                // omp reports no HTTP status, and a cause it could not name is
                // one absence rather than two spellings of it.
                status: None,
                reason: error_message.filter(|m| !m.trim().is_empty()),
            })],

            OmpEvent::AutoCompactionStart => {
                vec![self.event(AgentEventPayload::ContextCompactionStarted)]
            }

            // Closes the indicator its start opened, always — an aborted
            // compaction and one whose shape this build cannot read both end
            // here, and either left unmapped spins the indicator forever.
            OmpEvent::AutoCompactionEnd {
                reason,
                result,
                aborted,
            } => {
                // Dropped where the compaction did not finish: the numbers
                // describe a context that was kept, and reporting a saving for
                // one that was thrown away is worse than reporting none.
                let saved = result.filter(|_| !aborted);

                // Whatever the mapper is holding describes the context a
                // compaction that *landed* has just replaced, so it must not
                // close the turn as an occupancy reading — see the field's own
                // comment for why an aborted one must not arm this.
                self.compacted_since_usage = saved.is_some();

                vec![self.event(AgentEventPayload::ContextCompacted {
                    trigger: reason,
                    pre_tokens: saved.as_ref().and_then(|r| r.tokens_before),
                    post_tokens: saved.as_ref().and_then(|r| r.estimated_tokens_after),
                    // omp times no compaction. Absent rather than zero, which the
                    // UI would draw as one that took no time at all.
                    duration_ms: None,
                })]
            }

            // An extension threw, and omp carried on. Drawn where the rest of
            // that group is not, because nothing else on screen will say so — a
            // permission extension that throws simply stops gating, which looks
            // exactly like it working. `fatal: false` is the literal truth: the
            // session is still running, and this is the reader's own tooling to
            // fix.
            OmpEvent::ExtensionError {
                extension_path,
                error,
            } => {
                let said = error.unwrap_or_else(|| "the extension failed".to_string());
                let message = match extension_path {
                    Some(path) => format!("{path}: {said}"),
                    None => said,
                };

                vec![self.event(AgentEventPayload::Error {
                    source: ErrorSource::Harness,
                    message,
                    fatal: false,
                })]
            }

            // Everything else is modelled and drawn as nothing: the `ready`
            // frame, a response (which never reaches here anyway — the client
            // settles those), the pushed command list, a setting omp confirms
            // moved, a partial tool result, or a line this build has never seen.
            // None draws a row, and the read loop files the unknown ones.
            _ => Vec::new(),
        }
    }

    /// A committed message. This wins over whatever the deltas accumulated, the
    /// same bargain Claude Code's `assistant` event makes.
    fn committed(&mut self, message: OmpMessage) -> Vec<AgentEvent> {
        let OmpMessage::Assistant {
            content,
            stop_reason,
            error_message,
            usage,
            ..
        } = message
        else {
            // A user or toolResult echo. Dropped: the app sent one and already
            // reported the other.
            return Vec::new();
        };

        // Held rather than emitted: the turn is not over — omp may make several
        // model calls, and only the last one's verdict is the turn's.
        self.outcome = Some(Outcome {
            stop_reason,
            error_message,
        });
        if let Some(u) = usage {
            // This reading is newer than any compaction before it, so the
            // suppression that one armed is spent.
            self.compacted_since_usage = false;
            self.usage = Some(Usage {
                input_tokens: Some(u.input),
                output_tokens: Some(u.output),
                cached_input_tokens: Some(u.cache_read),
                cache_write_tokens: Some(u.cache_write),
                reasoning_tokens: Some(u.reasoning),
                total_tokens: Some(u.total_tokens),
                ..Usage::default()
            });
        }

        let message_id = self.message_id.clone();
        let mut out = Vec::new();

        for (index, block) in content.into_iter().enumerate() {
            let block_ref = message_id.as_ref().map(|id| BlockRef {
                message_id: id.clone(),
                index: index as u32,
            });

            match block {
                ContentBlock::Text { text } => {
                    out.push(self.event(AgentEventPayload::AssistantText {
                        block: block_ref,
                        text,
                    }));
                }
                ContentBlock::Thinking { thinking, .. } => {
                    out.push(self.event(AgentEventPayload::Reasoning {
                        block: block_ref,
                        text: thinking,
                        encrypted: false,
                    }));
                }
                // The model *asking* for a tool. The call itself is
                // `tool_execution_start`, which is what draws the row — emitting
                // one here too would draw every call twice.
                ContentBlock::ToolCall { .. } | ContentBlock::Unknown => {}
            }
        }

        out
    }

    /// One streaming frame. A preview, superseded by the committed message.
    fn streamed(&mut self, frame: AssistantEvent) -> Vec<AgentEvent> {
        // A frame before any `message_start` has nothing to hang off. Dropping
        // it beats minting a `BlockRef` the committed message will never match,
        // which would leave a preview on screen that nothing retires.
        let Some(message_id) = self.message_id.clone() else {
            return Vec::new();
        };

        let Some(index) = frame.content_index() else {
            return Vec::new();
        };
        let block = BlockRef { message_id, index };

        let delta = match &frame {
            AssistantEvent::TextStart { .. } => DeltaEvent::BlockStart {
                block,
                block_type: BlockType::Text,
            },
            AssistantEvent::ThinkingStart { .. } => DeltaEvent::BlockStart {
                block,
                block_type: BlockType::Thinking,
            },
            AssistantEvent::ToolcallStart { .. } => {
                // omp names the tool inside the frame's nested partial rather
                // than on it, so the identity is read out here. A frame whose
                // partial cannot be read still opens the block — the committed
                // message carries the name, and the row draws either way — it
                // just cannot draw its header from the stream.
                let call = frame.tool_call();
                let (id, name) = match call {
                    Some(call) => (call.id, call.name),
                    None => (String::new(), String::new()),
                };
                self.open_calls.insert(index, id.clone());

                DeltaEvent::BlockStart {
                    block,
                    block_type: BlockType::ToolUse { id, name },
                }
            }

            AssistantEvent::TextDelta { delta, .. }
            | AssistantEvent::ThinkingDelta { delta, .. } => DeltaEvent::TextDelta {
                block,
                text: delta.clone(),
            },
            AssistantEvent::ToolcallDelta { delta, .. } => DeltaEvent::InputDelta {
                block,
                partial_json: delta.clone(),
            },

            AssistantEvent::TextEnd { .. }
            | AssistantEvent::ThinkingEnd { .. }
            | AssistantEvent::ToolcallEnd { .. } => DeltaEvent::BlockStop { block },

            AssistantEvent::Unknown => return Vec::new(),
        };

        vec![self.event(AgentEventPayload::Delta(delta))]
    }

    /// Builds an event outside the wire, for the session layer's own
    /// synthesized ones.
    pub fn synthesize(&self, payload: AgentEventPayload) -> AgentEvent {
        self.event(payload)
    }

    fn event(&self, payload: AgentEventPayload) -> AgentEvent {
        // No turn id: omp has no turn identifier on the wire, and Dray's
        // transcript groups by user message anyway.
        AgentEvent::mint(
            self.session_id.clone(),
            Harness::Omp,
            self.seq.fetch_add(1, Relaxed),
            None,
            None,
            payload,
        )
    }

    /// One event filed under a run, nesting it under its spawning call. The
    /// envelope's `id` is the *spawning* call's id — what `transcript.ts`
    /// correlates on — never the run's own.
    fn subagent_event(&self, spawn: String, payload: AgentEventPayload) -> AgentEvent {
        AgentEvent::mint(
            self.session_id.clone(),
            Harness::Omp,
            self.seq.fetch_add(1, Relaxed),
            None,
            Some(Subagent { id: spawn, label: None }),
            payload,
        )
    }

    /// The run's own committed words. Its tool blocks are the model *asking* —
    /// the calls themselves arrive as inner `tool_execution_start` lines, which
    /// is what draws the rows — so only text lands here. Dropped where it says
    /// nothing: an empty thinking sidecar draws an empty bubble.
    ///
    /// Role is not read: omp forwards the run's brief as a `user` message and
    /// its thinking sidecars under no role this enum takes, so gating on
    /// `assistant` drops the run's own report.
    fn subagent_message(&self, spawn: String, message: OmpMessage) -> Vec<AgentEvent> {
        let content = match message {
            OmpMessage::Assistant { content, .. } | OmpMessage::User { content } => content,
            OmpMessage::ToolResult { .. } | OmpMessage::Unknown => return Vec::new(),
        };
        content
            .into_iter()
            .filter_map(|block| match block {
                ContentBlock::Text { text } if !text.trim().is_empty() => Some(
                    self.subagent_event(spawn.clone(), AgentEventPayload::AssistantText {
                        block: None,
                        text,
                    }),
                ),
                ContentBlock::Text { .. }
                | ContentBlock::Thinking { .. }
                | ContentBlock::ToolCall { .. }
                | ContentBlock::Unknown => None,
            })
            .collect()
    }
}
/// The run's report: the last assistant text in its forwarded conversation
/// that is not a tool result echo. omp closes the run with the whole inner
/// transcript on the line, so without this the completion lands with no
/// summary and the panel shows the run's work only event by event.
fn last_assistant_text(messages: &[super::parser::InnerMessage]) -> Option<String> {
    messages
        .iter()
        .filter(|m| m.role.as_deref() == Some("assistant"))
        .flat_map(|m| m.content.iter())
        .filter_map(|b| match b {
            super::parser::ContentBlock::Text { text } => Some(text.clone()),
            _ => None,
        })
        .filter(|t| !t.trim().is_empty())
        .next_back()
}
/// The last tool result's text, for a run that only ran tools and left no
/// assistant text behind. Skips the `yield` handshake — `Result submitted` is
/// the run reporting to omp, not to the reader.
fn last_tool_result_text(messages: &[super::parser::InnerMessage]) -> Option<String> {
    messages
        .iter()
        .filter(|m| m.role.as_deref() == Some("toolResult"))
        .flat_map(|m| m.content.iter())
        .filter_map(|b| match b {
            super::parser::ContentBlock::Text { text } => Some(text.clone()),
            _ => None,
        })
        .map(|t| {
            // A result is the output plus omp's own timing line; the timing is
            // bookkeeping, not the report.
            t.lines()
                .take_while(|l| !l.trim().starts_with("Wall time:"))
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string()
        })
        .filter(|t| !t.is_empty() && t != "Result submitted.")
        .next_back()
}

/// omp's tool results are `{content: [{type: "text", text: "…"}], details: {…}}`.
/// Flattened to the one string [`ToolResult::text`] holds, with the whole
/// payload kept beside it in `structured`.
///
/// The `details` half is where omp puts its own bookkeeping — `wallTimeMs`,
/// `timeoutSeconds` — which the row does not draw but which the structured copy
/// keeps.
fn flatten_content(result: &Value) -> String {
    let Some(blocks) = result.get("content").and_then(Value::as_array) else {
        // A result shaped differently — an extension's own tool can return
        // anything. The raw JSON beats an empty row.
        return result
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| result.to_string());
    };

    blocks
        .iter()
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Whether a failed turn died for want of a login.
///
/// **Always `false` today, and that is the honest answer rather than an
/// oversight.** pi matches on its own wrapper sentence
/// (`OAuth refresh failed for …`), which is pi's rather than the provider's and
/// is therefore stable to match on. omp is a fork and may well wrap a spent
/// credential the same way — but no capture here shows a logged-out omp, and
/// omp's `Model not found` / provider errors are its own wording that this build
/// has not seen.
///
/// Guessing would be the wrong way to be wrong: this blocks sending, so a false
/// positive costs the reader a composer they cannot use over an error a retry
/// would have cleared — the exact trade [`crate::harness::mentions_any`]
/// documents. Costs the login button, never the report: the failed turn draws
/// omp's own sentence either way. Widen from a real capture, never from a guess.
fn is_auth_failure(_text: &str) -> bool {
    false
}

impl OmpMessage {
    /// How long the call this message reports took, in milliseconds.
    ///
    /// `f64` on the wire — omp reports `1581.396667` — rounded here because
    /// [`AgentEventPayload::TurnCompleted`] carries an integer and nothing draws
    /// the fraction.
    fn duration_ms(&self) -> Option<u64> {
        let OmpMessage::Assistant { duration, .. } = self else {
            return None;
        };
        duration.map(|d| d.round() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map_all(fixture: &str) -> Vec<AgentEvent> {
        mapped_within(fixture, 0)
    }

    /// The same, on a session that learned its model's context window at the
    /// handshake — which is where the ring's denominator comes from.
    fn mapped_within(fixture: &str, context_window: u64) -> Vec<AgentEvent> {
        let mut mapper = Mapper::new(
            "s".into(),
            Arc::new(AtomicU64::new(0)),
            Arc::new(AtomicU64::new(context_window)),
        );

        fixture
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| super::super::parser::parse_line(l).ok())
            .flat_map(|e| mapper.map(e))
            .collect()
    }

    fn feed(mapper: &mut Mapper, line: &str) -> Vec<AgentEvent> {
        mapper.map(super::super::parser::parse_line(line).expect("parses"))
    }

    fn mapper_with(window: u64) -> Mapper {
        Mapper::new(
            "s".into(),
            Arc::new(AtomicU64::new(0)),
            Arc::new(AtomicU64::new(window)),
        )
    }

    /// What a captured command answered, so a test can check this build's
    /// arithmetic against omp's own rather than against a number typed here.
    fn answered(fixture: &str, command: &str) -> Value {
        fixture
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str::<Value>(l).ok())
            .find(|v| v["type"] == "response" && v["command"] == command)
            .map(|v| v["data"].clone())
            .unwrap_or_else(|| panic!("the capture has no {command} answer in it"))
    }

    const TURN: &str = include_str!("fixtures/turn.jsonl");
    const TOOL: &str = include_str!("fixtures/tool_approval.jsonl");
    const ABORT: &str = include_str!("fixtures/steer_abort.jsonl");
    const HANDSHAKE: &str = include_str!("fixtures/handshake.jsonl");
    const SUBAGENT: &str = include_str!("fixtures/subagent.jsonl");

    /// The whole point of the port, stated once: `agent_end` closes the turn.
    ///
    /// omp has no `agent_settled`. A mapper written by copying pi's either
    /// closes on nothing — the session sits `in_progress` forever with a
    /// complete transcript on screen — or closes on `turn_end`, which ends the
    /// turn at the first tool call and reopens it. `tool_approval` has two model
    /// calls in one turn, so it tells the two apart.
    #[test]
    fn one_prompt_is_one_turn_however_many_model_calls() {
        for fixture in [TURN, TOOL] {
            let events = map_all(fixture);

            let started = events
                .iter()
                .filter(|e| matches!(e.payload, AgentEventPayload::TurnStarted(_)))
                .count();
            let completed = events
                .iter()
                .filter(|e| matches!(e.payload, AgentEventPayload::TurnCompleted { .. }))
                .count();

            assert_eq!(started, 1, "one prompt is one turn");
            assert_eq!(completed, 1, "and it closes exactly once");
        }
    }

    /// **`steer_abort` is two runs, and that is OMP-PLAN §7 in the mapper.**
    ///
    /// The sequence is a prompt, a `steer`, then an `abort` — and omp's `abort`
    /// does not clear the queue, so the steered message resumes the run the
    /// reader stopped. Two `agent_start` frames, one of them *after* the abort
    /// answered success.
    ///
    /// Only one of the two closes here, and that is the capture ending rather
    /// than the mapper failing: run 2 was still going when the process was
    /// killed, so no `agent_end` for it exists in the fixture. The read loop's
    /// child-exit path is what synthesizes that turn's close — see `omp.rs`.
    ///
    /// This is pinned rather than described because it is the bug the whole
    /// no-steering rule exists to avoid: wire steering back into this transport
    /// and a reader's Stop starts meaning something in Dray that it does not
    /// mean in omp.
    #[test]
    fn a_stopped_run_resuming_from_the_queue_is_two_runs() {
        let events = map_all(ABORT);

        let started = events
            .iter()
            .filter(|e| matches!(e.payload, AgentEventPayload::TurnStarted(_)))
            .count();
        let completed = events
            .iter()
            .filter(|e| matches!(e.payload, AgentEventPayload::TurnCompleted { .. }))
            .count();

        assert_eq!(
            started, 2,
            "the abort closed run 1 and the queued steer opened run 2"
        );
        assert_eq!(
            completed, 1,
            "run 2 was still going when the capture ended, so it never closed"
        );
    }

    /// `isTerminal: false` means more work is scheduled, so the turn stays open.
    ///
    /// The field exists for exactly this case, and reading it as terminal closes
    /// the turn with a maintenance pass still to report.
    #[test]
    fn a_non_terminal_agent_end_leaves_the_turn_open() {
        let mut mapper = mapper_with(0);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        let events = feed(&mut mapper, r#"{"type":"agent_end","isTerminal":false}"#);

        assert!(
            events.is_empty(),
            "a non-terminal end closed the turn: {events:?}"
        );
    }

    /// And an *absent* `isTerminal` is terminal, which omp's own doc states.
    ///
    /// This is the half a mapper testing `== Some(true)` gets wrong, and it gets
    /// it wrong silently: the turn simply never closes.
    #[test]
    fn an_absent_is_terminal_closes_the_turn() {
        let mut mapper = mapper_with(0);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        let events = feed(&mut mapper, r#"{"type":"agent_end"}"#);

        assert!(
            events
                .iter()
                .any(|e| matches!(e.payload, AgentEventPayload::TurnCompleted { .. })),
            "an absent isTerminal left the turn open: {events:?}"
        );
    }

    /// A local-only prompt emits no `agent_end`, so `prompt_result` is the only
    /// thing that closes its turn. Without this a `/help` leaves the session
    /// `in_progress` for the rest of its life.
    #[test]
    fn a_local_only_prompt_closes_its_own_turn() {
        let mut mapper = mapper_with(0);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        let events = feed(
            &mut mapper,
            r#"{"type":"prompt_result","id":"p1","agentInvoked":false}"#,
        );

        assert!(events
            .iter()
            .any(|e| matches!(e.payload, AgentEventPayload::TurnCompleted { .. })));
    }

    /// And one that *did* invoke an agent must not: `agent_end` closes that turn,
    /// and closing here too would end it early.
    #[test]
    fn a_prompt_that_invoked_an_agent_closes_nothing_early() {
        let mut mapper = mapper_with(0);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        let events = feed(
            &mut mapper,
            r#"{"type":"prompt_result","id":"p1","agentInvoked":true}"#,
        );

        assert!(events.is_empty(), "the turn closed early: {events:?}");
    }

    /// The tool rows a reader sees come from `tool_execution_*`, not from the
    /// `toolCall` block in the committed message — emitting both draws every
    /// call twice.
    #[test]
    fn each_tool_call_draws_exactly_one_row() {
        let events = map_all(TOOL);

        let started: Vec<_> = events
            .iter()
            .filter_map(|e| match &e.payload {
                AgentEventPayload::ToolCallStarted { call_id, name, .. } => {
                    Some((call_id.clone(), name.clone()))
                }
                _ => None,
            })
            .collect();
        let completed = events
            .iter()
            .filter(|e| matches!(e.payload, AgentEventPayload::ToolCallCompleted { .. }))
            .count();

        assert_eq!(started.len(), 1, "the capture runs one bash command");
        assert_eq!(started[0].1, "bash");
        assert_eq!(completed, 1);
    }

    /// A tool result is flattened for the row and kept whole beside it.
    #[test]
    fn a_tool_result_reads_as_text_and_keeps_its_payload() {
        let events = map_all(TOOL);

        let result = events
            .iter()
            .find_map(|e| match &e.payload {
                AgentEventPayload::ToolCallCompleted { result, .. } => Some(result.clone()),
                _ => None,
            })
            .expect("a tool completed");

        assert!(result.text.contains("dray-omp-probe"), "{}", result.text);
        assert!(result.structured.is_some());
        assert!(!result.is_error);
    }

    /// The echoes are dropped. Dray sent the prompt itself and already reported
    /// the tool result, so both would be second copies of what it knows.
    #[test]
    fn the_user_and_tool_result_echoes_draw_nothing() {
        let events = map_all(TOOL);

        assert!(
            !events
                .iter()
                .any(|e| matches!(e.payload, AgentEventPayload::UserMessage { .. })),
            "omp's echo of Dray's own prompt reached the transcript"
        );
    }

    /// Every block gets a `BlockRef`, and two messages in one turn must not
    /// collide on index 0 — omp identifies messages by nothing at all, so the id
    /// is minted here.
    #[test]
    fn blocks_from_different_messages_do_not_collide() {
        let events = map_all(TOOL);

        let ids: std::collections::HashSet<_> = events
            .iter()
            .filter_map(|e| match &e.payload {
                AgentEventPayload::AssistantText { block, .. }
                | AgentEventPayload::Reasoning { block, .. } => {
                    block.as_ref().map(|b| b.message_id.clone())
                }
                _ => None,
            })
            .collect();

        assert!(
            ids.len() > 1,
            "every message shared one id, so their blocks would overwrite each other"
        );
    }

    /// The committed message's `totalTokens` **is** omp's own occupancy reading,
    /// checked against the `get_session_stats` answer captured in the same
    /// session rather than a number written here.
    #[test]
    fn the_turn_carries_omps_own_occupancy_figure() {
        let stats = answered(HANDSHAKE, "get_session_stats");
        let max = stats["contextUsage"]["contextWindow"]
            .as_u64()
            .expect("the capture answered with a window");

        let window = mapped_within(TURN, max)
            .iter()
            .find_map(|e| match &e.payload {
                AgentEventPayload::TurnCompleted { usage, .. } => {
                    usage.as_ref().and_then(|u| u.context_window)
                }
                _ => None,
            })
            .expect("the turn closed with a window on it");

        assert_eq!(window.max_tokens, max);
        assert!(
            window.used_tokens > 0,
            "a ring drawn at zero claims a fresh context"
        );
    }

    /// Neither half may be guessed at. A window of `0` is an omp that never
    /// said; a count of `0` is a turn that reached no model — an auth failure
    /// reports zeros where the real occupancy is the system prompt — and a ring
    /// drawn there claims a fresh context rather than an unknown one.
    #[test]
    fn a_missing_half_draws_no_ring() {
        let counted = Usage {
            total_tokens: Some(2139),
            ..Usage::default()
        };

        assert!(mapper_with(0)
            .with_occupancy(counted.clone(), TurnStatus::Success)
            .context_window
            .is_none());
        assert!(mapper_with(500_000)
            .with_occupancy(
                Usage {
                    total_tokens: Some(0),
                    ..Usage::default()
                },
                TurnStatus::Success,
            )
            .context_window
            .is_none());
        assert!(mapper_with(500_000)
            .with_occupancy(Usage::default(), TurnStatus::Success)
            .context_window
            .is_none());
        assert!(mapper_with(500_000)
            .with_occupancy(counted, TurnStatus::Success)
            .context_window
            .is_some());
    }

    /// A compaction lowers occupancy, so the message total from before it must
    /// not close the turn as a reading — the ring settles on the newest event
    /// carrying a figure, and a stale one lands after `context_compacted`'s own
    /// count and stays there.
    #[test]
    fn a_turn_closing_after_a_compaction_carries_no_stale_reading() {
        let mut mapper = mapper_with(500_000);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        feed(
            &mut mapper,
            r#"{"type":"message_end","message":{"role":"assistant","content":[],
                "usage":{"input":180000,"output":16,"cacheRead":0,"cacheWrite":0,
                         "reasoning":0,"totalTokens":180016}}}"#,
        );
        feed(
            &mut mapper,
            r#"{"type":"auto_compaction_end","reason":"threshold","aborted":false,
                "result":{"tokensBefore":180016,"estimatedTokensAfter":20000}}"#,
        );
        let closed = feed(&mut mapper, r#"{"type":"agent_end","isTerminal":true}"#);

        assert!(
            closed_usage(&closed).context_window.is_none(),
            "the ring would jump back to the context the compaction threw away"
        );
    }

    /// A compaction that *aborted* changed nothing, so the turn closing after
    /// one keeps its reading.
    ///
    /// Withholding it there does not leave the ring on its last figure — it
    /// blanks it: `context_compacted` still lands carrying no count, and the
    /// reader settles `used` on the newest event that carries one either way.
    #[test]
    fn an_aborted_compaction_leaves_the_reading_alone() {
        let mut mapper = mapper_with(500_000);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        feed(
            &mut mapper,
            r#"{"type":"message_end","message":{"role":"assistant","content":[],
                "usage":{"input":180000,"output":16,"cacheRead":0,"cacheWrite":0,
                         "reasoning":0,"totalTokens":180016}}}"#,
        );
        feed(
            &mut mapper,
            r#"{"type":"auto_compaction_end","reason":"threshold","aborted":true,
                "errorMessage":"Nothing to compact (session too small)"}"#,
        );
        let closed = feed(&mut mapper, r#"{"type":"agent_end","isTerminal":true}"#);

        let window = closed_usage(&closed)
            .context_window
            .expect("the gauge would draw nothing at all");

        assert_eq!(window.used_tokens, 180016);
    }

    /// A failed or aborted turn describes a call that did not land, so it
    /// carries no reading either — the previous reading standing is the safe
    /// direction.
    #[test]
    fn a_failed_turn_carries_no_reading() {
        let mut mapper = mapper_with(500_000);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        feed(
            &mut mapper,
            r#"{"type":"message_end","message":{"role":"assistant","content":[],
                "stopReason":"error","errorMessage":"the provider gave up",
                "usage":{"input":2000,"output":8,"cacheRead":0,"cacheWrite":0,
                         "reasoning":0,"totalTokens":2008}}}"#,
        );
        let closed = feed(&mut mapper, r#"{"type":"agent_end","isTerminal":true}"#);

        assert!(closed_usage(&closed).context_window.is_none());
    }

    /// The usage riding a turn that just closed, so a test asserting about the
    /// ring cannot pass on a turn that never closed at all.
    fn closed_usage(events: &[AgentEvent]) -> Usage {
        match &events[0].payload {
            AgentEventPayload::TurnCompleted { usage, .. } => {
                usage.clone().expect("the counts still ride the turn")
            }
            other => panic!("the turn did not close: {other:?}"),
        }
    }

    /// A failed turn draws omp's own sentence rather than its stop reason. There
    /// is no error event on omp's wire, so `errorMessage` is the only place the
    /// cure is named — and `"error"` alone says nothing a reader can act on.
    #[test]
    fn a_failed_turn_carries_the_sentence_not_the_stop_reason() {
        let mut mapper = mapper_with(0);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        feed(
            &mut mapper,
            r#"{"type":"message_end","message":{"role":"assistant","content":[],
                "stopReason":"error","errorMessage":"No API key for provider: openai-codex"}}"#,
        );
        let closed = feed(&mut mapper, r#"{"type":"agent_end","isTerminal":true}"#);

        let (status, final_text) = match &closed[0].payload {
            AgentEventPayload::TurnCompleted {
                status, final_text, ..
            } => (*status, final_text.clone()),
            other => panic!("expected a closing turn: {other:?}"),
        };

        assert_eq!(status, TurnStatus::Error);
        assert_eq!(
            final_text.as_deref(),
            Some("No API key for provider: openai-codex")
        );
    }
    /// A `task` call is the spawn, so it draws the subagent row rather than a
    /// plain tool card. Without the `SubagentSpawn` fold the run never nests
    /// under it.
    #[test]
    fn a_task_call_is_the_spawn() {
        let events = map_all(SUBAGENT);

        let spawn = events
            .iter()
            .find_map(|e| match &e.payload {
                AgentEventPayload::ToolCallStarted {
                    call_id,
                    tool_type,
                    name,
                    ..
                } => Some((call_id.clone(), *tool_type, name.clone())),
                _ => None,
            })
            .expect("the capture spawns a task");

        assert_eq!(spawn.2, "task");
        assert_eq!(spawn.1, ToolType::SubagentSpawn);
    }

    /// The run's lifecycle, heartbeat and own work all file under the spawning
    /// call — that is the key the panel selects by, and what nests the run
    /// under its row.
    #[test]
    fn a_subagent_run_files_under_its_spawn() {
        let events = map_all(SUBAGENT);

        let spawn = events
            .iter()
            .find_map(|e| match &e.payload {
                AgentEventPayload::ToolCallStarted { call_id, name, .. } if name == "task" => {
                    Some(call_id.clone())
                }
                _ => None,
            })
            .expect("the capture spawns a task");

        let filed: Vec<_> = events.iter().filter(|e| {
            e.subagent.as_ref().is_some_and(|s| s.id == spawn)
        }).collect();

        assert!(
            filed
                .iter()
                .any(|e| matches!(e.payload, AgentEventPayload::SubagentStarted { .. })),
            "no start filed under the spawn"
        );
        assert!(
            filed
                .iter()
                .any(|e| matches!(e.payload, AgentEventPayload::SubagentCompleted { .. })),
            "no completion filed under the spawn"
        );
        assert!(
            filed.iter().any(|e| matches!(
                &e.payload,
                AgentEventPayload::ToolCallStarted { name, .. } if name == "bash"
            )),
            "the run's own bash call never filed under the spawn"
        );
        assert!(
            filed
                .iter()
                .any(|e| matches!(e.payload, AgentEventPayload::AssistantText { .. })),
            "the run's own words never filed under the spawn"
        );
    }

    /// The completion names the run's own id — what `stop_task` takes — while
    /// the envelope stays the spawning call's.
    #[test]
    fn a_subagent_completion_carries_its_own_id() {
        let events = map_all(SUBAGENT);

        let completed = events
            .iter()
            .find_map(|e| match &e.payload {
                AgentEventPayload::SubagentCompleted { agent_id, .. } => {
                    Some((agent_id.clone(), e.subagent.clone()))
                }
                _ => None,
            })
            .expect("the run completed");

        assert_eq!(completed.0, "EchoPong");
        assert!(
            completed.1.is_some(),
            "the completion lost the envelope naming its spawn"
        );
    }
    /// The heartbeat carries the run's own token count — the panel's gauge,
    /// not the session ring's.
    #[test]
    fn a_subagent_heartbeat_carries_its_own_counts() {
        let mut mapper = mapper_with(0);

        feed(
            &mut mapper,
            r#"{"type":"subagent_lifecycle","payload":{"id":"R1","parentToolCallId":"spawn-1","status":"started","agent":"task"}}"#,
        );
        let events = feed(
            &mut mapper,
            r#"{"type":"subagent_progress","payload":{"parentToolCallId":"spawn-1","progress":{"id":"R1","status":"running","lastIntent":"Running echo","recentTools":[{"tool":"bash"}],"tokens":1234}}}"#,
        );

        let progress = events
            .iter()
            .find_map(|e| match &e.payload {
                AgentEventPayload::SubagentProgress { usage, description, last_tool, .. } => {
                    Some((usage.clone(), description.clone(), last_tool.clone()))
                }
                _ => None,
            })
            .expect("a heartbeat filed under the spawn");

        assert_eq!(
            progress.0.and_then(|u| u.total_tokens),
            Some(1234),
            "the run's counts never reached the panel"
        );
        assert_eq!(progress.1.as_deref(), Some("Running echo"));
        assert_eq!(progress.2.as_deref(), Some("bash"));
    }

    /// A `completed` heartbeat closes the run even where the lifecycle frame
    /// beside it was lost — it arrives on every heartbeat, so it cannot be
    /// lost the same way.
    #[test]
    fn a_completed_heartbeat_closes_the_run() {
        let mut mapper = mapper_with(0);

        feed(
            &mut mapper,
            r#"{"type":"subagent_lifecycle","payload":{"id":"R1","parentToolCallId":"spawn-1","status":"started","agent":"task"}}"#,
        );
        let events = feed(
            &mut mapper,
            r#"{"type":"subagent_progress","payload":{"parentToolCallId":"spawn-1","progress":{"id":"R1","status":"completed","tokens":99}}}"#,
        );

        assert!(
            events
                .iter()
                .any(|e| matches!(e.payload, AgentEventPayload::SubagentCompleted { .. })),
            "a completed heartbeat left the run open: {events:?}"
        );
    }

    /// The run's own closing line forwards its whole inner conversation, and
    /// the last assistant text beside the tool calls is the report.
    #[test]
    fn a_run_closing_names_what_it_found() {
        let events = map_all(SUBAGENT);

        let summary = events
            .iter()
            .find_map(|e| match &e.payload {
                AgentEventPayload::SubagentCompleted { summary, .. } => summary.clone(),
                _ => None,
            })
            .expect("the run completed");

        assert!(
            summary.contains("PONG"),
            "the completion carries no report: {summary:?}"
        );
    }



    /// The predicate blocks the composer, so the case that matters is the one
    /// where it must stay quiet. No omp capture of a logged-out turn exists, so
    /// it stays quiet on everything — see [`super::is_auth_failure`].
    #[test]
    fn an_ordinary_failed_turn_is_not_a_login_problem() {
        let mut mapper = mapper_with(0);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        // The exact sentence pi wraps a spent credential in, which omp may or
        // may not share — this build does not claim it does.
        feed(
            &mut mapper,
            r#"{"type":"message_end","message":{"role":"assistant","content":[],
                "stopReason":"error",
                "errorMessage":"OAuth refresh failed for openai-codex: token reuse"}}"#,
        );
        let closed = feed(&mut mapper, r#"{"type":"agent_end","isTerminal":true}"#);

        let auth_failed = match &closed[0].payload {
            AgentEventPayload::TurnCompleted { auth_failed, .. } => *auth_failed,
            other => panic!("expected a closing turn: {other:?}"),
        };

        assert!(
            !auth_failed,
            "a guess here blocks sending on an error a retry would have cleared"
        );
    }

    /// A retry drives the indicator that already exists for one, and its counts
    /// are defaulted rather than dropped — the indicator's whole message is
    /// "attempt N of M".
    #[test]
    fn a_retry_carries_its_count_and_the_cause_omp_named() {
        let mut mapper = mapper_with(0);
        let events = feed(
            &mut mapper,
            r#"{"type":"auto_retry_start","attempt":3,"maxAttempts":10,
                "delayMs":2000,"errorMessage":"overloaded"}"#,
        );

        let [event] = &events[..] else {
            panic!("one retry, one row: {events:?}");
        };
        assert!(matches!(
            &event.payload,
            AgentEventPayload::ApiRetry {
                attempt: 3,
                max_retries: 10,
                status: None,
                reason: Some(cause),
            } if cause == "overloaded"
        ));

        let bare = feed(&mut mapper, r#"{"type":"auto_retry_start"}"#);
        assert!(matches!(
            bare[0].payload,
            AgentEventPayload::ApiRetry {
                attempt: 1,
                max_retries: 1,
                reason: None,
                ..
            }
        ));
    }

    /// A compaction closes its own indicator and reports what it saved.
    #[test]
    fn a_compaction_reports_what_it_saved() {
        let mut mapper = mapper_with(0);
        let events = feed(
            &mut mapper,
            r#"{"type":"auto_compaction_end","reason":"threshold","aborted":false,
                "result":{"tokensBefore":120000,"estimatedTokensAfter":18000}}"#,
        );

        let [event] = &events[..] else {
            panic!("one boundary, one row: {events:?}");
        };
        assert!(matches!(
            &event.payload,
            AgentEventPayload::ContextCompacted {
                trigger: Some(reason),
                pre_tokens: Some(120000),
                post_tokens: Some(18000),
                duration_ms: None,
            } if reason == "threshold"
        ));
    }

    /// An aborted compaction closes the indicator and claims nothing: the numbers
    /// describe a context that was thrown away, and reporting a saving for one
    /// is worse than reporting none.
    #[test]
    fn an_aborted_compaction_still_closes_and_claims_nothing() {
        let mut mapper = mapper_with(0);
        let events = feed(
            &mut mapper,
            r#"{"type":"auto_compaction_end","reason":"manual","aborted":true,
                "result":{"tokensBefore":120000,"estimatedTokensAfter":18000}}"#,
        );

        assert!(matches!(
            events[0].payload,
            AgentEventPayload::ContextCompacted {
                pre_tokens: None,
                post_tokens: None,
                ..
            }
        ));
    }

    /// An extension that throws gets a row, because nothing else would say so —
    /// a permission extension that fails simply stops gating, which looks exactly
    /// like it working.
    #[test]
    fn an_extension_that_throws_is_drawn_and_is_not_fatal() {
        let mut mapper = mapper_with(0);
        let events = feed(
            &mut mapper,
            r#"{"type":"extension_error","extensionPath":"/e/gate.js",
                "event":"tool_call","error":"boom"}"#,
        );

        let [event] = &events[..] else {
            panic!("one failure, one row: {events:?}");
        };
        let AgentEventPayload::Error { message, fatal, .. } = &event.payload else {
            panic!("expected an error row: {:?}", event.payload);
        };

        assert!(message.contains("/e/gate.js"), "{message}");
        assert!(message.contains("boom"), "{message}");
        assert!(!fatal, "the session is still running");
    }

    /// omp reports how long the last model call took, where pi reports nothing.
    /// Read off `turn_end`, which is the line that closes the call.
    #[test]
    fn the_turn_carries_the_duration_omp_reported() {
        let mut mapper = mapper_with(0);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        feed(
            &mut mapper,
            r#"{"type":"turn_end","message":{"role":"assistant","content":[],
                "duration":1581.396667,"ttft":1575.9}}"#,
        );
        let closed = feed(&mut mapper, r#"{"type":"agent_end","isTerminal":true}"#);

        match &closed[0].payload {
            AgentEventPayload::TurnCompleted { duration_ms, .. } => {
                assert_eq!(*duration_ms, Some(1581));
            }
            other => panic!("expected a closing turn: {other:?}"),
        }
    }

    /// A duration from an earlier model call must not ride a turn that closed
    /// without one — a tool-free second call reports none, and keeping the first
    /// would attribute it to the wrong stretch.
    #[test]
    fn a_turn_with_no_duration_carries_none() {
        let mut mapper = mapper_with(0);

        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        feed(&mut mapper, r#"{"type":"turn_end"}"#);
        let closed = feed(&mut mapper, r#"{"type":"agent_end","isTerminal":true}"#);

        match &closed[0].payload {
            AgentEventPayload::TurnCompleted { duration_ms, .. } => assert_eq!(*duration_ms, None),
            other => panic!("expected a closing turn: {other:?}"),
        }
    }

    /// A line omp grows later must cost one line, never the turn.
    #[test]
    fn an_unmodelled_event_draws_nothing_and_costs_nothing() {
        let mut mapper = mapper_with(0);

        assert!(feed(&mut mapper, r#"{"type":"weather_changed"}"#).is_empty());
        // And the turn still closes afterwards.
        feed(&mut mapper, r#"{"type":"agent_start"}"#);
        let closed = feed(&mut mapper, r#"{"type":"agent_end","isTerminal":true}"#);
        assert!(matches!(
            closed[0].payload,
            AgentEventPayload::TurnCompleted { .. }
        ));
    }
}
