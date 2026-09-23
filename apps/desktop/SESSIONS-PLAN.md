# One child, many sessions

**Status: landed in the tree, and unverified where it counts.** Steps 1–6 are
written and the app's own suite is green (636 tests, clippy `-D warnings`); the
checklist at the bottom is what has not run, and it is the only thing that can see
the failure this change can introduce. The numbers below were taken on the shipped
launcher.

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

### The identity question, settled by measurement

**A shared child has one environment, so `HZ_SESSION_ID` cannot name five
sessions — and the process tree cannot either**: two conversations on one child
are both descendants of the same agent process. Probed against the shipped
0.4.12, the field that *is* per-conversation is the agent's own id (`mvs_…`):
ACP stamps it on every session-scoped line, including both of the agent's own
pushes — measured, `mcode/session/goal_update` and
`mcode/session/delegation_update` carry `params.sessionId`, so the read loop's
routing rule is one field and needs no special cases.

So the identity travels with the *turn*, not with the process:

- **The agent exports `HZ_SESSION_ID` into every tool child.** The hook is
  `@hz/agent-core`'s `sanitizeBashSubprocessEnv` — the one function all four bash
  spawn sites already pass through (foreground `LocalBashTool`, its sandbox
  variant, the background executor, the pi-turn-runner fallback) — and the value
  comes from the turn's own context (`ctx.sessionId`, `input.identity.sessionId`),
  which is the same string ACP returns as `sessionId`. `HZ_*` is on no strip
  list, so layer A cannot eat it; `strict` mode does not match it as a
  credential; both are pinned by test.
- **The app resolves what it names.** `store::session_named` reads either
  spelling off the pairing the index already carries (`thread_id`), and every
  handler that takes a session address — create's parent, list's parent, send's
  target and sender, link, browser — goes through one funnel in `orchestration`.
  The CLI and the skill did not change.

### Landed

- **1. `SessionHandles`** — one value for the per-session column (`session_id`,
  `session_cwd`, `events`, `seq`, `status`, `queued`, `pending`,
  `pending_questions`), held by the session, by the read loop and by the routing
  table; `Ingest`, `flush_queued`/`flush_acp`/`deliver_batch`/`deliver_prompt`/
  `report_*`/`strand_queue_on_exit` all take it rather than eight loose arguments.
- **2–3. The registry and the routing** — a table keyed by the agent's session
  id, filled at the handover and dropped when the child's stdout ends
  (identity-checked, because a resume reuses the key a draining child still
  holds), and a read loop that files every line by the id it carries.
- **4. The drop** — a line naming a session this process does not hold is
  dropped, not filed elsewhere; a *request* for one is refused rather than
  dropped, since a request left unanswered stalls the asking turn.
- **The agent patch and the app-side resolution** — as above, with the funnel's
  own test in the agent's suite and `session_named`'s in the store's.

### Steps 5 and 6: landed

Coded, and the app's own suite is green (628 tests, clippy `-D warnings`). The
shapes below are what shipped, with two additions the code forced:

- **The registry is keyed by the project root, and the child always spawns
  there** — never in a session's tree. One child serves several trees
  (`session/new` names the cwd per conversation), and the key has to be one
  string for a create and a resume of the same project, which is what
  `item.project_path` is. Both `Session::init` call sites now pass it.
- **A session whose child has died is no longer live**, and `send_msg` falls
  through to the resume path for it: the registry is the only thing that
  notices a child dying, and re-opening the CLI's own session on a fresh child
  is the recovery. Before this, a crashed child needed a settings change to
  trigger one.
- `child_pid` answers `None` for a child carrying more than one session, since
  its descendants are then every session's; the browser's local-server list
  keeps the checkout test as its signal and this one as the tie-breaker.

### Step 5: the shapes, as built

**`Agent` owns the process; a conversation is what a session holds.** The
registry cannot key on the session any more, so:

```rust
pub struct Agent {                  // in mcode.rs, one per project
    pub project: String,            // the table's key: the spawn directory
    process: AsyncMutex<Option<Child>>,   // taken once, by whoever tears it down
    client: RpcClient,              // the pipe every conversation writes on
    live: AsyncMutex<HashMap<String, Live>>,   // by the agent's session id
}

struct Live {                       // per conversation, and nothing here can be
    handles: SessionHandles,        // shared between two of them
    session: McodeSession,
    mapper: mapper::Mapper,         // numbers *these* events, remembers *these* subagents
    coalescer: Coalescer,           // holds one block's text
}
```

- `Session` loses `child` and gains `agent: Arc<Agent>`; `kill()` becomes
  "close my conversation — `session/close` — and kill the process only where I
  was the last one on it" (`retract` takes the process out of the registry by
  identity, then `shutdown` gives it the grace it already gives).
- `init` gains a branch: a live `agent_for(project)` means **open a conversation
  on it** (handshake omitted, `session/new` at ~0.02s) rather than spawn. Since
  the child is spawned at the project root and `session/new` names the cwd per
  conversation, a worktree session shares its project's child and still runs in
  its own tree.
- The read loop loses `ready_rx` entirely (the registry is the hand-off), keeps
  one `read_stdout` per child, and routes each line to a `Live` under a lock held
  only for the synchronous part — mapping and coalescing — with the awaits (log,
  status, flush) outside it.
- **One race needs its own rule**: the agent pushes a session's settings and
  command list on the heels of `session/new`, so the loop can read one before the
  app has registered the id. That window is microseconds wide and the line is the
  composer's command menu, so the loop waits `CLAIM_GRACE` (200ms, 10ms beats) for
  the entry before giving up on the line.
- The park becomes trivial: `spawn_agent` registers its child as it always
  registers, so adoption is today's `adopt` plus "the table already holds it" —
  and the parked child then serves every later session of that project.
- `HZ_SESSION_ID` is no longer set at spawn (there is no single session to name);
  the agent's per-turn injection is the only channel, and an older CLI in that
  child refuses the default rather than naming the wrong session.

## What has to be verified, and cannot be from here

The failure this can introduce is **silent**: two sessions' events crossing in
the read loop corrupts transcripts, and a transcript is the one thing this app
never loses. The Rust tests and the ACP handshake cannot see it — the handshake
proves the *agent* serves many sessions, which is already true and already
measured; the routing is hz's, and it is only exercised by the app with two
concurrent sessions.

So the verification is — and it needs the app running **as the reader's own
user**, because the dev socket is `0600` and a root-run instance is not something
a `hz` from this shell can reach:

1. `pnpm tauri dev`, two sessions in one project, prompts in both, and both
   transcripts read correctly — interleaved turns included.
2. Permission cards raised by both sessions, answered out of order.
3. One session deleted while the other runs.
4. The child killed with `kill -9`, then a send in each surviving session.
5. `cargo test` — including the fixture-based mapper tests, which is where a
   routing mistake shows up as the wrong session's event.

Until those run, this is not something to ship. It is a rewrite of the assumptions
in a 3,300-line file whose bugs are silent, and shipping it unverified would be
the one thing worse than shipping it late.
