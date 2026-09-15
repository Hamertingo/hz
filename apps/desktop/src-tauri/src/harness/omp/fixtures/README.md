# omp fixtures

Captured from **`omp 18.1.20`** (Homebrew, `/opt/homebrew/bin/omp`, macOS arm64)
on 2026-09-15, by driving `omp --mode rpc --no-session` over stdio and recording
every line it wrote.

These are **stdout only**. pi's fixtures wrap both directions in a `{dir, line}`
envelope because pi is a peer and a capture of one side loses half the protocol.
omp is the same kind of peer, and the reason these are unwrapped is narrower: the
commands that produced them are four lines long and are recorded below, so the
inbound half is reproducible rather than stored.

## What each capture is

| file | how it was made |
|---|---|
| `handshake.jsonl` | `get_state`, `get_available_models`, `get_commands`, `get_session_stats` sent in one batch on a fresh child |
| `turn.jsonl` | one prompt — *"Reply with exactly one word: pong"* — and nothing else |
| `tool_approval.jsonl` | one prompt asking for `bash echo dray-omp-probe`, with `--approval-mode always-ask`, and the approval **answered mid-flight** so the turn runs to its close |
| `steer_abort.jsonl` | a prompt, then `steer`, then `abort` — the sequence that shows a stopped run resuming from the queue |

The `steer_abort` one is the reason it is here rather than only in `OMP-PLAN.md`:
it is the corpus that pins `abort` leaving a queued steer to run, and a mapper or
transport that reads it otherwise fails this fixture rather than a review.

## What was elided, and why

Two payloads are trimmed so the corpus stays a corpus. **Neither changes any
parse result** — every frame still lands on the same variant — so the assertion
in `parser::tests::every_captured_line_is_modelled` still means what it says.

- **`available_commands_update.commands` is cut to its first three.** omp pushes
  the whole list — 54 commands on this machine, each with `subcommands`, and with
  an identical copy sent **three times in one turn**. The frame's shape is what
  the parser models; the list is what made the file 700 KB.
- **`assistantMessageEvent.partial` is dropped from every `message_update`
  except `toolcall_start`.** It is the assistant message *as it stands*, resent
  on all ~190 streaming frames, and it is the bulk of a real capture. Exactly one
  reader depends on it — the tool row's header, which reads `id` and `name` out
  of the block at `contentIndex` on the frame that first names them — so it is
  kept there and nowhere else.

`get_state.model` is also reduced to six keys and `systemPrompt` emptied, for
`handshake.jsonl` alone: the full model object carries a ~30-field
provider-compat blob that no reader here touches.

## What is **not** here

`get_commands` was removed from omp's RPC entirely and answers
`{"type":"response","command":"get_commands","success":false,"error":"Unknown
command: get_commands"}` — **with no `id`**, which is its own trap and is
asserted in `parser.rs` from a literal rather than from a capture.

Three more come from `docs/rpc.md` and are asserted from literals for the same
reason, each stated where it is used: an `agent_end` with no `isTerminal`, a
`prompt_result` carrying `agentInvoked: false`, and a `toolcall_start` with no
`partial`.
