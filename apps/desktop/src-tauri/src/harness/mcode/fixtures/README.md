# mcode fixtures

Real `mcode acp` stdio, captured **both directions**, one line each: `>> ` is what
hz's probe wrote, `<< ` is what mcode answered. A capture recording only what
mcode said would lose half the protocol — a permission request is a request *we
answer*, and the prompt's own response is how a turn ends.

Both were captured against **MiniMax Code 0.4.12** (`mcode --version`), from the
source checkout at `/Users/hamerti/Desktop/Projects/minimax-code` run as
`node dist/cli.js acp`, in a scratch repo under `/tmp/hz-mcode-probe`. The active
model was a BYOK one (`custom_provider:opencode-go`, `deepseek-v4.1-flash`), which
is why no capture carries a `thinkingEffort` option — see the row below. Nothing
is edited. `shared_rules.json` is the one file here that is written by hand
rather than captured, and the row for it says so.

| file | what it pins |
|---|---|
| `live_turn.jsonl` | The whole lifecycle at its smallest: `initialize`, `session/new` with its `configOptions`, one prompt writing `hello.txt` and running `wc -c hello.txt`. It is where four facts come from. **The agent takes no images** — `promptCapabilities.image` is `false`, measured, which is what `Model.accepts_images` is built from. **The session id is mcode's** (`mvs_…`), minted by `session/new`; there is no `--session-id`. **A call announces itself without its arguments**: `tool_call` carries `toolId`, `title`, `name` and `kind` and nothing else, and `rawInput` arrives on the `tool_call_update` behind it — the opposite order to fx, and the reason the mapper commits a row on the update rather than on the announcement. And **`rawOutput` is mcode's own shape**, `{"type":"text","text":…}` beside the update's ACP-shaped `content` array, with the machine-readable half in `details` (`{created, bytes_written, encoding, bom}` for the write, `{envSanitized, status, task_id}` for the shell) — which is what `ToolResult.structured` is filled from. Also the only capture of `available_commands_update` (ten commands), of `usage_update` carrying a `cost` in USD beside `used`/`size`, and of the two `modes` mcode opens with, `default` and `plan`. |
| `todowrite.jsonl` | A turn that keeps a plan, which is what the strip, the panel and the transcript's plan rows are drawn from. **The list rides the call's `rawInput`, under `todos`** — `{content, status, priority}` per row — and the same list comes back on `rawOutput.details.todos` beside it. It also shows the shape a call really has: **80 bare `{toolCallId}` updates** arrive between the announcement and the one carrying the arguments, which is why nothing is drawn for an update that says nothing. |
| `resume_fork_cancel.jsonl` | The three lifecycle calls a live turn never reaches, in one session. **`session/resume` answers with `modes` and `configOptions` and no `sessionId`** — the recorded id stands — where `session/fork` answers a **new** `mvs_…` and the whole ladder beside it: that is the whole of what a fork costs here, and the reason `fork_needs_cli` is false. **`session/cancel` is a notification**, carrying no id, and the turn ends as the prompt's own response with `stopReason: "cancelled"` — which is why the mapper reads `cancelled` as a success carrying a reason nothing draws, the reading every ACP harness here makes. |
| `shared_rules.json` | **Not a capture, and not about mcode's wire**: hand-written inputs and expected answers for the three rules both languages state for themselves — the session's branch, the route to a harness's fast mode, and the stances mcode has. It sits here because this directory is where the two suites already meet over one file: `cargo test` reads it through `src-tauri/src/shared_rules.rs` and the frontend through `src/lib/{pr,mcode}.test.ts`, so an implementation that drifts from its other-language copy fails a suite instead of a hand-copied case. |

| `context_report.txt` | **The agent's own context breakdown, which ACP does not send as data** — the answer to `/context` when it is sent as a prompt. The turn is intercepted by the agent's command layer rather than by a model (it ends in about a second with `end_turn`, no tokens spent) and the answer is one field per line: `Context: live`, `Model:`, `Budget: 21,243 / 1,000,000 tokens (2%)`, `Compaction:`, then a `Components:` list of `- Label: 1,234 tokens`. That list is the six categories its TUI draws — System prompt, Memory, Tools, Skills, Messages, Other — computed from runtime state no client is sent, so the command is the only door to them. `harness/mcode/context.rs` reads exactly this block, and the composer's panel asks for one when it opens. |

## The three agents on the reader's own install

`claude_new_session.jsonl`, `codex_new_session.jsonl` and
`opencode_new_session.jsonl` are the `initialize` and `session/new` exchange of
each ACP agent, captured the same way (`>> `/`<< `, both directions), **no prompt
sent, so no model was called**. Versions: `@agentclientprotocol/claude-agent-acp`
0.94.0, `@agentclientprotocol/codex-acp` 2.2.2 and OpenCode 1.19.0 (`opencode
acp`). They are what `dialect.rs` and `models::from_acp` are written against, and
they pin four facts that differ per agent: the **ids** of the model, effort and
stance options (`effort` / `reasoning_effort` / none), the **stances** each offers
(Codex's plan is a separate `collaboration_mode` option), that **OpenCode has no
effort option at all**, and what `initialize` advertises — `fork`, `resume`,
`close`, image prompts and `mcpServers` over http on all three.

**Two things in them are edited, and only those two:** every account e-mail the
agents reported in their `_auth/status_update` notices is replaced with
`reader@example.com`, and the temporary working directory with `/tmp/hz-probe`.
The model lists are the capturing machine's own, so a reader with another login
sees other rows; the tests assert the *shape* (ids, ladders, counts that follow
from the capture) and not that a given model exists for everyone.

Two things no capture carries yet, both because the machine's active model has no
`effortOptions`: **a `thinkingEffort` option** (mcode builds it only for a model
that reasons, its id read off the CLI's own `ACP_CONFIG_THINKING_EFFORT`), and
**a permission request** (`permissionMode` was `bypassPermissions` throughout, so
nothing was ever held). `models.rs` and `permissions.rs` are written against the
CLI's source for those two, and their tests build the shapes by hand rather than
pretending a capture has them. Re-capture on a machine set to `default` and
running a MiniMax managed model, and both rows above should gain a file.

Probe scripts: `/tmp/mcode_probe.py` (live turn), `/tmp/mcode_probe2.py`
(resume/fork/cancel), `/tmp/acp-cmd2.py` (a prompt, then `/context`) — not committed, twenty lines of `subprocess` each. The
captures are the artefact.
