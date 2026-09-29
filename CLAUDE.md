# CLAUDE.md

The always-on half of this repo's documentation: how we work, how to run things,
the conventions, and the two lists that stop unfinished work reading as a bug.

**Read on demand, they are the other half:**

- [apps/desktop/FEATURES.md](apps/desktop/FEATURES.md) — every feature surface and
  why it is like that, plus **the normalized event model** (in full: `seq` is the
  ordering key and not `ts`, a prompt's `ts` is the reader's clock, deltas are a
  preview and the committed event wins, permissions are ACP's
  `session/request_permission` and the agent blocks until answered, the
  coalescer, subagents, turn snapshots), **what the agent costs, measured**, and
  **rendering code** (the one Shiki instance, theme pairs, the three silent
  blank-or-grey failures, the diff `cacheKey`). Read the section for the thing you
  are touching before you change it.
- [apps/desktop/DESIGN.md](apps/desktop/DESIGN.md) — the visual language, the
  rejected alternatives, and the reasoning behind both. Read it before restyling
  anything or reworking a panel, card, row or button.

This file stays inside a 32KB budget because the agent runtime injects the first
32KB of it and drops the rest silently. Text that moves out lands in FEATURES.md
whole, never deleted.

---


## Working practices

**No tracker.** Linear is off until Hamerti say otherwise, so no ticket gate on product work. What want writing down go in the `.md` beside it — a plan note for a feature, a line in the repo's own doc for a decision that outlive the conversation.

**Housekeeping take no issue.** CLAUDE.md, plan note, tooling config — thing changing how we work, not what ship. Issue there = noise.

**Minor update take no issue either.** Tooltip wording, copy tweak, one-line prompt change. Several small thing landing in one PR = one issue at most, never one each.

**Description over ~1000 character open with `## TLDR for human`, closed by `---`.** One line per thing worked on, even when only one. Shorter description need none.

**Status:** start → `In Progress`. After that, leave it — GitHub integration move issue to `In Review` on PR open and `Done` on merge. **Exception: work pushed straight to `main`.** No PR = nothing for integration to read, so set `Done` yourself.

**PR body say what changed.** No issue id to carry while there is no tracker, so the description is the whole record: one line per thing worked on, and the reasoning wherever a reader would ask why.

**PR nobody need review carry `no-review` label.** Copy tweak, doc, prompt wording, config. Add at open (`gh pr create --label no-review`), since review fire on open. Anything touching behaviour = no label.

**Default road = work → PR → stop.** Greptile review every PR on open, so spawn no reviewer session. Open ready, not draft — Greptile skip draft, so a draft sit unreviewed till somebody ping `@greptile review` by hand.

**This repo belong to Hamerti** — `github.com/Hamertingo/hz`, X `@Hamerti015`. Upstream `monorepo-labs/dray` stay as the `upstream` remote, to read history from and never to push to.

Nothing to create, so nothing to name at the end — say what got left undone instead.

**Don't commit unprompted.** Stage + describe change, then wait — even when finished and passing. Asked = approval for that commit only, not ones after. Same for `git push`, branches, anything rewriting history.

**Always write commit message with `caveman-commit` skill.** Invoke it, don't imitate — skill carry format and it can change under you. Every commit here, amend included.

**Comment sparingly.** ~10% of lines, only where code cannot speak for itself:

- Write _why_, not _what_. `// bump seq` on `self.seq += 1` = noise; "the session layer must number synthesized events through this same counter or seq develops gaps" = not noise.
- Good reasons: non-obvious wire-format fact, invariant future edit could silently break, why simpler-looking alternative rejected, deliberate omission.
- No restate type signature, no banner separators (`// ---- helpers ----`), no doc comment on every field of obvious struct.
- One dense sentence beat three-paragraph doc comment.

**Write plainly.** Everywhere — chat replies, comments, docs, commit messages, plan files. Short sentences, active voice, no clutter, no over-explain, no under-explain where detail matter. Skip fancy words. Cut any word doing no work.

**Stay out of files being actively edited.** User say they work on something → review and advise, don't rewrite. `todo!()` or missing match arm = work in progress, not defect.

**`///` doc comments show on hover, so add one to every `pub fn` and any non-obvious private fn** — one line, same "why not what" bar. Skip trivial helpers/getters where name say all.



## What this is

`hz` = Tauri 2 desktop app wrapping a coding-agent CLI in a chat UI. Spawn the MiniMax Code CLI (`mcode`) as a child process and speak **ACP** to it — JSON-RPC 2.0 over stdio — parsing each line into typed Rust enums and forwarding to React as Tauri events.

**One agent, and it ships with the app.** `mcode` is vendored into the bundle ([scripts/vendor-agent.sh](apps/desktop/scripts/vendor-agent.sh)) and resolved before anything on the reader's `PATH` ([binpath.rs](apps/desktop/src-tauri/src/binpath.rs)). What was five harnesses with five dialects is one ACP peer: [harness/mcode/](apps/desktop/src-tauri/src/harness/mcode/). A session some older build wrote for another CLI still **reads** — see `Harness::Other` — and nothing spawns for it.



## Repo layout

pnpm workspace, two apps plus the CLI and its wire crate.

```
apps/desktop/   the Tauri app — everything below this section describe it
apps/web/       marketing site: Next.js App Router, Tailwind 4, deploy Vercel
apps/cli/       the `hz` CLI: creates and lists sessions in the running app over a socket
crates/hz-proto/  the wire types that CLI and app share
```

Root `package.json` carry **no dependencies** — name, `packageManager`, `pnpm --filter` aliases only. Keep it that way: dep at root install into root `node_modules`, which both apps resolve through, so version drift there show up as one app mysteriously working.

Two things repo-wide on purpose. Release pipeline = desktop's alone but live in root `.github/workflows`, so paths carry `apps/desktop/` prefix and `tauri-action` need `projectPath`. And `pnpm-lock.yaml` single for whole workspace, why `pnpm install` run at root and nowhere else.

`apps/web` share design language with app but **no code** — no build step reach across, no import cross line. First component genuinely wanted in both = reason to create `packages/ui`, nothing before.



## Design direction

hz keep to one visual language — one radius scale, one yellow, filled buttons carry shadow and chrome don't, shortcuts live in real tooltips and never on `title`. Window is glass (macOS vibrancy) with body's fill the only hole in it, and the titlebar row is what user drag window by.

**Rules, rejected alternatives and the reasoning all live in [DESIGN.md](apps/desktop/DESIGN.md)** — read it before restyling anything, changing window chrome, or reworking a panel, card, row or button. Two things there fail *silently* and cost an afternoon each: vibrancy's `body` specificity, and window drag needing both an explicit capability and `data-tauri-drag-region="deep"`.



## Commands

Use **pnpm**, not npm. `tauri.conf.json` hardcode `pnpm dev` / `pnpm build` as before-commands.

**Every app command run from its own package dir.** Workspace root hold no deps, only thin `pnpm --filter` aliases (`pnpm app`, `pnpm web`). Anything else — `cargo`, `vitest`, `tauri build` — want real cwd, because relative paths in `tauri.conf.json`, `.cargo/config.toml` and `install.sh` all resolve against it.

```bash
cd apps/desktop && pnpm tauri dev
```

That = real entry point. `pnpm tauri` = shim ([scripts/tauri.mjs](apps/desktop/scripts/tauri.mjs)) merging `tauri.dev.conf.json` into `dev` subcommand only, so dev app carry own name and icon and `build` untouched.

**Shim also pick dev port, and it only side that can.** Vite and Tauri have to agree on one, and both start from here — so shim ask the OS for a free one (`listen(0)`), hand it to Vite as `HZ_DEV_PORT` and to Tauri as second `--config` carrying `build.devUrl`. Fixed 1420 was hard failure before, which = one worktree's dev build refusing to start because another's already running. `strictPort: true` **stay** on Vite side: port already known free, and Vite wandering off it leave Tauri loading URL nothing serve.

- `pnpm dev` — frontend only, port 1420 unless `HZ_DEV_PORT` say otherwise. `invoke` do nothing in plain browser, so only useful for pure-CSS/layout work.
- `pnpm build` — `tsc && vite build`. `pnpm tauri build` for bundled app — **run [scripts/vendor-agent.sh](apps/desktop/scripts/vendor-agent.sh) first**, or the bundle ships without its agent.
- `cd apps/desktop/src-tauri && cargo test` — Rust tests (parser + mapper + event-model compatibility, plus git and file index). Single test: `cargo test every_update_in_the_capture_is_named`.
- `cd apps/desktop/src-tauri && cargo check` — fast type check, no linking whole app.
- `pnpm test` — frontend tests (vitest, node environment, no DOM). Scoped to pure logic where being wrong invisible on screen: [mcode.test.ts](apps/desktop/src/lib/mcode.test.ts) for the model/effort/stance rules, [todo.ts](apps/desktop/src/lib/todo.ts) for reading a plan off a capture, composer's caret arithmetic ([slash.ts](apps/desktop/src/lib/slash.ts), [mention.ts](apps/desktop/src/lib/mention.ts), [highlight.ts](apps/desktop/src/lib/highlight.ts)); and [theme.ts](apps/desktop/src/lib/theme.ts)'s coercion. Components not tested — no DOM here.
- `pnpm lint` — biome, **lint only** (no formatter: every file here is shaped by hand and a formatter's first run would rewrite all of them). The rule set is stated in [biome.jsonc](apps/desktop/biome.jsonc) rather than borrowed: `recommended` is off, and each rule left off has its reason written there. It runs in CI (`.github/workflows/app.yml`) with the type-check, the vitest suite, the app's `cargo test` and **`cargo clippy --all-targets -- -D warnings`** — none of which had a gate before. `--all-targets` is what finds the warnings in test code, which was most of them the day clippy went in (nine, all fixed rather than allowed). **There is deliberately no `cargo fmt --check`**, for the reason there is no biome formatter: this tree is shaped by hand and rustfmt's first run rewrites 319 files. Measured, not assumed.



## Architecture: the event pipeline

Messages flow one way out to CLI and one way back in; return path = what most Rust code exist to serve.

1. **`useSessions`** ([useSessions.ts](apps/desktop/src/hooks/useSessions.ts)) call `invoke("send_msg", {...})` with camelCase keys (`sessionId`, `isNewSession`); Tauri map them onto snake_case params in [lib.rs](apps/desktop/src-tauri/src/lib.rs). Frontend mint session UUID with `crypto.randomUUID()` — **and mcode mints its own**, a second id (`mvs_…`) that hz records on the index entry's `thread_id`. The two are joined there; neither is derivable from the other, and nothing about a session can be known before its spawn.
2. **`SessionManager`** ([session.rs](apps/desktop/src-tauri/src/session.rs)) own `Mutex<HashMap<String, Session>>`. On send: spawn process for new session, reuse live one when present, re-open the CLI's own session when the id is known but the process is gone. New sessions written to index before spawn, so one failing to start still visible, and created `SessionIndexItem` returned to frontend — `Some` on creation, `None` on resume.
3. **`mcode::init`** ([harness/mcode/mcode.rs](apps/desktop/src-tauri/src/harness/mcode/mcode.rs)) spawn `mcode acp` and handshake it: `initialize` with our client capabilities (`fs` and `terminal` both **declined** — advertising either invites requests this build cannot serve, and an unanswered one blocks the agent's turn), then `session/new`, `session/resume` or `session/fork`. Settings are applied **after** that, because none of them rides the spawn: model first (its reply states that model's effort ladder, which the effort below is judged against), then effort, then the stance.
4. Two `tokio::spawn` tasks drain stdout and stderr. Each non-empty stdout line go through [rpc.rs](apps/desktop/src-tauri/src/harness/mcode/rpc.rs)'s `accept` — which sorts a request from a notification from a response **structurally**, on whether it carries an id and a method — then `parser` → `Mapper::map` → the read loop's **`Coalescer`** → `app.emit("agent_event", &agent_event)`, with copy pushed onto `Session.events` and appended to session's JSONL. An agent **request** is answered from the read loop rather than mapped. **One demux per line, never two**: `accept` *settles* a waiter, and `settle` removes it, so a second look at the same response finds none and files a legitimate reply as a stray. The loop did exactly that once, and the prompt's answer is read ahead of the demux for the same reason — nothing waits on it.
   - **The coalescer holds one block's text deltas for a frame and merges them**, because a burst of them is most of the wire: one small turn is 262 lines and **203 of those are deltas** (133 thinking, 70 message), each of which otherwise costs a serialize, an IPC message and a React render. `COALESCE` is 16ms — a frame, and the number the agent's own TUI reasons with — and the timer is **anchored to the first delta of the run**, not to the read that just arrived, or a model streaming steadily would push the deadline ahead of itself forever and never draw. Anything that is not a text delta of the same block flushes what is held first, so nothing overtakes the row it belongs to; the merged event keeps the first one's `id` and `seq` (the ordering key only moves forward) and the newest `ts`. Three flush sites, and each is a bug if dropped: before a non-mergeable event, on a frame boundary with no line behind it, and at stdout's end.
5. **`useSessions`** listen for `"agent_event"`, route deltas into `streamingContentBlock` and everything else onto session's `events`. `Chat.tsx` render both.

**Finding the binary.** [binpath.rs](apps/desktop/src-tauri/src/binpath.rs) resolve `mcode` to an absolute path, cached in `OnceLock`; both spawn sites go through it. **The copy inside the bundle leads** — `<app>/Contents/Resources/mcode/bin/mcode`, a launcher the vendoring script writes — or a machine with an older `mcode` installed would run *that* instead of the one this build was tested against. Never `Command::new("mcode")`: a bundled `.app` launched from Finder or Dock inherit launchd's `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), which hold no `mcode` however installed, so a bare name work under `pnpm tauri dev` and fail in the bundle with no events arriving at all. Where no bundle copy exists (dev), resolution escalate by cost: inherited `PATH`, then known install dirs (`~/.minimax-code`, `~/.local/bin`, `~/.bun/bin`, `~/.npm-global/bin`, Homebrew, globbed nvm version dirs), then `$SHELL -l -c 'command -v mcode'`. `-l` load-bearing — without it zsh read `.zshrc` only and miss `PATH` exported from `.zprofile`. `git` need none of this.

**Worktrees.** mcode has no `-w` at all, so **hz makes the tree**: resolve the base (`git::default_base`, the repo's own default branch), `git worktree add --no-track -B` at `<project>/.claude/worktrees/<name>` on branch `worktree-<name>`, then spawn the child *into* it with no worktree argument. That is the whole reason `Capabilities::creates_own_worktree` exists and is false here: `Session::init` refuses a worktree name it was not told about, because a session that silently ran in the project root instead of its tree is the failure worth a refusal. Two consequences the composer draws: the branch picker is hidden in worktree mode (the fork point is resolved, not chosen), and the tree already exists and is clean at send time, so its baseline snapshot is exact.



## Parser conventions

[parser.rs](apps/desktop/src-tauri/src/harness/mcode/parser.rs) is the file most likely to need extending, and it has firm conventions:

- `ClaudeCodeEvent` = externally-tagged enum on `type`. `SystemEvent` and `ResultEvent` nest a **second** tag on `subtype`. Adding a new CLI event = adding a variant at the correct level.
- **mcode's shapes are typed**, tagged on the wire's own `sessionUpdate` discriminator — `agent_message_chunk`, `tool_call`, `tool_call_update`, `usage_update`, `available_commands_update` — with `#[serde(other)] Unknown` on every enum. An update this build has not been taught is a line that parses and maps to nothing, never a line that costs the turn.
- Genuinely volatile payloads (`rawInput`, `rawOutput.details`) stay `serde_json::Value`, and `details` is passed through whole: each tool fills it with its own shape, so one tool's shape failing to parse must not cost the other eleven.
- Fields the CLI may omit need `#[serde(default)]`. CamelCase wire fields need an explicit rename (`toolCallId`, `rawInput`, `sessionId`).
**Outbound lines are typed too** ([rpc.rs](apps/desktop/src-tauri/src/harness/mcode/rpc.rs)) — `request`, `request_detached`, `notify`, `respond` and `respond_err` are the only ways a line leaves the app, so no call site spells an envelope by hand. Typed despite nothing here failing loudly, because **a wrongly shaped reply is ignored in silence**: ACP answers what it recognises and stays quiet otherwise, so a drifted envelope presents as a hung turn rather than as an error.



## Test fixtures

Tests use `include_str!` against real captured CLI output under `harness/<name>/fixtures/`. To add coverage, capture real output, commit it, assert against it — the probe scripts are not committed, the captures are. A shape absent from every capture (a permission request, a `thinkingEffort` ladder) gets a hand-written test pinning what the CLI's own source documents, and the fixture README says which rows those are. Fixtures are a shared asset — a frontend test needing real wire output reads the same file rather than committing a second capture.

mcode's three, all captured against `mcode acp` 0.4.12, all `>> `/`<< ` one line each, both directions:

- `live_turn.jsonl` — the whole lifecycle at its smallest: `initialize` (capabilities, including the `image: false` the composer's attach path answers to), `session/new` with its `configOptions`, one prompt writing a file and running `wc -c`. The only capture of `available_commands_update`, of `usage_update` carrying a `cost`, and of the two `modes` a session opens with.
- `resume_fork_cancel.jsonl` — the three lifecycle calls a live turn never reaches. `session/resume` answers **no `sessionId`**; `session/fork` answers a new one; `session/cancel` is a **notification**, and the turn ends as the prompt's own response with `stopReason: "cancelled"`.
- `todowrite.jsonl` — a plan, which the strip, the panel and the transcript's plan rows are drawn from. The list rides the call's `rawInput` under `todos`; the same list comes back on `rawOutput.details.todos`. It also carries **80 bare `{toolCallId}` updates**, which is the evidence for skipping an update that says nothing.

**Filtering `cargo test` rewrites generated TS.** ts-rs regenerates `src/types/events.ts` from whatever exports ran, so `cargo test git::` leaves only git's types and breaks the frontend build. **Always follow a filtered run with a bare `cargo test`** — or, when the point was the types, run `pnpm types`: `cargo test export_bindings`, which is every export test by name and can therefore truncate nothing.



## When something breaks

**A render that throws no longer blanks the window.** React unmounts the whole tree when nothing catches, which is what the app looked like before: a white window over a perfectly alive process, no message and no way back. [RenderErrorBoundary](apps/desktop/src/components/RenderErrorBoundary.tsx) is mounted twice — around the main column's bodies, so one bad row costs one view rather than the sidebar, header and composer with it, and around `<App/>` in `main.tsx` as the floor. **It takes a `resetKey`**, and that is not decoration: a bounder latches on the error it caught, so keyed on the session and view, moving anywhere else drops it rather than leaving the pane broken for the rest of the run. The panel shows the message itself, a Reload and a clipboard copy — and **nothing goes to analytics**: an error message is arbitrary text that routinely carries a path, the same rule the `error` event states.

**A read that runs long says so, and only then.** [slow.ts](apps/desktop/src/lib/slow.ts) wraps an `invoke` at the call site — never the `invoke` helper, which would cover `send_msg`, and a send already has its own indicator. Four seconds in, one line appears bottom-left naming what is being read; it clears a beat after the read lands, or on a failure too, since the composer's error slot is then saying what actually went wrong. **One line at a time, naming the oldest read still running**: a second slow read is the same wait seen from another angle, and stacking them turns a sentence into a wall. The call sites are the reads that otherwise leave an empty pane — providers, models, the session index, the context probe.



## Current state

Several things are deliberately unfinished — don't mistake them for bugs.

- **Session status is a state machine in `session.rs` and it follows the turn alone.** `StatusTracker`: send or `init` → `in_progress`; `result` → `completed`, whatever background tasks are outstanding. A background subagent runs past `result` and the CLI opens a promptless `init` later to report findings, which reopens `in_progress` on its own. Holding *was* the rule and it hung every session running a dev server or `Monitor`, all `local_bash`, none of which ever end. The task set is recorded beside status for one thing only: `has_outstanding_work()` guarding child-replacing paths (effort respawn, update install) — fork is **not** among them, since it replaces no child, and **Stop is not either**. The frontend keeps tasks in a live `tasksBySession` map, not off the log, since a task outlives its turn; `read_stdout` mints an empty `background_tasks_changed` when the child exits, emitted and **never logged** (it runs after delete removed the file, where an append would recreate it). `buildTranscript` takes live task ids and keeps a spawning call pending while its task lives, joining on `SubagentRun.taskId`, since `task_id` ≠ `tool_use_id`. `completed` means finished *and unread*: the frontend clears it to `idle` on view, and a persisted `in_progress` resets to `idle` at startup. Status changes reach the frontend as `session_status` events — derived state, never written to the log.
- **mcode runs, over `mcode acp`, and the vocabulary is ACP's.** Spawn, `initialize`/`session/new`/`resume`/`fork`, prompt, cancel, and the settings that move in place. The transcript draws messages, thoughts (with their text), tool calls off ACP's `kind`, and results off `rawOutput`. The context ring fills from `usage_update`. Permissions are the agent's own options, carried back whole. **Read [harness/mcode/fixtures/README.md](apps/desktop/src-tauri/src/harness/mcode/fixtures/README.md) first** — it names what each capture pins, including the two shapes no capture has yet (a permission request, a `thinkingEffort` ladder).
- **What is not wired yet**: subagent lifecycle beyond the spawning call (mcode's `mcode/session/delegation_*` extension notifications land in `SessionUpdate::Unknown`).
- **A session's goal is wired; the rest of the extension surface is not.** mcode advertises thirty `mcode/session/*` methods and the app calls nineteen of them — the ones with a screen behind them: the goal calls above, `steer`, the delegation roster and its messages, `set_config_option`'s neighbours, `cancel`. What is left is either the agent's own accounting (`goal_updated` is read; the rest of the family is not) or a surface this app does not have.

- **The PR panel reads, acts, and answers.** It used to stop at reading and acting — no comment, no reply to a review, no review of its own, no reviewer request, no close. All six exist now, and what every one of them writes is the **reader's** text, passed through untouched.
- **Forks copy the conversation whole and record no lineage.** The CLI exposes no fork-at-message, and `fork_from` is cleared once the CLI carries the fork out, so nothing on disk says which session a fork came from.
- **hz writes only status and priority**, from the opened issue's header — no comment, no attachment, no assignee, no label — and there is **no issue-side project mapping**, the connection being workspace-wide. The `hz` CLI writes nothing.
- **The handoff row has no Revert, Amend or Stash** — each destroys or rewrites work, and a button that sends a prompt for one is a button whose blast radius is decided by the model. No Push either, and that one went on width.
- **The repo view reads — no fetch, no pull, no discard — and undo is the one write.** The ahead count is against the *last known* upstream, so a branch someone else pushed to reads as level until the push itself fails.
- **Sidebar PR marks say open, draft or merged; checks say running or failing.** No number, no per-check detail, no merge readiness, nothing at all for passing.
- **Spawned sessions inherit permission mode, so most block immediately.** The default stance is `auto`, so a fanned-out session stops at its first `Write` waiting for a card nobody is next to. `hz new` takes no `--permission-mode`, and adding one raises a real question: an agent in a `plan` session spawning a `bypassPermissions` child is an escalation past the stance the user set. Clamping the child to be no more autonomous than the parent is the likely shape of the fix.
- **No reading a transcript back.** Create, list and send exist; reading what another session said does not, and a parent cannot learn a child finished except by polling `hz ls`.
- **A search hit opens the session and not the sentence.** `TranscriptMatch` carries the `seq` it was found at, and nothing consumes it: the row calls the same `handleSelectSessionIndexItem` every other row does, so the reader lands at the bottom of a transcript that may be eleven megabytes long. Taking them to the line needs the transcript to scroll to a `seq` — the rail already scrolls to a *turn*, so the missing piece is the mapping rather than the mechanism.
- **An automation cannot be edited, only made and deleted.** The settings tab lists them with a switch and a delete, and the form at the bottom makes one; changing a prompt means deleting and making it again. Nothing keeps a run's history either — the row shows `lastSessionId`, so the last run is one click away in the sidebar and the ones before it are not.
- **TS event types are generated, not written.** `ts-rs` derives them into `src/types/events.ts`, checked in so the frontend build needs no Rust toolchain. `cargo test` regenerates; never edit the output. Two settings live in `src-tauri/.cargo/config.toml`: the export path, and `TS_RS_LARGE_INT = "number"`, because `u64` otherwise becomes `bigint`, which `JSON.parse` never produces.



## Known issues

Diagnosed defects, not yet fixed. Unlike _Current state_ above, these are broken rather than unbuilt. Delete an entry when you fix it.

- **"Check for Updates…" answers into a void when the sidebar is collapsed.** The verdict draws in `UpdateRow`, which lives inside `<aside>`. Fix = a surface not tied to the sidebar.
- **Quit from the Dock's context menu is unguarded.** It bypasses the menu bar, so the custom Quit item never sees it. Nothing in the Tauri API reaches it today.
- **A blocked install has no way to say when it unblocks.** It waits on any session being mid-turn but names none. That sentence sits in the button's tooltip, which is why the button carries `aria-disabled` and guards its own click instead of taking `disabled` — a disabled button fires no pointer events to open a tooltip.
- **A live background task defer that respawn silently**, since `has_outstanding_work()` guard every child-replacing path and a `local_bash` task never end on its own. The reader change effort or model, nothing happen, nothing say why. Stop used to be the way out by draining the set; it deliberately isn't any more (DRA-185), so nothing in the app can drain it. Cure = saying so, not putting the fan-out back.
- **A permission request stranded by a child dying mid-run is unanswerable.** The pending map lives in `Session`, so an effort-change respawn leaves a card whose buttons error. Restart is fine, and the CLI re-asks on resume.
- **A worktree session's first baseline is a guess, and the reflog holds the answer.** `base_ref_tree` resolves the fork point the way the CLI does, but the CLI fetches `origin/<default>` first, so an upstream commit landing in between is attributed to that turn. `git worktree add -B` writes a reflog entry naming the commit it actually used, readable lazily even after the agent commits. Take the newest "Created from"/"reset" entry, not the oldest.
- **Nothing handles a command that restarts or replaces a session.** `clear`, `fast`, `model` and `rename` were the four, and what is left of them is smaller than the note that stood here claimed: the picker hides nothing, and of the four only `model` is still a command the CLI publishes. `model` moves the running child off what the composer displays, and the app hears about it in two places — the reply to the `session/set_config_option` it sent, which states the whole option list and is what `models::remember_configs` reads, and a `config_option_update` the agent pushes afterwards, which this build maps to nothing. The reply covers every change hz itself makes, so the gap is narrow: a model moved by the agent on its own — the command typed in the CLI's own terminal, a provider falling back — reaches the composer only at the next handshake. `commands_changed` is a related loose end: the CLI publishes it when available commands change, which would fix the restart-to-see-a-new-plugin caveat.
- **A hard kill mid-dictation leaves the output muted.** The record of what to restore lives in the process, so `SIGKILL`, a panic or a power cut get past `RunEvent::Exit`. Quit and window close are covered. The cure is durable state or a watchdog, neither of which a mute is worth today; unmuting by hand is the recovery.
- **A background subagent's report-back is a second `completed`**, so a session with one raises two "Task finished" notices.
- **The PR polls share one GitHub rate-limit budget with every agent in every session.** Sidebar marks ask `gh` once per repo every 30s, the panel polls again at 15s while anything is in flight — against a *per-user* budget that every agent's own `gh` call spends too. **GraphQL's budget is 5000 *points* an hour, charged on the shape asked for, not on what comes back**: nested `first`s multiply, so the panel query at `20 × 50 × 50` cost 11 points per read of a branch with *no PR at all*, and two hz instances (release beside a `tauri dev`) on one open PR tab drained the hour on their own (DRA-247). It is two aliased connections now — five open, two settled, thirty threads of fifty replies — measured at 2 points; measure any change to a query with `rateLimit{cost}` before shipping it. A second shape remains: `gh pr create` answering "API rate limit already exceeded" while `gh api rate_limit` reports the primary limit untouched is the **secondary** limit, which has no reset timestamp to wait on, and the cure at the agent's end is exponential backoff, which is GitHub's own guidance.


