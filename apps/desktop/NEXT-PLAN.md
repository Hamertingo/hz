# What is worth building next

**Status: a plan, nothing coded.** Ten items, ordered by how much they change the
product rather than by how much work they are, with two defects the reader
reported recorded ahead of them — a bug outranks a feature, and one of the two
already has its cause located. Everything else that was looked at is in
[the last section](#looked-at-and-left-out), so the filter is on the record.

The numbers below that are not hz's own come from two competing apps read in full
— MonoCode and Zeron — and are marked with their source. Both are MIT. The
measurements are theirs, taken on their code; they are evidence that a problem is
real and that a fix works, not a claim about what hz will measure.

A note on the ordering: item 1 is the largest functional hole, item 2 is the one
that makes the app honest, 3–4 are the two things that separate "a chat with an
agent" from "a tool you leave running", 5 is the transcript holding up under a long
session, 6 is small but rides on 4's mechanism and is the piece neither competitor
has, and **7–10 were written after reading the chat, command and sidebar surfaces
in full** — they are the places where the app is missing something specific rather
than something large. Of those, 9 is almost entirely a matter of how existing
things are drawn, with one component swap, and 10 finishes a decision the app
already made in its own icon component. **Item 5 carries a correction that pass
produced**, and the last section lists what it found already built.

**And one section is unnumbered, ahead of all of them: [Orchestration](#orchestration-the-subagents-made-worth-building-on).**
That is the reader's priority and it is one subject rather than one of a ranked list,
so giving it a number would have put it behind eight things that matter less. It is
also the only section here written from cousin code — hz's agent and `oh-my-pi` are
both forks of `pi-mono`, so its recommendations are a diff rather than a reading.

---

## Reported, and worth fixing before any of it

### A goal's elapsed time resets when the reader switches away and back — fixed

**Cause, located.** `GoalControl.tsx`'s `useElapsed` kept its baseline in component
state — `{ seconds, at: Date.now() }` — filled from a `useEffect` depending on
`[seconds, goal?.goalId]`. **An effect runs on mount as well as on a change**, and
switching chats unmounts this band, so coming back re-ran it and stamped `at` with
the current clock. Everything the local tick had accumulated since the runtime's
last `goal_update` was discarded, and the number fell back to the last pushed
`timeUsedSeconds` to climb again from there. Leave for two minutes and the goal
appeared to lose two minutes.

The push is the only thing that *sets* the number, and the local offset is what
carries it between pushes — so the interval thrown away was exactly the visible one.

**Fixed.** The baseline is a module-level map keyed by `goalId`, read rather than
restamped on mount and re-anchored **only when a push actually moves `seconds`** —
so a remount, a chat switch and a re-render all find the clock where they left it.
An entry is dropped once the goal is no longer `active`, so a later goal cannot
inherit a stale anchor, and the map is capped so a session running many goals cannot
grow it without bound. Only a genuinely new anchor is written, since setting the same
object back would reorder the map and evict a running goal ahead of a finished one.

The decision moved to `lib/goalClock.ts` with a test, because this is precisely the
shape this repo tests for: logic whose wrongness is invisible for as long as the
reader stays put, and only leaving the chat shows it. Seven cases, the first of them
being the bug — a remount carrying an unchanged figure.

### Delegated subagents come back with nothing — fixed

**Root cause, confirmed by the reader reproducing it.** Dispatching any subagent —
`explore` and `worker` alike — died before its first tool call with:

```
error_message: contextWindow from task-parent-session requires a catalog physical limit.
```

`changed_files: none`, and identical for both agent types, which is the tell: the
model and its window come from the **parent session** rather than from the agent
type, so nothing about the task could have changed the outcome.

**The refusal was a resolver asking a question it already had the answer to.**
`agent-model-selection.ts` resolves a window by clamping a *requested* value against
the catalog's *physical limit* — correct in itself, and it still refuses a
**configured** window nobody can bound. But a task child's window is not a claim: it
is inherited from the session that spawned it, and that session is running that very
model. `resolveLimit` read "the catalog is silent about this model's ceiling" as "this
number cannot be trusted" and threw — so a gap in a catalog became an outage in
delegation.

**Fixed** by taking the inherited value as its own bound: `effective = requested`. It
reports no diagnostic as a consequence rather than an omission — nothing was clamped,
so there is nothing to report *about*, and the existing no-clamp path already returns
an empty list. A configured window is still refused exactly as before, and the test
that pins that refusal now sits beside an assertion that the same request, inherited,
resolves instead. Verified: 470 tests across `model-system`.

**The lesson, which is worth more than the fix: an inherited fact is not a claim to
be validated.** A catalog is the authority on what a model *may* do; it is not the
authority on a number observed from a session already doing it, and treating silence
as suspicion turned the second into the first.

### And a second defect found on the way: every session's first five lines were dropped

**Reproduced from the app's own log — which is what the sink in item 2 was for.**
`~/.hz/hz.log`, written by the stderr tee, carried the same five lines once per
session, for every session, at the moment each one opened:

```
[mcode route] dropped a line for mvs_<id>, which this child does not carry
```

**Cause located.** `route` waits for a session it cannot file yet, but only under
`wait_for_registration`:

```rust
fn wait_for_registration(named: Option<&str>, carried: bool, any_live: bool) -> bool {
    named.is_some() && !carried && !any_live
}
```

The `!any_live` clause rests on a premise the same file contradicts two hundred lines
earlier: *"the only sign of a registration in flight is that the child carries nothing
at all yet."* But **a child carries several conversations** — one child per project,
one conversation per session, which is `ReaderHandles`' own opening sentence. So the
grace window only ever worked for the **first** session on a child. Open a second and
the child already carries conversations, `any_live` is true, `wait_for_registration`
is false on the first pass, and the line is dropped **immediately** — which is the
normal path rather than an edge of it.

Those five lines are what ride the heels of `session/new`: the session's settings and
its command list among them. The comment on `CLAIM_GRACE` already names the casualty —
*"the race the composer's command menu was lost to once already"* — and the fix that
landed then handled the first conversation and left every later one.

**And the tree encodes the wrong premise as a passing test:**

```rust
// The child carries something already, so nothing is in flight.
assert!(!wait_for_registration(Some("mvs_1"), false, true));
```

That assertion is the bug, written down, and green.

**The link to delegation, which is why this is the prime suspect rather than merely a
bug next door.** `line_session`'s own doc says the routing rule is one field wide
because *"the goal and delegation pushes"* carry `sessionId` like everything else —
so a delegation roster for a session that has not landed in `live` yet travels
through exactly this function, and meets exactly this clause.

**Confirmed by naming the line.** The message used to read `dropped a line`, which is
why this sat in a log nobody read as five lines of noise. It now names the method, so
the next run says which five are lost instead of leaving it to be inferred.

**The fix, and why not the obvious one.** Deleting `!any_live` would make the wait
correct and make every *stranger* line cost the read loop a whole `CLAIM_GRACE`
(200ms) before being dropped — the exact cost that clause was added to avoid. So the
wait now keys on the thing that actually means a registration is in flight, and hz
knows it first-hand because **it issues the registration itself**.

`Agent` gained one field — `opening`, the moment a registration was last issued —
raised by `mark_opening()` at the single call site of `open_session`, which is where
`session/new`, `session/resume` and `session/fork` are all issued from. `route` asks
the child instead of inferring from how full it looks, and the window closes on its
own: a stranger line still costs nothing, because a stranger arrives long after
`CLAIM_GRACE` has run out.

A moment rather than a counter, deliberately: between the request and the insert into
`live` there are several paths that can fail, and a count would have to be unwound on
every one of them. A timestamp has no cleanup and cannot leak.

**One call site is enough, and that was checked rather than assumed.** `open_session`
has a second caller — `open_control` — but it does not route: it drains its own child
with `client.accept` and discards everything that is not an answer, never reaching
`take_value` or `route`. So the only path that needed the mark has it.

**The test that encoded the bug now asserts the fix.** The case that used to read
*"the child carries something already, so nothing is in flight"* is gone, and the
doc on the test says what replaced it — that whether the child is already carrying
others is not consulted, and must not be.

Verified: `cargo clippy --all-targets -- -D warnings` and `cargo test` (641).

**What this does not prove.** It closes the routing bug and the five lines per
session are gone. Whether those five *were* the delegation roster is what the named
log line settles on the next run — the fix is right either way, and the name is what
turns the answer from an inference into a reading.

**The cheaper check that ruled the other explanation out**, kept because a negative
result is worth as much here: hz's harness waits on
`mcode/session/delegation_update` and the agent **publishes exactly that name**
(`packages/tui/src/acp/agent.ts:1480`), so the two sides agree on the wire and a name
mismatch is off the table.

**And my earlier reading of this was wrong, which is worth recording.** When the
delegation tooling available to whoever builds this plan failed with the same message,
it was written down here as *"a runtime configuration error rather than a bad
prompt"* — an environment quirk, not the product. The reader then reproduced it
through hz itself, same message, same `changed_files: none`. It was never an
environment quirk; it was this bug, seen from the other side of the same API.

The lesson is the cheap one: **a failure you cannot yet reproduce inside your own
product is still worth reading as your own product's failure**, because the
alternative is filing it as somebody else's and moving on — which is what happened
here, twice, until the second reproduction made it undeniable.

### A file link in a message opens "No file at this path." — fixed

**Cause, located.** An agent's prose carrying a *relative* path is turned into a
link and resolved against the session's `cwd`: `markdownPlugins.ts`'s walk runs
`findPromptPaths`, which includes the relative scan, and `Markdown.tsx` hands the
match to `absolutePath(title, cwd)`. But an agent writes a path against whatever
directory **it** was in, and that is not the same thing as the session's cwd. It
`cd`s into a subdirectory mid-turn (`cd apps/desktop && …`) and then names
`src/lib/highlight.ts`; or it names a path from the repository root while the
session itself runs inside a worktree. `cwd` plus that is a path that does not
exist, the read in `files.rs` fails, and the panel answers "No file at this path."
— about a file that is right there, one folder over, which is exactly how it reads.

**Nothing on screen warned that the link guessed.** An absolute path is the agent's
own and either opens or does not; a relative one is *resolved*, and the resolution
is invisible until it is wrong. That asymmetry is the whole of why this was
annoying rather than merely broken.

**Fixed, and the check moved to the click because that is the only place it can
happen.** Draw time is synchronous and runs on every streamed delta, so it can never
touch the disk; the click runs once and can. `FileLink` takes a new `raw` prop —
present **only** on the relative branch, so an absolute path still opens exactly as
drawn with no round trip — and resolves through a new `resolve_named_path` command
before dispatching to either the Docs panel or the reader's editor.

That command tries three bases, cheapest first:

1. the path as given, which answers an absolute one that exists;
2. `cwd`, then the **project root** — the second is the worktree case, and it costs
   one `stat`;
3. the **file index** the app already keeps (`index_for` / `search_files`), for the
   commonest case of all: the agent had `cd`-ed somewhere and named the path from
   there. The longest suffix matching **exactly one** indexed file wins.

**A suffix matching twice is `None`, not a guess** — opening the wrong file is worse
than a click that does nothing, which is the direction this whole rule is written to
be wrong in, the same bargain `continuesPath`'s caller already makes. Where nothing
resolves, the drawn path is opened unchanged, so the worst case is the behaviour
that was there before.

One case got better rather than merely fixed: a relative name with no `cwd` at all
used to draw an inert span, and now draws a link — the resolver has the project root
and the index as well, and one of them is usually the folder the name was written
from.

**Landed in** `files.rs` (`resolve_named_path`), `FileLink.tsx` and `Markdown.tsx`.

---

## Orchestration: the subagents, made worth building on

**The reader's priority, and unnumbered on purpose.** The items below are ordered by
size; this is one subject, and giving it a number would put it behind eight things
that matter less.

**The finding that changes the method: hz's agent and `oh-my-pi` are both
descendants of `pi-mono`.** So this is not porting a design from a stranger — it is
reading the **delta between two forks of one ancestor**, which is exactly the set of
things the other fork learned after the split. That is a far better position than the
lead-agent item this replaces was in: it argued from a competitor's product surface,
and this argues from cousin code.

**And hz already has the thing, in miniature.** The agent ships its own subagent
machinery, prefixed `local-`:

| hz | lines |
| --- | --- |
| `agent-tools/src/desktop/local-task.ts` | 141 |
| `…/local-task-append.ts` | 103 |
| `…/local-task-control.ts` | 220 |
| `…/task-verification.ts` | 137 |
| `local-runtime/src/background-task/task-waiter-registry.ts` | 70 |
| `local-runtime/src/review/subagent-result.ts` | 39 |
| `local-runtime/src/api/local-task-{host,subagents}.ts` | 116 |

And the same concepts in `oh-my-pi`:

| omp | lines |
| --- | --- |
| `task/executor.ts` | **4,409** |
| `registry/persisted-agents.ts` | 834 |
| `registry/agent-lifecycle.ts` | 607 |
| `registry/agent-registry.ts` | 369 |
| `task/persisted-revive.ts` | 259 |

Roughly **eight times the code**, and the gap is not volume — it is that theirs has a
*lifecycle* and hz's has a *spawn*.

### The delta, in the order it matters

**1. A subagent stops being disposable.** `AgentLifecycleManager` "owns the
`idle → parked → revived` lifecycle": a finished run goes `idle` with its session
still live; a TTL parks it — session disposed, transcript kept — and a message
**revives** it. Their doc states the payoff directly: *"Prefer messaging an existing
agent over a fresh spawn for follow-up work: it already holds the relevant
context."*

**Corrected after reading hz's own code, because this section first claimed hz had
none of it and that is wrong.** A task child is a *persisted session* —
`sessionKind: 'task'`, `parentSessionId`, `visibility: 'hidden'` — and the roster is
built from the store, not from memory: `collectTuiDelegatedSessions` walks paged
`listSessions` for every session whose parent is the root
([delegation.ts](../../apps/agent/packages/tui/src/runtime/delegation.ts#L31),
[delegation-access.ts](../../apps/agent/packages/tui/src/runtime/adapters/delegation-access.ts#L28)),
and `notifyDelegationUpdates` pushes that snapshot to an attached client
([agent.ts](../../apps/agent/packages/tui/src/acp/agent.ts#L1461)). And a finished
child can already be messaged: `task_append` resolves `childSessionId` and, when the
child is idle, **activates a new Turn** on it
([local-task-append.ts](../../apps/agent/packages/local-runtime/src/api/local-task-append.ts#L142)).
So the row is not gone after a restart and the follow-up is not a fresh spawn of a
new child.

What is genuinely missing is the *lifecycle*, which is why this is still the item:
nothing keeps a child **warm** between Turns, nothing **parks** one (`park`, `revive`,
`idleSince`, any TTL at all: measured, zero hits across `local-runtime/src`), and the
three ordering rules below have nothing to order. *Unverified in the app*: that the
desktop roster repopulates on reopen — the agent's side is store-derived and pushes
on attach, but I did not watch the app do it.

Three rules in that file are worth copying verbatim, because each is a bug not
written:

- **Commit the detach and the `parked` status *before* disposing**, "so callers never
  see a dying session" through `ref.session` or an `idle` status. Ordering, not
  synchronisation.
- **Coalesce concurrent revives**, each bound to the parked ref that asked, so two
  callers arriving at once get one session rather than two.
- **Reclaim a provably-dead parked corpse** so a fresh spawn can reuse its id —
  refusing live, adopted, in-flight and cold-revivable refs, which is what keeps the
  reuse from stealing a session somebody is about to want.

`persisted-agents.ts` (834) is the half that makes all of that survive a restart, and
`persisted-revive.ts` (259) is the reviver built for a ref restored *from disk* —
the piece hz has no version of at all.

**2. A child cannot end without producing something.** omp hides a `yield` tool the
child must finish through, allows three reminders, and on the last forces
`toolChoice = yield` where the provider supports it; without it the parent is told
`SYSTEM WARNING: Subagent exited without calling yield tool after 3 reminders.`
`finalizeSubprocessOutput` then reconciles raw text, the yield payload, a caller's
JSON schema and an abort state into one result. hz has `task-verification.ts` (137) —
the same instinct without the escalation — and no contractual exit.

**This is the most likely cure for the reported defect.** A child that can end
silently is indistinguishable from a child that has not produced yet, and that
indistinguishability is precisely "subagents come back with nothing".

**Landed, in hz's idiom and deliberately smaller than theirs.** No `yield` tool, no
forced `toolChoice`. A tool the child has to remember to call is a contract the child
can still miss, and a provider-conditional nudge is a second contract to keep true.
Three facts and one ask instead:

- **One reminder.** A Turn that *finished* with no report is asked for one, in the
  same conversation — whose context the child still holds, so the recovery costs a
  Turn where a fresh delegation costs the run. `askForReport` is best-effort on
  purpose: a failed reminder leaves the completed run completed, because losing a run
  the child did finish is a worse answer than the silence it was fixing.
- **`exit: 'reported' | 'silent'`** on `LocalTaskRunResult`. Stated for a run that
  finished, absent for one that failed or was aborted: a run that never had the chance
  to keep the contract is not silent, and calling it so would invite the parent to ask
  again.
- **The parent is told what to do about it.** `exit:` sits under `run_status:`, and a
  silent exit prints a notice naming both real routes — `task_append`, or reading the
  member's transcript — because the parent is an agent, and a fact with no next step is
  the same mudez this report exists to end.

**The exit is written down in three places, and one is easy to miss.** The foreground
report and the tool `details` are in the same reply; a **background** child is only
ever read through `task_output`, so `toTerminalProjection` carries the notice too.
Without it an async exit is an empty result under `succeeded` — the same
indistinguishability, one level down.

13 tests, in
[local-task-child-exit.test.ts](../../apps/agent/packages/local-runtime/test/unit/local-task-child-exit.test.ts)
and [task-verification.test.ts](../../apps/agent/packages/agent-tools/src/desktop/task-verification.test.ts).
*Unverified*: that a child of this build ever ends silent in practice. The defect
behind "subagents come back with nothing" was the model limit, not silence, so this is
a contract for a case nobody has watched happen yet.

**3. A budget that delivers instead of a budget that stops.** `MAX_OUTPUT_BYTES =
500_000` and `MAX_OUTPUT_LINES = 5000`, with the whole output still written to
`<id>.md`; a soft request budget of **200** and a **forced stop at 1.5×** whose
purpose is to make the agent *yield its partial findings*; `MAX_YIELD_RETRIES = 3`;
progress coalesced at 150ms over an 8KB tail; and a session-scoped `Semaphore`
**resized in place** from the live setting on every acquire. hz has counts and
timeouts. It does not have a ceiling that turns into a partial answer rather than a
lost run.

**Landed for the half that could be measured, and the measurement changed what the
half was.** hz's ceiling is **time**, not a request count: a policy's `timeoutMs`
becomes `executionDeadlineAtMs`, and `createExecutionBudgetReminder` already tells the
run how much of it is left at every model request. That reminder was measured doing
its job — given a 20s budget and a 40s sleep, the run read `Execution time remaining
at request preparation: N seconds`, dispatched the sleep as a **background** task
rather than blocking on it, and reported what it could and could not verify. So the
soft budget omp keeps for this purpose is already here, and works.

What was missing was the other half: when the model blocks anyway. `createExecResult`
published `output` only for a run that succeeded, so a hard cut returned a status and
nothing else — and two attempts at 25s showed why that is not enough, since both ended
`modelSteps: 1, answerBytes: 0` with the model spending its step on the tool that
outlived the deadline. So the answer rides on **any** status now, and a run that did
not succeed also carries `progress`: the model steps and tool calls it made, and the
operation still running when it was cut.

**And the ceiling a child had none of, decided and landed in its first rung.** A
delegated run is now held to **200 model requests**, told when it crosses, and the
notice tells it to wrap up and report. Requests rather than wall-clock, because a step
that spends ten tool calls and one that spends a hundred cost the same request, and a
child waiting on a slow build has made no progress *and* burned no requests. 200 is a
**ceiling**: a setting may tighten it and never loosen it, and `0` disables the guard.
Only a delegated run is budgeted — a reader's own turn is bounded by the reader, who
can watch it going and stop it.

**And the stop is real now, which is what lets the notice name it.** Three decisions the
request pipeline already understands carry the ladder, so no new machinery: a marker at
the budget, a marker saying the run is **stopped** from 1.5× on every request it is
still allowed, and `abort` once those five are spent. Ending the Turn rather than
asking again is what makes the stop real — and it is also what brings the answer back,
since a Turn that ends still carries the messages it committed.

**Measured, with the budget lowered to 2 and a delegation that asked for a report on
419 files.** The child was stopped before reading any of them, and it **reported
anyway**: `run_status: succeeded`, `exit: reported`, and a ~10k-character
`final_text` that said plainly it had enumerated 419 files, read none, and inferred
every per-file line from filenames. That is the Done-when below, exactly — a run that
hit its ceiling returned what it found rather than being killed empty.

*Unverified:* the `abort` rung itself, and the salvage behind it. The child complied
with the stop, so the run never spent its grace and never had to be ended for it; the
path where a run refuses until the Turn is aborted, and the committed messages are all
the parent gets, has not been watched.

**And the setting exists.** `softRequestBudget` in the agent's config, read where the
Turn's own model policy is read, with the parse's own rule: **`0` is a valid value** —
the one that means the guard is off — which is why its bound is `>= 0` where the context
window beside it needs `> 0`.

**What verifying it cost, and the trap that fell out of it.** A bare `hz-agent` reads
`~/.minimax/config.yaml` — `APP_DIR` is hard-coded to the pre-rebrand directory — while
the app's agent reads `~/.hz/agent/config.yaml`, because the Rust side pins
`MINIMAX_DATA_DIR` to it. A budget written into the file the app owns therefore never
reaches a CLI run, and three attempts were measured against the wrong file before the
path itself was printed. That is its own decision for later: two configs that can
disagree, on every machine with an older install on it.

One measurement lesson, because it cost the most time of anything here: **the runtime
log keeps the `input` of every tool call**, so a `grep` for a log message finds the
greps themselves and reports their text as records. A probe has to write to a file of
its own, which no logger and no echo can pollute — and a claim built on the log without
that is worth nothing.

**4. One field that says what the work *is*.** `solutionSpace` describes how
open-ended a child's problem is — whether the fix is given, or which causes remain
open. The part worth stealing is not the field but its scope: **it is the only input
the child's reasoning classifier sees.** Volume and openness are separate questions,
and hz asks neither.

**5. Isolation with a fallback and a mode.** Nine copy backends (`apfs`, `btrfs`,
`zfs`, reflink, `overlayfs`, `projfs`, block-clone, `rcopy`) resolved by a PAL with
fallback; patch mode or branch mode; and isolated agents deliberately **not**
revivable, because their workspace is already merged and cleaned. hz's `git worktree`
needs none of this — it is the one section where the smaller system is not the worse
one.

### What not to take

- **Collab.** `/collab`, the relay, the end-to-end encryption and the web guest are a
  session-*sharing* product. The one relevant idea is that it republishes the agent's
  lifecycle events as `bus` frames so a guest's roster renders natively — which is a
  lesson about emitting events from the layer that owns the state, and hz already
  does that.
- **Nine isolation backends.** `git worktree` works here.
- **The 4,409-line executor as a file.** Read it as evidence of what a policy layer
  accumulates; port the policies, not the shape.

### Done when

Marked with where each one stands after reading the code, because two of the four
were closer than this section first said.

- A run that has finished can be **messaged again** and answers from its own
  context, with no new spawn. — *Half there.* `task_append` already activates a Turn
  on the finished child; what is missing is keeping it warm so the answer does not
  rebuild the context every time.
- A subagent's row **survives a restart** and can be revived from it. — *There on the
  agent's side*, which builds the roster from the store; unverified in the app.
- A child that would have produced nothing instead **ends through a contract**, so
  the parent can tell "produced nothing" from "still going". — **Landed.**
- A run that hits its ceiling **returns what it found** rather than being killed
  empty. — **Landed** for a run that had a ceiling. A task child still has none, which
  is the open half above.
- The reported defect is closed by the first of those, not by a patch around it. —
  Closed by the model-limit fix, which is a different thing; the contract above is for
  the case nobody has watched happen.

---

## 1. A terminal, because the agent lives in one

**The hole.** The agent runs shell commands all day. hz draws each as a tool card
with a command and its output as prose: you cannot type into it, cannot watch a
build, cannot answer a prompt, cannot `cd` and look. Every app in this category
has one — Zeron pulls in `alacritty_terminal` plus `portable-pty`, MonoCode
vendors `portable-pty`. It is the most conspicuous absence in a product whose
whole job is running a coding agent.

**The design.**

- Rust: a `terminal/` module with a registry keyed by tab id, one pty per tab via
  `portable-pty`, spawned at the session's cwd. One task reads the pty and emits.
- **Batch the output at 12ms.** Zeron's `TERMINAL_OUTPUT_BATCH_MS = 12`, and
  MonoCode coalesces terminal input at 12ms with an 80ms resize debounce. A pty
  that emits per byte melts the IPC — this one constant is the difference between
  a working terminal and a frozen app.
- **Bound the replay at 1MB, counted as raw bytes.** Zeron's window; counting
  base64 instead inflates it by a third and is a mistake they call out.
- Frontend: `xterm.js` in a pane that reuses the machinery already there —
  `SplitView.tsx`, `TabRow.tsx`, `RightPanel.tsx`. A new `TerminalPane.tsx`.
- **detach ≠ close.** The pty lives in the engine, so switching tab or session
  does not kill the shell, and it is still there when you come back. This is the
  decision that makes it a terminal rather than a toy.
- Height drag 160px–55vh; middle-click closes a tab; an exited shell leaves
  `[process exited N]` rather than a blank pane.
- **Purge on delete.** Zeron's memory pass found the terminal map was never
  cleaned on chat delete, at 30–50MB per fully-scrolled terminal (24B/cell × 10k
  lines). Scrollback is bounded and configurable from the start.

**Done when** a shell opens in a worktree session, `pnpm test` runs in it, it
survives switching sessions and back, deleting the session kills the pty, and
`yes` for a hundred thousand lines does not move the app's memory.

## 2. A session that never lies

**The hole, verified in this tree.** The stdout read loop is spawned with its
handle dropped (`harness/mcode/mcode.rs:653`). A clean end of stream is handled;
a **panic** is not — the task unwinds, nothing ingests the closing turn, and the
session sits `InProgress` with a spinner forever. There is exactly one
user-visible error event in the whole app (`session.rs:3223`), and 92
`eprintln!` calls that a `.app` launched from Finder sends to a system log nobody
opens — including a failed worktree rollback, a failed index write, a failed
session-file delete. The app knows it failed and tells no one.

**The design.**

- **A staleness gate, the same one Zeron landed.** `SESSION_STALE_MS = 45_000`
  with a 15s heartbeat: a session that has said nothing for 45s is not working,
  whatever its stored status, and the row says so. Their comment is the whole
  argument — *"a crashed backend must never show an eternal Working"*.
- **Supervise the read loop.** Keep the `JoinHandle` and, when the task ends
  without having ingested a closing turn, run the path an end-of-stream already
  runs (`strand_queue_on_exit`, `session.rs:3250`) and then emit a `child_exited`
  carrying the reason. The recovery is already built — an id known with the
  process gone re-opens the CLI's own session on the next send — it just never
  gets told the process is gone.
- **One log sink.** Every `eprintln!` in a runtime path goes to
  `{data_dir}/hz.log`, and the ones a reader can act on raise a notice card.
  `NoticeStack.tsx` already exists for this.
- A dead turn shows **Retomar** in place rather than only failing the next send.

**Done when** `kill -9` on the child mid-turn ends the turn with a reason and
Retomar resumes it; a session held idle past 45s stops claiming to work; a
deliberately failed index write raises a card instead of vanishing.

**Landed so far: the supervision and the sink.**

The read loop's `JoinHandle` is kept and watched. The recovery was pulled out of
`read_stdout` into `close_after_exit(reader, cause)` — one function, two callers,
because a loop that *ends* has already closed its conversations and a loop that
*unwinds* closed none of them, and a second copy would be the copy that drifts.
`ExitCause` separates the two on screen, since "mcode exited" and "the read loop
died" send a reader to different places. The recovery takes the `prompt_id` lock
*through* its poison rather than refusing it, because a `std` mutex held when
something unwound stays poisoned and the `expect` used elsewhere would take the
recovery down with it — the exact failure it exists to prevent.

The sink went in as **one redirect rather than fifty call sites.** `logging.rs` tees
this process's stderr into `~/.hz/hz.log` once, at startup: a thread carries what
arrives to both the terminal it always went to and the file. That covers the
fifty-odd `eprintln!`s already in the tree, every one added later, and **the panic
message of a task that unwinds** — which no per-site change could have caught, and
which is the other half of a session that dies without saying so. It rolls at 4MB so
a long-running app cannot fill a disk with its own complaints.

One ordering rule, and it is a trap: the tee must **not** create `~/.hz` itself.
`store::get_home_app_dir` is what moves a directory left by an earlier name of the
app into place, and it only does that while `~/.hz` does not exist — so the sink
waits for that resolver rather than joining the path itself, or a reader coming from
an older name would lose their session history to a log file.

Verified: `cargo check`, `cargo clippy --all-targets -- -D warnings`, and
`cargo test` at 641 passing.

Still open: the staleness gate, and the note below about it. Also unbuilt is the
half of the sink that the reader sees — routing the failures that can be acted on
into a notice card through `NoticeStack.tsx`, rather than leaving them in a file the
reader has to know to open. The log is where every failure now lands; the card is
for the few where knowing *now* changes what they do next.

## 3. Rewind: snapshots, and taking a message back

**The name is deliberately not "checkpoint".** This tree already spends that word
on `components/chat/CheckpointRail.tsx` — the transcript's spine, one tick per
prompt — and it is the better name for a table of contents than for a disk
snapshot. Two meanings for one word in one codebase is the kind of thing nobody
untangles later, so the filesystem feature takes a different one.

**The hole.** The agent edits files and there is no undo. A worktree catches a
bad session but not a bad turn, and correcting a prompt means starting over,
because `fork_session` makes a *new* conversation rather than a correction.

**The design.**

- **A snapshot per turn.** Before a turn's first tool call, capture the working
  tree — a manifest of changed files plus their contents, capped at 500 files
  (MonoCode's `MAX_SNAPSHOT_FILES`) — under
  `{data_dir}/snapshots/<session_id>/<turn_seq>/`. `git.rs` is already 3,806
  lines of git handling and is where this belongs.
- **Apply / undo / keep**, surfaced on the turn in the transcript, with an
  exclusive gate per session.
- **The guard rails are the hard-won part, so copy them:** a file changed on disk
  since the snapshot **blocks** the restore with a reason rather than being
  overwritten, and a symlink in the path is refused before anything is written.
  Zeron's remote-write path states the rule plainly — hiding something in the UI
  is not a control.
- **Edit the last message and resend.** Truncate at that turn, restore the
  snapshot taken before it, and put the text back in the composer. If the
  provider refuses, the previous transcript and draft come back — the failure
  path matters more than the happy one here.
- **Bound what is kept.** Snapshots are dropped on keep and on session delete, or
  this is a disk leak with a nice name.

**Done when** a turn that edits three files can be undone to all three
byte-identical; a file touched outside hz blocks the undo instead of losing the
change; editing and resending a prompt leaves one conversation, not two.

## 4. Notes, and an agent that remembers

**The hole.** hz has no memory of any kind. Every session in a project the reader
has worked in for weeks starts from zero, and everything the agent learned —
decisions, conventions, the trap it already fell into — is gone with the
transcript.

**Two parts, and the second is what makes it worth building.** A store, and a
view good enough that someone actually writes in it.

### The mechanism: an app-owned command

The composer's slash list comes entirely from the agent today —
`available_commands_update`, shaped by `harness/mcode/commands.rs`, with no
app-owned entry anywhere. Notes and export both need one, so this lands first.

MonoCode's shape is the right one and it is small: an app command is a
`BuiltinSkill { kind: "builtin", scope: "builtin", source: <app> }` merged into
the same list the provider's commands come from, and it is **consumed
client-side** — `consumeOperatorCommand` strips the prefix before the prompt is
sent, and the fact that it was used is marked on the persisted row so later turns
keep the behaviour. Nothing reaches the model that the model should not see, and
the picker shows both sources as one list.

For hz that is a second source feeding `filterCommands` in `lib/slash.ts`, and a
`SlashCommand` that carries its origin so the picker can draw the two apart.

### The store

Deliberately not embeddings and not a vector store. A file and a CLI verb.

- Notes live beside the index in `store.rs`, under the existing
  write-temp-then-rename discipline: `id, slug, title, body, tags[],
  source_session_id, source_cwd, created_at`. MonoCode's schema is the model.
- Two ways in: save a transcript selection or a whole turn, and let the **agent**
  write one — so a decision is recorded when it is made rather than
  reconstructed later.
- **The agent reads them back.** `notes.list` / `notes.read` over the socket the
  `hz` CLI already uses, plus a project's note titles injected into the first
  prompt of a new session in that project. That injection is the whole mechanism,
  and it is what makes this intelligence rather than a notebook.

### The view, at MonoCode's level

Structure and behaviour from theirs; the look stays `DESIGN.md` — one radius, one
yellow, shadow on filled buttons and not on chrome. Copying the pixels would be
copying the wrong half.

- **A resizable list column beside the editor.** 240 min / 420 max, where the max
  also caps at half the window, default 280, driven by the `ResizeHandle.tsx` the
  panes already use. A labelled handle.
- **It remembers where you were.** Both the column width and the selected note id
  survive leaving the view and coming back. MonoCode keeps both in module state;
  what it buys is that Notes never feels like it reset itself.
- **Filter by name** at the top, and a `New note` button. An empty list is a real
  empty state, not a blank column.
- **Editor:** a borderless title at 20px semibold with `Untitled` as the
  placeholder, over a body that is **the same markdown renderer the transcript
  uses** — so a note and an agent reply render identically. MonoCode adds a
  source↔rendered toggle over its editor, which hz has nowhere today; it is worth
  having here, and it is new rather than reused.
- **Tags as chips**, each removable, with an inline add-tag input and a cap.
- **A note belongs to a project**, drawn with that project's logo and mascot and
  chosen from a searchable project picker — so a note is anchored to something
  instead of floating.
- **Ordered saves.** MonoCode serialises pending saves per note behind a queue
  that survives unmount and reopen. That is the difference between "I typed and
  navigated away" and losing the sentence, and it is the detail most likely to be
  skipped and most likely to make the feature feel cheap.
- **Images:** paste and drag-drop into the body, stored as assets and inserted as
  markdown. hz's attachment path already does the storage half.
- **`Add to chat`, both directions** — a note into the composer, and a message or
  a selection out of the transcript into a note.
- **Pure helpers with tests**, as MonoCode does: title, preview and source project
  each derived by a pure function, so the list, the card and the export cannot
  disagree about what a note is.

**Done when** a project with three notes starts a new session already knowing
them; an agent saves one from inside a turn; and a note written, tagged, given an
image and navigated away from is still there, unchanged, when you come back.

## 5. A transcript that holds up

**The hole, in numbers measured on someone else's code.** Zeron found a 1.6MB
reply cost **257MB of frames** per 120ms tick, and streaming ran at **11.6× the
raw text** in memory and never gave it back. hz appends one `agent_event` per
event, which is the same shape.

**What this item got wrong on the first pass, corrected after reading the tree.**
Two of the four things it asked for are already built, and one is not worth
building without a measurement:

- Built: the follow model. `Chat.tsx` has `followRef`, a 40px `AT_BOTTOM_PX`
  band, anchor-based scroll preservation for content prepended above, a pin
  throttled to one frame, and a scroll-to-bottom button on `chat.bottom`. Zeron's
  70px band and overlay-gradient fade are a refinement, not a gap.
- Built: the prose summary. `ToolGroupRow` already builds the header from the
  verb, a single target, the plan line, and `+N -M` — *"Edited auth.ts · +12 -3"*.
- Not built, but also not justified yet: one row per **block**. hz mounts a
  **window of the newest turns** (`mountedTurns`), memoizes `TurnBlock`, and
  caches `buildTranscript` on the event array, so a streaming delta already
  re-renders one turn rather than the world. Zeron's block split pays for itself
  against a transcript that re-measures a whole message per token; hz has not
  been measured doing that. **Do not rewrite this before measuring it** — the
  mount-window design is the thing to protect, not replace.

**So the work is two things.**

- **Per-entry deltas instead of the whole list.** Zeron's change took that 1.6MB
  reply from 257MB of watch frames to **2.3MB — 110×**. The derived rows are
  already cached on the array, so what crosses the IPC should be the entries that
  changed rather than a fresh array to diff against. The measure to take first:
  bytes of IPC and ms per delta for one long streamed reply.
- **Bound the caches.** Zeron found their highlight and tree caches growing with
  every row ever scrolled, freed only on chat switch. hz's highlighter and render
  caches want the same ceiling, sized to viewport±K rows, and images want a 64MB
  encoded LRU — one screenshot is ~48MB decoded.
- **Plus the one visible thing that is genuinely missing:** the sidebar does not
  animate its resort. It carries hover, opacity and colour transitions and no
  layout transition at all, so a list that reorders by attention teleports under
  the cursor. Per-row `viewTransitionName` with a 260ms
  `cubic-bezier(0.22,1,0.36,1)` is the cheap half of this item.

**Done when** a 1.6MB reply streams with IPC bounded per delta rather than per
array, memory stops climbing rather than merely slowing, and the sidebar glides
when a session's standing changes order.

## 6. `/export`

**Why a small thing earns a slot.** Neither competitor has it — Zeron ships no
transcript export and MonoCode has no copy-whole-thread or download action. And it
is the natural end of work already here: `lib/transcript.ts` walks the events into
rows for the screen, and an export is a second consumer of that same walk —
exactly as `pendingAsksOf` was split out of `buildTranscript` so the composer's
copy cost a scan rather than a second walk. One walk, two renderers, and they
cannot drift apart.

It rides the app-command mechanism in §4, which is why it is cheap.

**The design.**

- **`/export` writes Markdown**, and it is the transcript rather than a dump:
  turns in order, tool calls summarized the way a collapsed group already
  summarizes them, diffs included, attachments named, and a frontmatter block
  carrying model, project, branch, worktree and timestamps — the facts you need a
  month later to know what you are reading.
- **`/export json` writes the event log**, which is what turns a session into a
  bug report: the same lines that went to disk, so a reader can hand over a
  reproduction without explaining it.
- **Scope: the whole session, a range of turns, or one turn.** The command covers
  the first; the other two are a context-menu action on a turn, which is where a
  reader actually reaches for it.
- **Deterministic.** Same session in, same bytes out — sorted keys, no wall-clock
  stamp beyond the ones already inside the events — so an export can be diffed
  against yesterday's. Cheap now, impossible to retrofit.
- **Saving goes through the dialog plugin**, already initialised in `lib.rs`,
  plus one small write command. `download.rs` is not the right home — it streams
  a large file from a URL and hashes it, which is a different problem.
- **Rendered HTML is a later option, not this one.** The markdown renderer is
  already here and would make it easy, but a second output format doubles what has
  to stay correct for a case nobody has asked for yet.

**Done when** `/export` on a 200-turn session produces Markdown that reads
correctly with tool calls folded; `/export json` produces a file that round-trips
through the existing parser; and exporting the same session twice is
byte-identical.

**Landed, and one decision moved from where this item first put it.** The write
itself is `lib/export.ts` — both formats, deterministic, with the walk reused from
`buildTranscript` so the file and the window cannot disagree. What it rides on
changed: the plan had `/export` as an app-owned *slash* command, which needs the
mechanism in item 4 — merging an app command into the list the provider publishes —
and that is a piece of work on its own. **Two rows in ⌘K** get the same feature
today for none of it, and the slash form can arrive later on top of the same module
whenever that mechanism does.

So: `lib/exportSession.ts` holds the one part that cannot be pure — the save dialog
and the `write_text_file` command — kept apart from the module whose whole value is
that one session produces one set of bytes. `exportFileName` and
`sessionExportMeta` are the pure helpers around it: a filename sanitised from a
title an agent wrote (a slash in it would save into a directory that is not there,
a newline makes a name no dialog can show, a leading dot hides the file), and the
frontmatter's facts read off the index entry, which is the only place they live.

**Cancelling is not a failure** and draws nothing — an app that raises a complaint
for a thing somebody decided not to do is arguing with them. Only the write's own
refusal reaches the composer's error slot.

**One thing the palette taught me, worth knowing for the next action added there.**
A `⌘K` row draws its keycaps from the chord registry, so every id in that array *is*
a real binding — an export has no key, and naming one there draws caps for a chord
nobody can press. The export rows are therefore pushed after that loop rather than
into it, and that is a shape the next chordless action will need too.

## 7. Finding things in a transcript

**The hole, and it is one hole in two halves.** A search hit already carries
`sessionId:seq` — `lib/search.ts` mints `${hit.sessionId}:${hit.seq}` — and
`App.tsx:3342` throws the `seq` away, opening the session with `goToSession` and
landing the reader wherever the transcript happens to be. So a hit finds the
sentence and then does not take you to it. The other half is the inside of one
transcript: ⌘F is the cross-session search (`shortcuts.ts:51`), and there is no
find within the open one — no count, no next, no mark on the occurrence.

**The design.**

- **A hit lands on its block.** The identity already exists, and so does the
  mechanism: `Chat.tsx`'s `jumpToTurn` moves the transcript to a target today,
  wired only to the checkpoint rail. What makes this more than plumbing is the
  mount window — `mountedTurns` draws only the newest turns, so the target's turn
  is very often *not mounted*, and a scroll to a node that does not exist is a
  no-op that looks like a broken link. The jump has to open the window far enough
  to contain the `seq` before it scrolls, which is a change to the mount
  calculation rather than to the scroll.
- **Find inside the open transcript.** ⌘F is the muscle-memory key and it is
  already spent, so this is a deliberate choice: either ⌘F means find when the
  transcript has focus and session search elsewhere, or find takes a different
  key. The count, the prev/next, and the **marks inside the rendered markdown** —
  which means a prop on `Markdown`, not a DOM walk, because the transcript is
  React and a walk would fight every re-render the stream produces.
- **The scroll-to-bottom button says what arrived.** It is a bare `ArrowDown`
  today. While a reader is scrolled back through a long turn, nothing says how
  much landed below — badge it with the count of turns that arrived while
  unpinned. `turns.length` before and after is the whole measurement.

**Done when** a message hit in search opens the transcript on that block even
when the turn is far above the mount window; find counts and steps matches inside
the open transcript without touching the session list; and scrolling up during a
long turn leaves a button that says how much has arrived.

## 8. The command picker's missing half

The command surfaces are in good shape and that is why what is left is specific.
Everything here was checked against the code rather than assumed.

**The hole.** Three things, each verified:

- `SlashCommand.argumentHint` (`<model>`, `[name]`) is **drawn and never used**
  (`SlashCommandMenu.tsx:42`). Typing `/model ` offers nothing.
- `SlashCommand` has **no availability field** (`types/events.ts:2658`), so a
  command that cannot do anything right now is drawn exactly like one that can.
- `groupCommands` returns `Recently used` and then **two unlabelled groups**
  (`slash.ts:140-144`) — the harness's commands and the installed ones, separated
  by a gap and nothing else. Nothing tells the reader why the list splits.

**The design.**

- **A second stage that completes the argument.** `/model ` offers the models;
  `/effort ` offers the ladder. Every source exists — `list_models`,
  `ModelSelector`, `model.next` / `effort.next`. The interesting one is
  **effort, because its ladder is model-dependent**, and the architecture already
  resolves that order: the model is applied first and its own reply states the
  ladder the effort is then judged against. So the argument stage must read the
  current model's ladder rather than a static list — get that wrong and the picker
  offers a level the model will refuse. This is the piece **neither competitor
  has**.
- **It is a third caller of `PickerMenu`, not a third picker.** `PickerMenu` is
  already generic over its items and takes groups, no focus, and the container-local
  scroll. Which commands get a stage is a small table — name to source of options —
  and everything not in it falls through to free text exactly as today.
- **An unavailable command is dimmed with a reason, or not drawn at all.**
  `DESIGN.md` already states the rule for the palette — a row that cannot apply is
  not built — and the slash picker has no equivalent. This needs a signal: either
  the agent learns to say, or a short app-side table for the few whose
  availability is knowable here (a session with nothing to compact, no worktree
  present). Prefer the agent saying, and use the table only where it cannot.
- **Name the two groups.** `Recently used` is labelled and the other two are not.
  One word each is the whole fix.

**A tradeoff, recorded rather than decided.** The palette's `>` is discoverable
only by reading a long placeholder sentence. Scope chips would be more legible,
but the palette's list deliberately never takes focus, so chips need a different
model than the one it has. Not a clear win — written down so the next person does
not re-derive it.

**Done when** `/model` and `/effort` offer the real options, with effort's coming
from the current model's own ladder; a command that cannot run says why; and the
`/` list explains its own split.

## 9. The sidebar: numbers, one line, and the agent's own face

**The hole is typographic, not structural.** The sidebar is the most carefully
built surface in the app, and none of what makes it good should move: the `Orb`
taking the timestamp's slot, the dashed check spinner at the same 3s turn the
panel's own pending row uses, `DotTrack` for spaces, the elbow rails that stop at
the parent's line instead of drawing a corner over it, the avatar leading a
subagent row, and hover swapping the time for Pin and Settle without opening a
column. What is wrong is that nearly all of it draws at the same 13px. A place
(`New Task`, `Inbox`), a group heading (`hz`) and a session title differ only in
opacity — so a forty-row column has one size and no landmarks.

**One answer to that was tried and rejected, and it is worth recording because it
is the obvious one.** The heading became a tracked uppercase label, on the
palette's own idiom for the kind on a row. The hierarchy was real and a reader
still asked for the heading back: in a pane whose whole design is one typeface it
read as a second one. So the heading keeps its size, and the hierarchy is bought
from the other end — the numbers get a face of their own instead.

**Landed, and one of them was a misreading worth recording.** The list carried
`pr-0`, on the reasoning that the track `scrollbar-gutter: stable` reserves *is* the
right-hand spacing. It is not: reserving room for a scrollbar is not the same as
leaving room for it, so the hover fill ended flush against the track and every
timestamp was drawn underneath it the moment the scrollbar appeared. `pr-2`,
matching the `pl-2` on the other side, is the fix — and the rows' own `pr-0.5`s
travel with it, so the heading's count and the rows' timestamps stay on one column
instead of drifting apart by the padding change.

### Part one: the numbers in the numeral face, and weight where it is needed

- **The heading keeps its size and gains a count.** `text-ui` at `/70`, unchanged,
  because that is deliberate — at full strength it was the brightest text in the
  pane, louder than what it labels. What the heading gains is the **count**, in
  mono at the size the rows put their timestamps at, crossfading with the plus in
  one slot: the heading says how much is under it, in the column where the rows say
  when.
- **Times and counts go to 10.5px mono**, the face this app already gives a
  numeral. It is what stops the meta competing with the title beside it, and it is
  where the hierarchy comes from now that the heading's shape is off the table.
- **The rows that need the reader get weight, not colour.** Full foreground on a
  title that is waiting or unread, `/80` on everything else. Weight is the one
  channel this column does not spend, and it answers *what needs me* without a
  second signal for a fact the 2px rail already carries — which is exactly what
  the app refuses everywhere else.
- **The gap between rows stays `gap-px`**, which is what makes a project read as
  one block; sections are separated by space rather than by rules. A taller break
  before each project went in with the label pass and came back out with it.

### Part two: "Needs you"

The want is real and worth having: the column's first question is *does anything
need me*, and answering it today means scanning every project in turn. But it
**cannot be a run of waiting sessions hoisted to the top**, and the reasons are
already written in this tree — so the shape below is the one that keeps the
intent and neither objection.

- A run driven by state **moves a row out on send and back when the turn ends**.
  The sidebar's own comment names that as the reason a session mid-turn is
  deliberately not a state of its own: a run of its own moved a row twice for one
  piece of work. Adding a run for *waiting* reintroduces it.
- A row that **moves under the cursor on the click that moved it** is a list the
  reader has to re-find, which is the app's own stated refusal in the providers
  list.
- And drawing the session in two places at once is the third version of the same
  mistake: Pinned already states the rule, that a pinned session draws there and
  nowhere else, because drawn twice the reader has to work out which copy is the
  one they meant.

**So it is one line, with a filter behind it.** At the head of the work list,
drawn only when at least one session is actually waiting — `2 need you`, the count
in mono, in the rail's own command yellow — and opening it narrows the column to
those rows, through the same mechanism the space and project filters already use.
It answers the question in one glance, it draws no session twice, and nothing
moves until the reader asks. Drawn only when non-zero, for the reason the sidebar
has no permanent footer: a line reading `0 need you` is chrome for a fact nobody
asked about.

**Done when** a reader can tell a label from a row from a number without reading
any of them; a session that is waiting is findable without a colour being added;
and one line says whether anything needs them, before they scan.

### Part three: the working mark is the agent's face, not an orb

**The inconsistency is inside one file.** `Sidebar.tsx:2536` draws a working
**subagent** as `BloubAvatar` — `live`, `mood="working"`, seeded with the agent's
own name, over a title that shimmers — and `Sidebar.tsx:2388` draws a working
**session** as `Orb state="listening"`. Two faces for one fact, in one list, told
apart only by which kind of row it is.

**The transcript has already ruled on this.** `WorkingIndicator`'s own comment:

> *"**The bot is the working state.** It is the same face the Agents screen draws
> for whoever this is, running through the orbit pose — so a reader looking at a
> wait is looking at the thing that is working rather than at a generic spinner."*

The sidebar makes the opposite claim, and it is the sidebar's subagent row that
already does it right.

**Three gains past consistency, which is why this is worth more than tidying:**

- **The bot is derived from a name**, so seeding it with the session id gives each
  running session its **own face**. Three sessions working stop being three
  identical orbs, and the face in the list is the face met on opening one.
- **`BloubAvatar` is a still unless asked to move** — *"the engine renders one
  exact frame for a date, so a list of Agents is a set of poses drawn once with no
  loop and no clock"*. That is precisely the primitive a list wants. The orb is a
  canvas that redraws every animation frame.
- **Cost, and it is documented in this tree.** `Orb.tsx` records the incident:
  each orb in a sidebar row repainted the whole document's tile set at animation
  rate, which on WebKit fed a leak of retired backing stores at **~1GB per hour of
  use** (DRA-159). `will-change` mitigates it; a static SVG removes the class of
  problem rather than the symptom.

**The still was the wrong call, and the reader said so.** `BloubAvatar`'s own doc
says the loop is for *"the two or three places the reader is actually looking at
one"*, and a worklist can hold many working sessions at once — so the sidebar drew
the **still** in the working pose and let the **shimmer** carry "this is happening
now". Two things were wrong with that. **The motion is the fact**: `orbit` is a pose
the eyes travel through, so a frozen frame of it is a bot looking off to one side,
which reads as a face rather than as work — a still says *this one is going* only to
somebody who already knows what the pose looks like moving. And **the cost is not the
row's**: the avatar holds its own frame, so a ticking bot re-renders one SVG and
nothing around it, where the orb it replaced was a canvas repainting the whole
document's tile set. `live` is what ships, and the subagent branch had it right from
the start.

**Done when** a working session and a working subagent draw the same face, moving,
and two sessions running at once are told apart by their faces rather than by reading
their titles.

## 10. The agent stops introducing itself as somebody else's

**The hole, and it is a contradiction already sitting in this tree.** The app's own
icon component has made the decision. `AgentIcon.tsx` draws a monogram, and its
comment says the quiet part: *"The agent is this app's own build, so there is no
vendor mark to carry and no second one to tell it apart from; a glyph traced from
somebody's brand would be claiming an identity that is not that brand's to give.
`Hz` is what it is called."* The UI has already moved.

The agent's own prompt has not. It is the first thing a session reads, so this is
not cosmetic — it is the agent's identity being wrong in the one place the agent
speaks:

| where | what it says |
|---|---|
| `agents/mavis/PERSONA.md` | `display_name: Mavis`; `description: A partner with judgment and warmth \| Powered By MiniMax`; an avatar hosted on `filecdn.minimax.chat` |
| the same file's body | *"Hz Agent is a coding agent / agentic coding workspace developed by MiniMax"* |
| `modes/work/online/PERSONA.md.hbs` | `display_name: Mavis`, and *"You are Mavis. The name stands for MiniMax As a Jarvis."* |
| `modes/coding/online/PERSONA.md.hbs` | the same two lines, and the `-zh` siblings of both |
| `skills/hz-agent-product/SKILL.md` | *"Hz Agent is MiniMax's agentic coding workspace; Mavis is its primary Agent"* |

So the product's icon says one name, the product's agent answers to another, and a
reader who asks who it is gets a third company's answer.

**The distinction that keeps this small.** MiniMax as a **model provider** stays.
`modelBrand.ts` brands a model row and `title.rs` names
`minimax/MiniMax-M2.7-highspeed`; both are a family the reader can pick, not the
agent's name. Only MiniMax as **the agent's own identity** goes.

**The scope, in the order it should be done.**

1. **The persona, both languages and both modes.** `display_name`, the
   description, the avatar, the body's identity sentence, and the acronym
   expansion in the two mode templates — that last one is the deepest, because it
   spells out what the name is supposed to stand for.
2. **The router skill.** `hz-agent-product` exists to answer "who are you" for the
   product, which makes it the most important file here and the one that would
   otherwise contradict the persona that replaced it one layer up.
3. **The registry and the directory.** `builtin-agents.json` names `mavis` among
   the four builtins, the directory itself is `agents/mavis`, and the greetings
   ride along.
4. **The desktop's own copy of the name.** `harness.rs` calls the child "MiniMax
   Code, the `mcode` CLI" and warns a reader off looking for a second install by
   that name; `vendor-agent.mjs` states the vendored product as `minimax-code`.

**Three constraints that decide how it is done, not whether.**

- **The binary keeps its name.** `binpath.rs` resolves `mcode`, the vendoring
  script writes its launcher, and the handshake is built around `mcode acp`.
  Renaming the persona is a text change; renaming the binary is a different
  project, and nothing a reader sees depends on it.
- **It has to survive a re-vendor.** The tree under `apps/agent` is upstream-derived
  and `scripts/vendor-agent.mjs` is what fetches and patches it — it already
  carries `product: 'minimax-code'`. A persona edited in place is lost on the next
  vendor run, so the rename belongs in the patch step, not in the vendored files.
- **The name has to be chosen once, and the tree currently offers three.**
  `AgentIcon` says `Hz Agent`, the request that produced this item said *Hyze*, and
  the name on the connected services is `Hyze`. That is a product decision rather
  than something to assume — but it has to end as one string everywhere, or the
  reader meets this same disagreement one layer down.

**A caution on the working tree.** `apps/agent/packages/local-runtime-v2` has
uncommitted edits in flight. Nothing here should be written until that lands.

**Done when** asking the agent who it is names this product and no other; the
sidebar's icon and the agent's own `display_name` agree; and nothing a reader can
reach calls the agent by a name the app does not use.

---

## Where each one lands

| | new code | existing code it leans on |
|---|---|---|
| Orchestration | a lifecycle and a persisted registry; a contractual child exit; delivering budgets | `local-task*.ts`, `task-waiter-registry.ts`, `subagent-result.ts`, `harness/mcode/delegation.rs` |
| Defect: goal time | done — an anchor keyed by `goalId` in `lib/goalClock.ts` | `GoalControl.tsx`'s `useElapsed` |
| Defect: subagents | nothing until it is reproduced | `useSubagentWork.ts`, `session_delegations` |
| Defect: file links | a second base (`projectPath`) and a unique-suffix fallback | `lib/filePath.ts`, `Markdown.tsx:251`, `useChatSession` |
| 1 Terminal | `src-tauri/src/terminal/`, `components/TerminalPane.tsx` | `SplitView.tsx`, `TabRow.tsx`, `RightPanel.tsx` |
| 2 Never lies | a supervisor around the read loop, one log sink | `mcode.rs`, `session.rs`, `NoticeStack.tsx` |
| 3 Rewind | `src-tauri/src/snapshot.rs` | `git.rs`, `store.rs`, the turn row in `Chat.tsx` |
| 4 Notes | a store in `store.rs`, `components/NotesView.tsx`, an app-command source in `lib/slash.ts` | `SearchView.tsx`, `DocsPanel.tsx`, the transcript's markdown, `apps/cli` |
| 5 Transcript | delta protocol, `lib/transcript.ts` rewrite | `useSessions.ts`, `mapper.rs`, `Sidebar.tsx` |
| 6 Export | `lib/export.ts`, the second consumer of the transcript walk | `lib/transcript.ts`, the dialog plugin, `lib/slash.ts` |
| 7 Find | the `seq` carried into the mount window, a find mode in `Markdown` | `lib/search.ts`, `jumpToTurn` in `Chat.tsx`, `mountedTurns`, `shortcuts.ts` |
| 8 Command args | an options table, a third `PickerMenu` caller | `lib/slash.ts`, `ModelSelector`, `list_models`, `types/events.ts` |
| 9 Sidebar | a count on the heading, a waiting line, a filter mode, the bot where the orb is | `Sidebar.tsx`, `sessionGroups`, `DotTrack`, `BloubAvatar`, `NestRails` |
| 10 Agent identity | the personas, the mode templates, the router skill, the registry | `AgentIcon.tsx` (already right), `harness.rs`, `vendor-agent.mjs` |

## Looked at and left out

Recorded so the filter is visible, not so these are forgotten.

**Already built, verified — proposed by the first pass and struck off.** Each of
these was checked in the tree before it was dropped, and they are listed because a
later reader would otherwise suggest them again:

- **The slash picker's recents.** `groupCommands` already promotes a
  `Recently used` group off a stored order, capped by `RECENT_LIMIT`.
- **The picker's two modes.** Browsing is grouped and searching is flat, and
  `groupCommands` and `filterCommands` are deliberately two orderings nothing
  blends — so match quality always wins a search and habit only ever orders a
  browse.
- **The picker's hard parts**: the phantom-hover guard, container-local scrolling
  that does not nudge the transcript, the skeleton sized to the real row, the
  `bare` empty state that drops its surface under vibrancy, and the `↑ ↓ / ⏎` hint.
- **The palette's own rules**: `>` narrows to actions, a start-of-label match
  outranks a mid-label one, the matched words are marked, the caps come from the
  registry so a rebinding moves them, and the list never takes focus.
- **The chat's follow model**: a 40px `AT_BOTTOM_PX` band, `followRef`, anchor
  preservation for content prepended above, a pin throttled to one frame, and a
  scroll-to-bottom button on `chat.bottom`.
- **`ToolGroupRow`'s prose header** — verb, one named target, the plan line, and
  `+N -M`.
- **`AgentTrace`** as one primitive behind thinking, reasoning, tool runs and turn
  steps, opening itself at the live edge and closing when it lands.
- **`CheckpointRail`** — the prompt spine with hover previews and click-to-jump.
  This is Zeron's MessageRail, already built.
- **Images**: 80px squares for the reader's own, uncropped at reading size for
  what the agent sent back, `+N` past three, and a lightbox that takes the whole
  set with ← / → on the dialog.
- **Code blocks**: copy is the only control and download is deliberately off, with
  scroll containment rather than wrapping.
- **The transcript's mount strategy**: a window of the newest turns, `TurnBlock`
  memoized, `buildTranscript` cached on the event array.

**Already built in the sidebar, and nothing here should touch it.** The same pass
that produced item 9 proposed several of these as new; they are listed because
they are the reason item 9 is typographic rather than structural:

- **The timestamp's slot is the only place a state goes**, and the **dashed check
  spinner** at 3s outranks whatever the working mark is — the same glyph the
  panel's own pending check row draws, so one fact has one shape across the app.
  This arrangement stays; what item 9's part three changes is the *form* of the
  working mark, not where it sits or what outranks it.
- **`DotTrack`** for spaces: a 1px-dot track, mask-faded at both ends, sliding so
  the active dot sits at a fixed centre. This is the app's answer to group
  identity, and it is better than a colour per project.
- **`NestRails`** already draws a real tree — an elbow that stops at half height
  unless the parent's rail carries on below, plus pass-through rails per ancestor,
  each on its own column.
- **The subagent row takes the avatar**, deliberately, because it says *who* and
  whether it is still going in the space an icon would have spent saying nothing.
- **Hover swaps the time for Pin and Settle** in the same slot rather than opening
  a column, and the Pin is absent where the row inherits one.
- **The five places are drawn as list rows**, at the same `/80` and the same
  half-strength selected fill a session carries — one visual language for the
  whole column.
- **No permanent footer.** `UpdateRow` appears only when there is something, and
  `DevBadge` is the muted last line.

**Already right, and item 10 should not touch it.** `AgentIcon.tsx` draws a
monogram of the app's own name and states in its own comment that a glyph traced
from a vendor's brand would claim an identity that is not that brand's to give.
That decision is the one item 10 is finishing on the agent's side, so it is the
reference to match rather than a thing to change.

**Second wave — small, visible, one day each.** Not in this plan because none of
them changes what the product *is*: a global quick-composer over any app
(⌘⇧Space, pick a project and model, Return runs it in the background); **BTW**, a
read-only side conversation on a finished reply so "explain this" never pollutes
the thread; reusing preview tabs, so a single click opens a reusable tab and a
double click keeps it; and the obvious next step for `PrPanel.tsx` — a failed CI
check with a **send this to the agent** button, tracked as a linked conversation.

**Taken out at the reader's request — the lead-agent orchestration.** It was item 5:
growing the CLI to MonoCode's twelve verbs, a write scope per worker, and a lead
agent that answers its workers' permission requests itself instead of handing every
one to the reader. The reasoning is kept rather than deleted, because the argument
was sound and is the one thing in either competitor that changes what this product
*is* rather than what it has — so if it comes back, it comes back to this paragraph
instead of to a fresh reading of somebody else's repository. It is out because the
reader asked for it out, not because it stopped being true.

**Rejected outright.**

- **Refactoring the large components** (`Sidebar.tsx` 2,559 lines,
  `SettingsDialog.tsx` 1,600, `PrPanel.tsx` 1,412). Real debt, invisible to a
  reader — maintenance, not product.
- **VS Code theme import**, however complete Zeron's version is. `DESIGN.md` is a
  hand-built identity; importing someone's palette dilutes it.
- **Multi-device sync and a headless engine.** Zeron's whole 318k-line bet, and
  the right call for them. hz runs on one machine, and this would be a second
  product.
- **Jira and Azure DevOps in the inbox.** hz has Linear and GitHub. Another
  integration is more surface, not a different product.
- **Background artwork, appshots, animated welcome scenes.** Cosmetic. Zeron
  spends real engineering on them and they look good; they do not change what hz
  does.
- **Memory gates and perf docs in CI.** Would have been on this list a week ago.
  It is process, and until there is a performance feature to protect it protects
  nothing.
