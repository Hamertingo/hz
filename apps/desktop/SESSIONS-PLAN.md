# One child, many sessions

**Status: measured and designed, not implemented.** The numbers below were taken
on the shipped launcher, and the reason nothing was written yet is at the bottom
— it is not a shortage of time, it is that the failure this change can introduce
is one I cannot observe without the app running.

## What it is worth

Measured: five sessions, one child each (what hz does today) against five
sessions on one child.

| | time | memory |
|---|---|---|
| five children, one session each | **5.77s** | **1775MB** |
| one child, five sessions | **1.57s** | **404MB** |
| | **−73%** | **−77%** |

And the shape of it is the point, not the totals:

```
one child, 5 sessions      initialize 1.46s, then 0.03 / 0.02 / 0.02 / 0.02 / 0.02s
five children              initialize 0.94–1.25s + session/new each
```

**The first session pays the boot; every one after it costs two hundredths of a
second.** Today each pays ~0.86s and ~380MB. A cold child is ~400MB resident and
the boot is CPU, not network — V8 parsing the bundle — which is also why the
compile cache (`0.20.11`) took a quarter to a half of it and why that is the
ceiling on shaving the boot further.

This is the largest single lever found anywhere in this work, and it is hz-side:
`HZ_SESSION_ID` being fixed at spawn is this repository's decision, and the agent
already supports many sessions per process — `mcode/session/steer` takes a
`sessionId` per request, and `session/new` answers in 0.02s on a warm child.

## The design

**A child registry, keyed by project.** One child per project, shared by every
session whose project it is.

*Why per project rather than global:* sessions of one project are the ones a
reader runs at once, so the gain is nearly all of it; and a child that dies takes
its own sessions down and nobody else's. A global child is the maximum gain and
the maximum blast radius, and the difference in practice is small.

**Routing moves from "the read loop's session" to "the event's session".** This
is the whole of the work. Today a read loop belongs to one session, so every
notification it sees is that session's and nothing has to be routed. A shared
child breaks that assumption in every direction:

- `session/update` notifications carry their own `sessionId` — ACP requires it —
  so the loop can route by it, and `read_stdout` must take the manager rather
  than a session.
- Anything the loop writes back per session (the log append, the retained events,
  `seq` numbering, status transitions, pending permissions and questions, the
  queued-prompt flush, the coalescer's blocks) has to be looked up by that id.
- A notification naming a session this process does not know — a session from a
  previous hz, or one deleted while a turn ran — must be dropped rather than
  panic, exactly as an event for an unknown session already is on the frontend.

**What does not change:** everything per session stays per session. The model,
effort and stance are already per *session* in ACP (`session/set_config_option`
takes an id), so a shared child can hold sessions on different models — which is
also why switching either does not respawn today and must not start now.

**When a child dies**, the registry drops it and every session it served goes
back to the state `send_msg` already handles: an id known, a process gone,
re-open the CLI's own session on the next send. That path exists and is tested;
this change makes it the *only* recovery path a session has, which is why it has
to keep working.

**The park becomes an optimisation, not the mechanism.** It exists to hide the
boot; with a shared child the boot is paid once and stays paid, so the park
matters only for the very first session. Keep it, and keep its single slot — the
memory argument for one slot does not change.

## How, in the order it has to happen

**One consequence the design above does not cover, and it changes the shape:**
`HZ_SESSION_ID` is an environment variable, fixed **at spawn**, and the `hz` CLI
reads it as the session a call defaults to (`hz issue link` with no id, most of
all). A child serving five sessions has one environment, so four of those five
lose the default — an agent in session B filing a link against session A, or
against nothing. That is a wrong write that answers `ok`, which is the failure
class this repository keeps paying for. Two ways out, and the second is better:

1. Give the shared child the **project** as its identity (`HZ_SESSION_ID` empty,
   `hz` refusing to default) — honest, and every caller passes an id.
2. Move the default out of the environment: `hz` resolves it from its parent
   process or from an explicit `--session`, so a child's identity stops being
   what a *session* is identified by. This is the one that removes the coupling
   rather than documenting it.

Until that is settled, sharing a child is not ready, whatever the routing does.

Then, in this order, each step landing on its own and compiling:

0. **The seam already exists, and it is `ReaderHandles`** (`mcode.rs:1228`) —
   an owned struct the read loop is handed. Reading it changes the shape of the
   three steps below, because it holds **two lifetimes of state in one struct**:

   | per **child** (shared by every session it serves) | per **session** |
   |---|---|
   | `client`, `stderr_tail`, `app` | `session_id`, `session_cwd`, `pending`, `pending_questions` |
   | | plus the four to add: `events`, `seq`, `status`, `queued` |

   The transport reads and the stderr tail belong to the process; the queue, the
   sequence, the retained events and the pending cards belong to a conversation.
   The read loop needs the pair for one event, so the registry stores the second
   column and the loop keeps the first.

1. **The four handles join `ReaderHandles`**, and `Session` holds the same value
   rather than the four fields — one shape instead of two, which is the
   unification `session.rs` already asked for in a comment about `Ingest`. The
   edit is small and now measured: **twelve** `self.events`/`self.status`/
   `self.queued`/`self.seq` sites in `session.rs` (2155–2559), and **nothing
   else** — the hits at 274–329 are `StatusTracker`'s own fields and a blind
   rename breaks them. `cargo test` is the gate.
2. **The registry**, `Mutex<HashMap<String, SessionHandles>>` keyed by the
   agent's session id, filled where the handshake hands a session over. Still
   one child per session, still one handle set in it. `cargo test`.
3. **`read_stdout` routes by the event's session id**: `params.sessionId` for a
   `session/update`, the same field the goal and delegation notifications carry.
   With the registry holding one entry this is a lookup that always answers the
   same thing — which is what makes it verifiable *before* anything shares a
   child. `cargo test`, and the app behaving identically in one session.
4. **The unknown-id drop**: a notification for a session this process does not
   hold is dropped, not panicked on. Tested by feeding `read_stdout` a line for a
   stranger, which is the shape a session from a previous run leaves.
5. **The registry keys by project**, and `send_msg` asks it for a child before
   spawning one. This is the step that changes behaviour, and the live checklist
   below is its gate.
6. **The park follows**: it stays single-slot, but it now hands its child to the
   project's registry rather than to one session.

Steps 1–4 are invisible and provable here. Step 5 is the one that needs the app
running, and it is deliberately last so that everything before it can be trusted
first.

## What has to be verified, and cannot be from here

The failure this can introduce is **silent**: two sessions' events crossing in
the read loop corrupts transcripts, and a transcript is the one thing this app
never loses. The Rust tests and the ACP handshake cannot see it — the handshake
proves the *agent* serves many sessions, which is already true and already
measured; the routing is hz's, and it is only exercised by the app with two
concurrent sessions.

So the verification is (with the `HZ_SESSION_ID` question above settled first, or a prompt in the second session is where it will show):

1. `pnpm tauri dev`, two sessions in one project, prompts in both, and both
   transcripts read correctly — interleaved turns included.
2. Permission cards raised by both sessions, answered out of order.
3. One session deleted while the other runs.
4. The child killed with `kill -9`, then a send in each surviving session.
5. `cargo test` — including the fixture-based mapper tests, which is where a
   routing mistake shows up as the wrong session's event.

Until those run, this stays a plan. It is a rewrite of the assumptions in a
3,300-line file whose bugs are silent, and shipping it unverified would be the
one thing worse than shipping it late.
