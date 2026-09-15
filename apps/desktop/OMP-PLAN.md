# omp as a fourth harness, over `omp --mode rpc`

Architecture plan. Written against omp's own `docs/rpc.md` at
`can1357/oh-my-pi@main`, and against `omp 18.1.20` (Homebrew, `/opt/homebrew/bin/omp`)
on 2026-09-15.

**Captured live** against that build: the handshake and the `get_state` /
`get_available_models` / `get_available_commands` / `get_session_stats` replies; a
session-flag round trip proving `--session <path>` resumes; a text-only turn; a tool
turn whose approval was answered mid-flight; and two sweeps of the command surface,
one of which found the renames. All protocol v1 over stdio, no v2 negotiation.

Nothing is written yet. This is the design.

## What the live captures corrected

Seven things were taken on trust before anything ran. Six of them did not survive.

| | taken on trust | wire says |
|---|---|---|
| transfer | omp is a pi fork, so the pi harness moves across | **Half true, and the false half strands sessions.** Framing, deltas and the tool events are pi's. The turn closer is not: there is no `agent_settled` anywhere, and `agent_end` with `isTerminal !== false` replaces it |
| turn closer | `agent_end` fires per run and means nothing, exactly as in pi | **Inverted.** `docs/rpc.md` says to treat an `agent_end` as run completion *only* when `isTerminal !== false`. pi had a separate settle line and treated `agent_end` as noise; omp has one line doing both jobs |
| commands | `get_commands` answers the slash list | **Renamed** to `get_available_commands`, and the same array also arrives unprompted as `available_commands_update` — **three times in one turn**, so it needs deduping rather than mapping |
| Stop | `clear_queue` then `abort`, or a steered message is delivered after the abort | **`clear_queue` is gone.** `abort` answers success and nothing in the doc drains the queue; steering is governed by `set_steering_mode` / `set_follow_up_mode` / `set_interrupt_mode` |
| resume | `--session <path>` is what makes Dray's fork a file copy | **True.** Two spawns on one path reported the same `sessionId`, and `--resume <path>` reported it too. The pi design transfers whole |
| approvals | pi has no permission system, so Dray ships an extension that raises the card | **Not needed here.** omp raises its own `extension_ui_request` `select` — `title: "Allow tool: bash\nCommand: …"`, `options: ["Approve","Deny"]` — which is the method `dialog.rs` already answers |
| prompt | fire-and-forget; failures arrive as events | **Stricter.** Omitting `streamingBehavior` *while streaming* **fails** rather than queueing. A local-only slash command answers `agentInvoked: false` and emits **no `agent_end`** — a turn that never closes |
| errors | a failure is the same line with `success: false` and the id echoed | **Not the id.** An unknown command answers with `id: undefined`, which the pi client files as a stray and its caller waits 30s to time out on |

And four things pi has no answer for at all, which are surface rather than
risk: **v2 chunked framing** (opt-in, `negotiate_protocol`), **`get_messages_page`**
with opaque cursors, **native subagents** (`set_subagent_subscription`,
`get_subagents`, `get_subagent_messages`), and **host tools and host URIs** — plus
`login` / `get_login_providers` and `switch_session` / `branch`, which between them
retire two of pi's awkward corners.

## TLDR for human

- **This is a fork of the pi harness, not a new harness.** Same `--mode rpc`, same
  `{id,type}` framing, same `message_update` deltas, same `tool_execution_*`, same
  `extension_ui_request` sub-protocol. `harness/pi/` is the template and
  `harness/rpc.rs` is the shared seam both already sit on.
- **The one decision that must not be got wrong is the turn closer.** pi maps
  `agent_settled` → `TurnCompleted`; omp has no such event. `agent_end` with
  `isTerminal !== false` is the closer, and getting it wrong is the documented way
  to strand a session `in_progress` forever with a complete-looking transcript.
- **Stop loses its second half, and the gap is *inside* omp.** pi's Stop is
  `clear_queue` then `abort` because a queued steer is otherwise delivered after the
  abort. omp's TUI does exactly that; omp's RPC has no way to ask for it, so `abort`
  alone leaves the steer to resume the run — measured, not inferred. §7 has the
  trace and §15 is the upstream issue.
- **Permissions get *better*, and in the opposite direction from pi.** pi had no
  gate and Dray embedded an extension to build one. omp raises its own card, on the
  channel Dray already reads, so nothing is embedded — and the stance picker, which
  pi hides, can be offered for real.
- **`@file` mentions get cheaper.** omp's own `read` handles paths and its CLI
  rejects `@file` *arguments*, but the prompt path is what matters and pi's
  `--append-system-prompt` has an exact counterpart.
- **Subagents exist here, so the panel un-hides** — a state pi explicitly opted out
  of. Not slice 1, but the reason `caps()` needs a field pi never needed.
- Worktrees are free: no `-w`, so Dray makes the tree through the path Codex and pi
  already take.

---

## §1 What omp is

A fork of Mario Zechner's `pi-mono`, by Can Bölük, MIT, tracking its own version
train — `18.1.20` against pi's `0.84.x`, so nothing about pi's numbering, its
package layout or its `0.80.6` `agent_settled` floor transfers.

It is a superset of pi in almost every dimension: 60+ providers, 31 built-in tools,
LSP and DAP wired in, an extension/plugin/marketplace system, memory backends,
subagents, a browser, and a desktop-control surface. Two consequences for this plan
and no more: **the parts Dray drives are pi's parts**, and **the parts Dray does not
drive are much larger than pi's** — so the harness must be written to ignore
unknown frames rather than fall over on them.

State lives in `~/.omp/agent` (overridable through `PI_CODING_AGENT_DIR`, which
kept its `PI_` name), SQLite-backed — `agent.db`, `models.db`, `history.db` — where
pi kept JSON files. **No `auth.json.lock` was present**, only `config.yml.lock` and
`mcp.json.lock`. That is the fact behind §7.

## §2 The seam

`harness/rpc.rs` is the shared core pi and Codex both sit on: outbound requests
carrying an id, a pending map, a writer task, a demux that settles answers before
anything else sees the line. omp's framing is pi's — flat `{id, type, …}` commands,
`{type: "response", command, success, data|error}` answers — so **the seam is reused
unchanged and `harness/omp/rpc.rs` is a near-copy of `harness/pi/rpc.rs`**, differing
in three places:

1. **The `ready` frame.** omp writes one on spawn; pi is silent. pi's handshake is
   therefore "send `get_state` and read the answer", and omp's can be the same —
   but the `ready` frame arrives first and carries the protocol version and the
   frame caps, so it is where a v2 decision would be made.
2. **The id-less error.** An unknown command answers `id: undefined`. The shared
   demux settles by id, so this lands in the stray branch and the caller — which
   registered a slot — waits out `REQUEST_TIMEOUT`. Slice 0 either matches the
   error by `command` when the id is absent, or keeps a short list of commands this
   build must not send.
3. **The close gate and stop window** are pi's, kept as-is: omp asked to leave on
   EOF is still the polite exit, and the argument for it changes (below) rather
   than disappearing.

`session.rs` branches on harness in more places than pi's plan counted, and its
capability table — `caps()` in `harness.rs` — is what a fourth variant is expected
to answer. Every field there is a question omp answers differently from pi, which
is the point of the table.

## §3 Framing, and the 1 MiB ceiling

**Stay on protocol v1.** The ready frame advertises `supportedProtocolVersions:
[1, 2]`; v2 is opt-in through `negotiate_protocol` and buys **lossless oversized
frames** — anything over the 1 MiB physical cap is emitted as a sequence of
`rpc_chunk` frames carrying base64 segments, which the client must validate,
reassemble in index order, decode as strict UTF-8 and parse.

Nothing Dray reads needs it, and the cost of it is a whole new decode path plus a
reassembly limit to enforce. **What is load-bearing is the ceiling itself.** In v1
an object over 1 MiB gets the "bounded fallback", which is not lossless. The
capture's own handshake was 746 KB across ten lines, dominated by
`available_commands_update` — so an `available_commands_update` on a machine with
more extensions, or a `get_messages` on a long session, is the shape that hits the
ceiling.

So: **read commands with `get_messages_page`, never `get_messages`.** It answers
`{messages, totalMessages, nextCursor?}`, rejects pagination while streaming or
compacting with a machine-readable `code` (`session_busy`, `stale_cursor`), and
caps a page at 256 messages. That is the v1-safe read, and it is the one place
where omp's surface is better than pi's rather than merely different.

## §4 The turn, which is the part that strands sessions

The captured shape of one tool-using turn, in order:

```
ready
extension_ui_request      setWidget — an announcement
available_commands_update
response                  the prompt, acked immediately
thinking_level_changed
agent_start               ◀── TurnStarted
turn_start                ◀── ModelRequestStarted
message_start             user
message_end               user
message_start             assistant
message_update ×165       text/thinking/toolcall deltas
extension_ui_request      select — the approval, blocking
message_end               assistant
tool_execution_start
tool_execution_update ×2
tool_execution_end
message_start / message_end
turn_end                  ◀── first model call done
turn_start                ◀── second model call
message_update ×57
message_end
turn_end
agent_end                 ◀── TurnCompleted, isTerminal: true
```

`turn_start` / `turn_end` fire **once per model call**, and `agent_start` /
`agent_end` once per run. That is pi's structure exactly — with `agent_settled`
swapped for a flagged `agent_end`.

Two rules follow, and both are the difference between a working harness and a
session that never ends:

- **`TurnCompleted` comes from `agent_end` where `isTerminal !== false`.** The field
  is optional and absent on older runtimes, which the doc says to read as terminal —
  so the test is `isTerminal != Some(false)`, not `== Some(true)`.
- **A `turn_end` is not a turn ending.** Mapping it to `TurnCompleted` would close
  the turn at the first model call of every tool-using run. It carries the message
  and its usage, so it is where the per-call figures come from, not where the turn
  closes.

**The third closer is not an event.** A slash command that resolves locally answers
`data.agentInvoked: false` — or a later `prompt_result` frame — and emits **no
`agent_end` at all**. Since Dray sends every slash command as prompt text, a pi-style
mapper that waits for `agent_settled` would sit `in_progress` forever after
`/help`. So the prompt response itself is an input to the status machine, which pi's
never was.

## §5 The event vocabulary

| omp | Dray |
|---|---|
| `agent_start` | `TurnStarted` |
| `agent_end` (`isTerminal != Some(false)`) | `TurnCompleted` |
| `turn_start` | `ModelRequestStarted` |
| `turn_end` | nothing persisted; the carrier for per-call usage and timing |
| `message_start` / `message_end` | nothing; boundaries the mapper may use internally |
| `message_update` | `Delta` (text, thinking, toolcall), keyed on `contentIndex` |
| `tool_execution_start` | `ToolCallStarted` (`toolCallId`, `toolName`, `args`) |
| `tool_execution_update` | nothing at first; a live progress preview is a later slice |
| `tool_execution_end` | `ToolCallCompleted` (`result.content`, `isError`) |
| `extension_ui_request` (blocking) | `PermissionRequested` / `QuestionsAsked` |
| `extension_ui_request` (announcement) | dropped, as pi's are |
| `model_changed` | re-read the context window |
| `thinking_level_changed` | dropped, like Claude's effort echo |
| `auto_compaction_start` / `_end` | `CompactionStarted` / `CompactionCompleted` |
| `auto_retry_*`, `retry_fallback_*` | the retry row |
| `extension_error` | filed as a coverage gap |
| `notice`, `goal_updated`, `irc_message`, `ttsr_triggered`, `todo_*` | dropped at first |

Two details worth carrying across from the captures:

- **The deltas are real here, and better than pi's.** `toolcall_delta` streams
  fragmenting `partialArgs` rather than firing once with the whole object, and
  `thinking_delta` carries text rather than pi's *and* Claude's empty string. So the
  streaming-preview split — header from the stream, body from the committed event —
  is worth wiring rather than a formality.
- **`usage` is populated** (`input`/`output`/`cacheRead`/`cacheWrite`/`cost`) and
  `turn_end.message` carries `duration` and `ttft` in milliseconds. Neither pi
  capture had usable streaming usage, so this is the first harness where the
  timing figures are real.

`available_commands_update` is not an `AgentEventPayload` and must not become one —
it is a list, pushed three times a turn, and it belongs on the same side channel
Claude's `commands_changed` would use.

## §6 Permissions

**omp raises its own card, on the channel Dray already reads.** Captured, with
`--approval-mode always-ask`:

```json
{"type":"extension_ui_request","id":"15800564706f3b0a","method":"select",
 "title":"Allow tool: bash\nCommand: echo dray-omp-probe",
 "options":["Approve","Deny"]}
```

That is pi's `select` verbatim, and `dialog.rs` already turns it into a card and
answers `{"type":"extension_ui_response","id":…,"value":<label>}` — which is what
omp expects. It blocks until answered: an unanswered one came back as
`"RPC client disconnected before extension UI response completed"`.

So **nothing is embedded for omp**, and the pi harness's extension — with its
fail-open gate and its "a gated session refuses to start until the extension
announces itself" rule — is not part of this port. The whole of the reader-facing
surface is `dialog.rs`, unchanged.

**The stance picker comes back.** pi is recorded `HONOURED[pi] = []` because pi has
no permission system to honour anything with. omp has `--approval-mode
(always-ask|write|yolo)` and `--auto-approve`, so `manual` / `auto` /
`bypassPermissions` map onto real settings rather than onto a lie, and
`permission.ts` gets an entry that offers them. `plan` is the open question: omp's
`--tools` allowlist is a different list of tool names than pi's
(`read, grep, glob, lsp, …`, not `read, grep, find, ls`), so it needs its own
constant or is left out with the reason written down.

## §7 Stop: `abort` alone does not stop

pi's Stop is `clear_queue` **then** `abort`, and the ordering is the whole of it: a
steered prompt is delivered at the next tool-call boundary, so aborting alone lets a
queued message start the moment the abort lands — Stop reading as though it changed
nothing.

**omp's RPC has no equivalent, and this is the one place the port is genuinely
blocked on somebody else's code.** Traced through the source at
`can1357/oh-my-pi@v18.1.20` and settled against the running build rather than
inferred.

The chain, with the lines that matter:

```
RPC "abort"                          rpc-mode.ts:1191
 └─ AgentSession.abort({ reason: USER_INTERRUPT_LABEL })   agent-session.ts:7801
      ├─ #advisors.autoResumeSuppressed = true             7809
      ├─ #extractQueuedAdvisorCards()                      7813  ← advisor cards only
      ├─ this.agent.abort(reason)                          7844
      │    └─ Agent.abort => #abortController?.abort(reason)   agent.ts:1125
      ├─ await this.agent.waitForIdle()                    7846
      └─ finally { #abortInProgress = false;               7879
                   #drainStrandedQueuedMessages(); }       907
           └─ #scheduleQueuedMessageDrain()                932 → 6997
                └─ gate: #canAutoContinueForFollowUp()      7031
                     └─ peekSteeringQueue().length > 0 → true   ← 7040
                └─ #scheduleAgentContinue(…)  → the run resumes
```

Six facts, each read off the source:

- **`AgentSession.clearQueue({ forInterrupt?: boolean })` already exists** —
  `agent-session.ts:7440`. With `forInterrupt` it keeps advisor cards and drops every
  other queued steer, which is precisely the semantics pi's `clear_queue` had. It is
  built on `Agent.replaceQueues()` (`agent.ts:988`) and `Agent.clearAllQueues()`
  (`agent.ts:1041`).
- **`Agent.abort()` does not touch the queues.** It is
  `this.#abortController?.abort(reason)` and nothing else (`agent.ts:1125`).
- **`AgentSession.abort()` does not call `clearQueue` either.** The only thing it
  removes is advisor cards (7813), so a queued user steer survives it intact.
- **`queuedMessageCount` is derived, not stored** — `agent-session.ts:7459`, summing
  both agent-core queues plus `#pendingNextTurnMessages`, which is in neither. The
  truth is `Agent.#steeringQueue` / `#followUpQueue`, read through
  `peekSteeringQueue()` / `peekFollowUpQueue()` (`agent.ts:1056`, `1062`).
- **The RPC does not expose `clearQueue`.** Read off the canonical `RpcCommand`
  union, `rpc-types.ts:30-93`: the only queue commands are `set_steering_mode`,
  `set_follow_up_mode` and `set_interrupt_mode` — modes, never a drain.
- **`clearQueue` has exactly one caller in the whole repository, and it is not the
  RPC.** It is `input-controller.ts:1672`, the TUI's Esc/Alt+Up handler, which does
  `session.clearQueue({ forInterrupt: options?.abort })` **before** aborting.

**So omp's TUI has the correct Stop and omp's RPC does not.** That is a gap between
two frontends of the same program, not a documented limitation and not a Dray
misreading.

**The line that decides it is 7040.** `#canAutoContinueForFollowUp()` returns `true`
on a non-empty steering queue *before* it reaches the `autoResumeSuppressed` check at
7045 — so the suppression an abort sets covers a queued **follow-up** and not a
queued **steer**. That asymmetry is stated in omp's own comment at 924-925 ("a
non-empty steer queue otherwise bypasses the latch").

**Confirmed live.** Prompt, then `steer`, then `abort`, in that order, against
`omp --mode rpc --no-session`: `agent_start` fired **twice**, and the second followed
the abort's success response. The first `agent_end` carries both user messages.

```
response  prompt  p1
agent_start            ← run 1
response  steer   s1
agent_end              ← run 1 ends
response  abort   a1   ← abort reported success
agent_start            ← run 2, from the queued steer
```

**This is reachable through Dray's ordinary UI, not theoretically.** `session.rs`
sends a prompt typed mid-turn as `Session::steer` whenever the transport is pi's
(857-858), rather than holding it in Dray's own queue — so the reader types, hits
Stop, and the message runs anyway. An omp transport taking that same branch inherits
the same defect, which is why this is a slice-0 fact rather than a footnote.

`interruptMode` does not mitigate it. The three queue *modes* govern when a steer is
polled *inside* a turn — `"immediate"` checks between tool calls and can even abort
remaining tool calls, `"wait"` defers to the turn's end — and none of them is on the
post-abort drain path.

### What Dray does about it

**Dray does not fork or patch omp.** The reader installs omp themselves — Homebrew,
bun, `curl | sh` — and Dray ships no agent CLI: the same rule `binpath` states for
every other harness. Vendoring a patched omp would put a second copy beside the
reader's own and make every future omp release our problem. The fix belongs upstream,
and §15 carries it as drafted.

Two consequences for the build, neither of which needs an omp change:

- **Vendor the trade, not the steer.** The omp transport does not call `steer`; a
  prompt typed mid-turn is held in Dray's own queue and flushed at a boundary
  (`queue_msg` / `flush_queued`, the path every non-pi harness already takes,
  `session.rs:1741`). That removes the reader-reachable case entirely, at the cost of
  mid-turn steering being honoured on the next turn rather than inside the current
  one — the same trade `queue_and_flush` already documents for pi.
- **A resume after a Stop must be drawn, not ignored.** Even with no steering from
  Dray, omp's *own* hidden steers can sit in that queue — checkpoint reminders,
  image-description notices, goal/plan/budget notices, extension and IRC asides — and
  `abort` removes none of them. The exposure is narrow, and both observables are
  free: `get_state.queuedMessageCount` reports the queue even though nothing can
  drain it, and an `agent_start` arriving unbidden after an `abort` is the drain
  firing. Dray should follow it rather than keep showing the session as stopped.

`switch_session` to the same path is the one existing route that would clear the
queue (`agent.clearAllQueues()`, `agent-session.ts:9132`), and it is deliberately not
the answer: it flushes, reloads the transcript from disk, rehydrates checkpoint state
and can be cancelled by a `session_before_switch` handler. That is a reload being
asked to mean "stop", and it costs a full session read on every press.

## §8 Session, resume, fork

**`--session <path>` behaves exactly as on pi**, verified three ways: two spawns on
one path reported an identical `sessionId`, and `--resume <path>` reported it too.
Dray picks the file; pi mints or adopts the id inside it. So:

- `store::pi_session_file` gains an omp sibling under its own directory — the two
  formats are different (omp's first line is `{v, type, title, pad, updatedAt}`) and
  must not share a name pattern.
- **Fork is the same file copy**, with no CLI half, so `fork_needs_cli` is `false`.
- Nothing extra is written into the reader's own `~/.omp/agent` when an explicit
  path is given, which is what keeps an agent's session out of the reader's list.

Two things omp adds that the plan should not silently pass over:

- **`switch_session {sessionPath}`** and **`branch {entryId}`** with
  `get_branch_messages` — omp has a native branch primitive. Dray's fork is a whole
  file copy because the CLI exposed nothing narrower; omp exposes a per-entry
  branch. Wiring it is not slice 1, but it is the first harness where a fork at a
  chosen message is *possible*, and the index's `fork_from` was built to carry
  exactly that kind of instruction.
- **`get_state.sessionFile`** — the path comes back, so a mismatched or unhonoured
  `--session` is detectable at handshake rather than by a transcript that quietly
  belongs to somebody else.

## §9 Models and effort

`get_available_models` answers **218 models on this machine**, each carrying
everything the picker needs in one read: `id`, `name`, `provider`, `api`, `cost`,
`contextWindow`, `maxTokens`, `reasoning`, `input: ["text","image"]`,
`thinking: {mode, efforts}`, `identity`, `supportsComputerUse`.

That is pi's two-field naming (a bare `id` beside a separate `provider`) — the
shape `Model { arg, provider }` already has — with the effort ladder folded into
each row instead of a second `get_available_thinking_levels` call, **which omp
removed**. `thinking.efforts` is per model, which is the ladder Dray wants and the
reason the pi harness's separate read is not ported.

`set_model {provider, modelId}` and `set_thinking_level {level}` are pi's. Whether
either applies *in place* on omp is unverified — pi's `caps()` says no for both and
respawns, and a respawn always applies the change, so the safe answer is to keep
that shape until a capture says otherwise.

`get_state.contextUsage {tokens, contextWindow, percent}` gives the ring both
halves in one read, where pi needed a per-turn pull of `get_session_stats`. The
`percent` field is omp's own and is deliberately not trusted over the other two.

## §10 Slash commands

**`get_available_commands`**, not `get_commands`. The array also arrives unprompted
as `available_commands_update` — at startup and on change — so the picker can be
filled from the push and the command never sent, which is strictly better than
pi's throwaway probe. It must be **deduped**, since three identical updates arrived
in one turn.

The rows are richer than pi's: `name`, `source` (`builtin` / `extension` /
`custom` / `skill` / `file` / `file`), optional `aliases`, `description`,
`input.hint` and `subcommands`. Captured on this machine: 54 commands. The four
Dray withholds (`clear`, `fast`, `model`, `rename`) are moot here — omp's list
already omits what Dray owns in chrome, and the ones that remain are a different
set.

## §11 Skills, rules and the system prompt

pi's harness asserts `APPEND_SYSTEM_PROMPT.contains("~/.agents/skills/dray")`.
**omp's discovery roots are not verified** and are not pi's: it advertises
inheriting `.claude`, `.cursor`, `.windsurf`, `.gemini`, `.codex`, `.cline`,
`.github/copilot` and `.vscode`, and it has its own `--skills=<glob>`,
`--no-skills`, `--no-rules` and `--no-extensions`. So the dray skill's install
target for omp is a slice-0 question, and the assertion is rewritten from a capture
rather than copied — a prompt naming a directory the agent never reads is the same
failure as naming a tool it does not have.

`--append-system-prompt` exists and is the same flag.

## §12 Subagents

pi has none, and its harness says so: "Subagents do not exist in pi. The panel stays
hidden." **omp has a full surface** — `set_subagent_subscription {level: off |
progress | events}`, `get_subagents`, `get_subagent_messages` — plus
`subagent_lifecycle`, `subagent_progress` and `subagent_event` frames, gated on the
subscription. Default is `off`, which is the cheap and honest starting point: the
capability is recorded in `caps()`, the subscription stays off, and the panel stays
hidden exactly as it does for pi until a slice turns it on.

## §13 Worktrees

No `-w`, so `creates_own_worktree: false` and Dray makes the tree through the
`create_worktree` path Codex and pi already take — a real `snapshot_tree` baseline
rather than `base_ref_tree`'s approximation.

## §14 Slices

**Slice 0 — the seam and the two facts §7 left open.** §7 is answered and closed: the
RPC has no queue drain, so the omp transport does not steer and Stop is `abort` alone
until upstream lands `clear_queue` (§15). Confirm `agent_end`'s `isTerminal` on a turn
that ends with a live background job, since that is the case the flag exists for.
Find omp's skill directory. Add the `Harness::Omp` variant with the whole registration
sweep — `ALL`, `wire_name`, `label`, `install_command`, `docs_url`, `login_command`,
`login_args`, `login_hint`, `caps()` — plus `binpath::omp()` and the frontend's
`HARNESS_ORDER`, `AGENT_LABELS`, `AgentIcon`, `permission.ts`. Commit the captures as
fixtures under `harness/omp/fixtures/`.

**Slice 1 — a working session.** The RPC client's three deltas, spawn with
`--session`, the handshake, the discovered model list, the event mapping of §5 with
§4's closer, `get_messages_page` for the transcript, the dialog path reused
unchanged, Stop, and `dray new --harness omp` end to end.

**Slice 2 — the stances.** `--approval-mode` mapping, the picker un-hidden, and
whatever §6 decides about `plan`.

**Slice 3 — the extras.** Subagents, `branch`-based fork, the streaming preview,
the login flow over `login` / `get_login_providers`.

## §15 Upstream: the `clear_queue` issue

Drafted for `can1357/oh-my-pi` off the §7 trace. **Nothing has been filed, and Dray
does not wait on it** — §7's two consequences are on Dray's side of the line and need
no omp change. This exists so the finding is reportable rather than merely written
down, and so the workaround has something to be deleted against.

Repo for the filing: `can1357/oh-my-pi`. Target the current `main`; the line numbers
below are `v18.1.20` and should be re-read before posting.

````markdown
**Title:** RPC mode cannot clear the prompt queue, so `abort` does not stop a queued steer

### Problem

In RPC mode there is no way to clear a queued steer or follow-up message. `abort`
reports success, but a steer queued before it still runs: a second `agent_start`
follows the abort response.

The TUI does not have this problem. Esc calls `session.clearQueue({ forInterrupt:
true })` and then aborts. RPC hosts have no equivalent because `clearQueue` is not
reachable as an `RpcCommand`.

### Current behaviour

- `AgentSession.clearQueue({ forInterrupt?: boolean })` exists and has exactly the
  right semantics — `packages/coding-agent/src/session/agent-session.ts:7440`. With
  `forInterrupt` it keeps advisor cards and drops every other queued steer.
- Its **only** caller in the repository is the TUI input controller —
  `packages/coding-agent/src/modes/controllers/input-controller.ts:1672`.
- RPC `abort` — `packages/coding-agent/src/modes/rpc/rpc-mode.ts:1191` — calls
  `session.abort({ reason: USER_INTERRUPT_LABEL })`, which removes only advisor cards
  (`agent-session.ts:7813`).
- `Agent.abort()` is just the abort signal (`packages/agent/src/agent.ts:1125`); it
  does not touch the queues.
- `AgentSession.abort()`'s `finally` calls `#drainStrandedQueuedMessages()` →
  `#scheduleQueuedMessageDrain()`, whose gate `#canAutoContinueForFollowUp()` returns
  `true` on a non-empty steering queue (`agent-session.ts:7040`) **before** the
  `autoResumeSuppressed` check (`:7045`). The queued steer therefore resumes the run.
  A queued follow-up does not — it reaches `:7045` and is suppressed.
- The `RpcCommand` union (`packages/coding-agent/src/modes/rpc/rpc-types.ts:30-93`)
  offers `set_steering_mode`, `set_follow_up_mode` and `set_interrupt_mode`. These are
  modes, not drains, and none is on the post-abort path.

### Repro

Send these three frames, in this order, to `omp --mode rpc --no-session`:

```json
{"id":"p1","type":"prompt","message":"Run exactly this bash command, then wait for it: sleep 25. Then say DONE."}
{"id":"s1","type":"steer","message":"Ignore the sleep. Reply with exactly the word STEERED."}
{"id":"a1","type":"abort"}
```

Observed on omp 18.1.20 (macOS, arm64): `agent_start` fires **twice**. The second
follows the `response` for `a1`, and the first `agent_end` carries both user messages.

```
response  prompt  p1
agent_start            ← run 1
response  steer   s1
agent_end              ← run 1 ends
response  abort   a1   ← abort reported success
agent_start            ← run 2, from the queued steer
```

Expected: after `abort` completes, no already-queued message starts a new run — or the
host has a way to ask for that to be true.

### Proposed minimal change

One additive command, reusing the method that already exists:

```ts
// rpc-types.ts — RpcCommand union, beside the other queue commands
| { id?: string; type: "clear_queue" }
```

```ts
// rpc-mode.ts — dispatch switch, beside set_steering_mode (~line 1381)
case "clear_queue": {
    const dropped = session.clearQueue({ forInterrupt: true });
    return success(id, "clear_queue", { dropped });
}
```

plus the matching success-response member in the union beside `set_steering_mode`'s
(`rpc-types.ts:~289`). `clearQueue` already returns the user-restorable messages, so
the response can carry what was dropped with no extra work.

That is one union member, one switch case and one response type. No new machinery.

### Why a separate `clear_queue` rather than changing `abort`

Making `abort` clear the queue would match the TUI in one line, and it may be what
most hosts want. It is still the wrong default to bake in:

- **It changes an existing command's meaning for every host.** `abort` today means
  "stop the current run". Quietly making it also destroy queued user input is a
  semantic change a host can only discover by being broken by it. A new command can
  break nobody.
- **The two operations are genuinely separable.** A host that queues deliberately — a
  multi-prompt workflow, an orchestrator feeding a child session — wants the run
  stopped and the queue kept. That is inexpressible if `abort` always clears.
- **The TUI already composes them as two steps**, two calls in one handler
  (`input-controller.ts:1672` then the abort). A command mirroring that composition is
  easier to reason about than one that fuses them.
- **Nothing is lost.** A host wanting the fused behaviour writes two frames.

If maintainers prefer fusion, a flag preserves compatibility and stays additive —
`{ "id": "…", "type": "abort", "clearQueue": true }`. A bare semantic change to
`abort` does not.

### Compatibility and maintenance

- **Additive.** An older server answers `Unknown command: clear_queue`, which a host
  can tolerate or feature-check. No existing frame changes shape; no `protocolVersion`
  bump is implied.
- **No new state.** The command calls one existing method; nothing new to keep in sync.
- **Testable in isolation.** The existing TUI tests already assert
  `clearQueue({ forInterrupt: true })` empties the steering queue
  (`test/input-controller-skill-queue.test.ts:595-629`). An RPC-level test can assert
  the same through the new command, plus a regression test that `abort` followed by a
  queued steer emits no second `agent_start`.

### Files that would change

| file | change |
|---|---|
| `packages/coding-agent/src/modes/rpc/rpc-types.ts` | one `RpcCommand` union member; one success-response union member |
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts` | one `case "clear_queue"` in the dispatch switch |
| `packages/coding-agent/src/modes/rpc/rpc-client.ts` | optional — a `clearQueue()` wrapper beside the other command helpers |
| `packages/coding-agent/test/…` | one RPC-level test; one regression test that a queued steer does not resume after abort |

No change to `agent-session.ts` or `agent.ts`: the behaviour being exposed already
exists.
````

When it lands, Dray's side is one command on the request surface and Stop becomes
`clear_queue` then `abort` — which is what the pi harness already does. Until then the
omp transport does not steer (§7), and this section is what gets deleted.

## §16 Where the build is

**Not started.** No harness code is written; the captures are in this session's
scratch directory and the first commit of slice 0 brings them in.

Linear: **no issue yet.** The MCP server was not available in the session that wrote
this, so the issue still wants creating — `DRA-` prefix, team `Dray`, assigned to
`yogesh`, and this document linked from the description.
