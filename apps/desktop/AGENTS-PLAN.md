# Agents plan

Goal: hz stops being a chat wrapper around one CLI. It becomes a workspace of
**persistent agents**: named teammates, one endless chat each, with their own
instructions, memory and folder, able to message each other. Each runs on the
reader's own Claude Code, Codex or OpenCode. `mcode` leaves the bundle.

Last updated 2026-10-23. The branch is `feat/agents-multi-harness`; nothing here
is committed.

## Where we are

**Built and compiling** (Rust 699 tests, front 1185, clippy and biome clean):

- The engine runs the three CLIs over ACP, one code path
  ([dialect.rs](src-tauri/src/harness/mcode/dialect.rs) holds launch, config ids
  and stances). Adapters live pinned under `~/.hz/adapters`, not `npx`.
- Sidebar of agents. An agent is a roster entry: name, mascot, role, instructions,
  CLI, folder, model, effort. It owns one session, bound at its first message.
- Composer has no folder, worktree, branch, agent or model pickers. They moved
  into the agent: the New agent dialog, and the **Agent** tab of the right pane
  (inline settings with autosave, instructions, memory notes editor, team, remove).
  That tab is now the profile page of phase D.
- The Diff tab is gone from the pane.
- Instructions reach the agent as a briefing put in front of a prompt, only when
  its text changes ([agents.rs](src-tauri/src/agents.rs), `brief`).
- Memory is a folder of Markdown notes per agent, `~/.hz/agents/<id>/memory`. The
  agent reads and writes it with its own file tools. The pane edits the same files.
- `team` MCP server on loopback ([team.rs](src-tauri/src/team.rs)): `team_list` and
  `team_message`. A message to a teammate with no conversation opens one.
- Message lines between agents are drawn as one quiet dated line, from both ends.
- A new agent greets by itself: a hidden first prompt (`<hz-intro/>`, see
  [intro.ts](src/lib/intro.ts)); the chat shows only the reply.

**Checked live:** a Claude agent answers; `team_message` was called by a real agent
and delivered. **Checked by script only:** a Claude session survives killing the
adapter and `session/resume`.

**Not checked live:** Codex and OpenCode sending a prompt, permission cards and tool
rows for the adapters (the mapper was built on mcode and Claude shapes), the
greeting, the Agent tab in the window, the agent hero.

**Still wrong or missing:**

- The roster lives in `localStorage` and is mirrored to Rust. Clearing storage
  deletes every agent.
- mcode is still in `Harness::ALL`, `vendor-agent.sh` and the 182MB bundle. The
  `hz` CLI help still says `claude_code or codex`.
- Titles for the three CLIs come from the first prompt.
- Nothing caps agent-to-agent messages. Two agents can loop.
- Fast mode, per-model effort in the composer and "same prompt to several models"
  went with the model picker.
- Adapters are about 330MB each, need Node, and install with no progress.

## Decisions

- **ACP adapters, not native dialects.** One path for three CLIs. The old native
  `claude_code` and `codex` dialects stay in git history (`d1883b07^`) and are not
  coming back.
- **The engine's `agent_name` carries the roster agent id** for the three CLIs. It
  is already part of the parked session's identity, so one agent's reserved session
  is never adopted by another. mcode's own use of it is unchanged.
- **The webview roster is the source of truth** and mirrors to Rust with
  `agents_sync`. The backend needs it while nobody is typing.
- **Permissions stay ACP's `session/request_permission`.** OpenBot runs with no
  approvals; we do not. The agent default is still bypass, which is the first
  thing to change for a company (see phase 2).

## Speed: what we measured

Claude through the adapter, called directly, in `hyze-cloud` with the reader's own
Claude settings:

- A short reply starts in 1 to 2 seconds. High effort adds about 1.7s. Low and
  medium were the same.
- Three turns in a row on one session gave 1.0s to 13.2s. The spikes are the API,
  not hz: they happen with no hz in the way.
- Thinking is **silent**: Sonnet 5.5 sends no thought text, so nothing is drawn until
  the answer starts. That reads as a hang.
- Fixed earlier: a 14 to 27s wait before every first message was the baseline git
  snapshot hashing 3GB of untracked files each time. It now keeps its own index.
- The reader's `~/.claude` has hooks on eleven events and two plugins. `claude -p`
  takes 16s with them and 7.6s without. In the warm adapter we could not show a
  per-turn cost against the API noise.

What the two references do about it: neither pre-warms. Codync starts a bot's
process on its first message and closes sessions idle for 30 minutes. OpenBot keeps
one long-lived SDK process per thread, releases it after 10 idle minutes (two idle
at most) and resumes from disk. We already pre-warm while the reader types, which
beats both. Switching ACP for the Agent SDK would not remove the wait: the Claude
adapter runs the same SDK.

## References and licences

- **Codync** ([leepokai/Codync](https://github.com/leepokai/Codync)), Apache-2.0.
  Rust host, so its host code ports nearly as is. Keep `LICENSE` and a `NOTICE`
  line. Its name and logo are not ours to use (`TRADEMARK.md`). Its React UI is a
  pattern source only.
- **OpenBot** ([nightly-labs/openbot](https://github.com/nightly-labs/openbot)),
  PolyForm Noncommercial. Ideas only. Never copy its code.

### What to take

From **Codync**:

- SQLite store with a global `rev`; clients reconnect with `since: rev`.
- One actor per agent: own queue, messages sent while busy folded into one turn,
  an interrupted turn resumed after a crash.
- Instruction snapshot frozen per session and compaction epoch, sent as a real
  Claude system prompt (`_meta.systemPrompt`, `excludeDynamicSections`) so the
  prompt cache stays warm.
- Host-timed compaction and rollover with a handoff.
- Memory in two layers with versions, who wrote what, and a keeper that
  consolidates ("dreaming"). Changed memory gets a notice on the next turn.
- Built-in MCP set: `team` (`ask_bot` waits, `message_bot` queues, cycle checks, 10
  minute cap, 64 outstanding), `memory`, `chat`, `routines`, `manage`.
- Fallback agents: Claude then Codex then Gemini when a limit is hit.
- Chat that shows only the user's messages, each turn's final reply, approval cards
  and notices; "Full conversation" holds tools and thoughts.
- Roster row: preview, unread, a live activity line. Reorder.
- Group chats: `@name` picks who answers, up to 3 rounds and 10 replies, `(pass)`.
- Reply and quote; compact "3 messages with Owen" rows that open the pair's thread.
- Credential vault, version floors (`minApp`, `minHost`), consented error reports.
- Recovery screens with the mascot.

From **OpenBot**:

- Message queue you can see: edit, hold, reorder, steer. Crash-safe.
- Agent communication policy: explicit reply, no "ok" loops, queues cleared on stop.
- Channels with one owner per task (explicit recipient, then task reply, then the
  sole open task, then a router), and a separate execution thread per channel-agent
  pair so channel turns do not fill the agent's own chat.
- Handoff packet capped at 32K, plus `history_search` and `history_read` tools.
- Tasks as sub-threads with their own queue and result.
- Provider runtime manager: pinned downloads, hash check, hourly update check, a
  blocklist for bad versions, an update toast.
- Local scripts API and CLI that waits for the answer and returns JSON.
- Idle-aware update and restart: never kill a running turn.
- Payload-free span trace and an exportable support bundle.
- Privacy statement per feature, an analytics inventory, a troubleshooting doc.
- Agent access roles and approval automation.
- Routines by schedule or signed webhook, quiet runs, a calendar feed.
- First-run flow that detects installed CLIs and walks through sign-in.
- A lint rule that bans raw colours and raw buttons: cheap, protects the design.

### What not to take now

Notch island, remote screen and computer use, iPhone and Android apps with push,
Electron main-process code and SSH tunnels, the 40-agent registry long tail, hosted
multi-tenant servers, Slack/Discord/Telegram relays.

## Roadmap

Each step leaves the app building and the tests green. Size is S, M or L.

**0. UI from the studio mockup** (first, asked for on 2026-10-23). The mockup is
approved and is the spec. The full conversion plan is its own section below:
[From mockup to app](#from-mockup-to-app), phases A to L.

**1. Speed you can feel**

- [x] Log first-response time inside hz (`[turn] first response …`). S
- [x] "Working for Ns" timer from the moment a prompt is sent. It already existed. S
- [x] Instructions as the Claude system prompt (`_meta.systemPrompt`), prefix kept
      for Codex and OpenCode. Checked against the real adapter. M

**2. Trust and base**

- [x] `team_ask` that waits, with a cap of 8 hand-offs, self-send, duplicate and
      cycle rejection. State machine unit-tested; not yet run between two live
      agents. M
- [ ] Durable queue per agent with steer. M
- [x] Roster kept on disk (`~/.hz/agents.json`) and restored when the webview store
      is empty. Export and import by hand: it is one JSON file. M
- [x] Permission policy per agent (ask first, plan, auto, full access), default
      `auto`. Allowed folders not done. M
- [x] Codex and OpenCode turns captured for real and run through the mapper
      ([claude_turn, codex_turn, opencode_turn](src-tauri/src/harness/mcode/fixtures)).
      This found that Claude's tool results never closed (`rawOutput` is a bare
      string, the parser wanted a struct) and that Codex sends shell output in
      `_meta`; both fixed. Not yet sent live from the window. M

**3. Daily use**

- [ ] Final-replies-only chat with a Full conversation sheet. M
- [ ] Roster row with a live activity line, unread and reorder. S
- [ ] Reply and quote. M
- [ ] Compaction and rollover with a handoff; the chat stays one chat. L
- [ ] Memory keeper and `history_search`. M

**4. Team**

- [ ] Channels: Codync's `@name` rounds with OpenBot's owner and separate threads. L
- [ ] Fallback between CLIs on a limit. M
- [ ] Routines with webhook and quiet runs; local API and CLI that waits. L
- [ ] SQLite store with a `rev`, replacing per-session JSONL. L

**5. Operation**

- [ ] Provider runtime manager for the adapters, with progress and hash check. L
- [ ] First-run flow, recovery screens, TROUBLESHOOTING doc. M
- [ ] Idle-aware updates and version floors. M
- [ ] Span trace, support bundle, privacy doc. M
- [ ] Remove mcode: `Harness::ALL`, module, `vendor-agent.sh`, bundle, `hz` help. M

## Rules we keep

- ACP permissions stay the agent's own. No agent runs with approvals off by default
  once phase 2 lands.
- Sessions an older build wrote must still read (`Harness::Other`).
- Nothing the agent writes to memory is trusted as a secret store. Scan before it is
  exported or shared.
- When porting Codync code: keep its licence text and a `NOTICE`, never its name.
- Read [FEATURES.md](FEATURES.md) and [DESIGN.md](DESIGN.md) before touching a
  surface.

## From mockup to app

The mockup is [design/studio.html](design/studio.html) with its code in
[design/studio/](design/studio/): one stylesheet and one script per surface. It is
the spec for every screen, every button and every state. Open it with
`node apps/desktop/design/serve.mjs` from the repo root, then `localhost:4719`. The
browser pane snapshots `file://` pages, so the split files only load over http.

### Ground rules

- **Rebuild, don't paste.** The mockup is vanilla JS that rewrites `innerHTML`. The
  app is React 19, Tailwind 4 and the `ui/` primitives (Radix). Port the markup and
  the CSS values; write the behaviour as components and hooks.
- **All of it ships. Literally everything in the mockup**, including the features
  the app has no backend for today (channels, routines with webhooks, grants, plan
  limits, invites, light theme…). Nothing is cut, hidden or faked. A feature with
  no backend gets one, and a button that only says "done" is a bug. The checklist
  in [Every feature in the mockup](#every-feature-in-the-mockup) is the contract:
  the conversion is finished when every box in it is ticked.
- **Tokens first, then screens.** No screen gets restyled until its tokens are in
  `App.css` (phase A). Colours come from tokens, never from hex in a component.
- **Dark first, light after.** The mockup is drawn dark. Every colour is a token, so
  the light theme (the Preferences picker offers it) is phase N, not a rewrite.
- **Pixel only in identity.** Faces, banners and tiles are pixel. Labels, icons,
  buttons and type are not. The mockup removed Silkscreen and caps on purpose.
- **Each phase ends green**: `tsc`, `pnpm lint`, `pnpm test`, `cargo test`,
  `cargo clippy --all-targets -- -D warnings`. Then a side-by-side check of the
  screen in `pnpm tauri dev` against the mockup.
- **DESIGN.md is rewritten as phase A lands**, not after. The mockup replaces its
  visual language; vibrancy, the titlebar drag region and the radius notes that
  still hold stay.

### What the mockup is made of

| Mockup file | Becomes | Notes |
|---|---|---|
| `studio.css` `:root` | `App.css` theme tokens | `--bg --side --s1..3 --line..3 --ink..4 --r1..4 --shadow`, amber/green/red/blue |
| `icons.js` `LUCIDE` | `lucide-react` | Already a dependency. Same names, 1.75 stroke |
| `icons.js` `BRANDS` | `src/lib/brands.ts` | The 15 Simple Icons paths we use, vendored (CC0). No new dependency |
| `core.js` heads, `dither`, `tileHTML` | `lib/mascots.ts`, new `lib/dither.ts`, `<AgentTile>`, `<PixelBanner>` | Merge with today's `AgentAvatar`, `PixelBanner`, `Mascot` |
| `core.js` toast, pop, menu, drawer, modal | `ui/toast`, `ui/popover`, `ui/dropdown-menu`, new `ui/sheet`, `ui/dialog` | Sheet has two homes: docked right, or centered with a full-screen toggle and a `bare` mode |
| `chat.js` sidebar | `AgentSidebar.tsx` | Replaces `Sidebar.tsx` (118 KB) for good |
| `chat.js` chat, composer, files, channel | `Chat.tsx`, `chat/*`, `ChatInput.tsx`, new `ChannelView.tsx` | |
| `profile.js` | new `AgentProfile.tsx` + one file per tab | Replaces the Agent tab in `RightPanel` and `AgentPanel.tsx` |
| `inbox.js` | new `AgentInbox.tsx` | Replaces `InboxView.tsx` |
| `prs.js` | `PrsView.tsx` rewritten as the board, `PrPanel.tsx` into the centered sheet | Keeps `github.rs`, `usePrList`, `usePullRequest`; Issues deleted |
| `routines.js` | new `RoutinesView.tsx` | On `automations.rs` |
| `plugins.js` | `PluginsView.tsx` rewritten | On `plugins.rs`, `usePluginMcp`, `usePluginSkills` |
| `settings.js` palette | `CommandPalette.tsx` | Already exists; gains groups and the new sources |
| `settings.js` new agent, new channel | `NewAgentDialog.tsx` rewritten, new `NewChannelDialog.tsx` | |
| `settings.js` settings pages | `SettingsDialog.tsx` + `settings/*` | Six pages, spaces removed |
| `app.js` | hooks and handlers | The `ACT` table is the checklist of handlers each screen needs |

### Data the screens need

New or changed records. Rust owns each one on disk under `~/.hz`; types reach the
front end through ts-rs.

- **Workspace** `{id, name, mark, color, logo?, context, members[]}` in
  `workspaces.json`. An agent gets `workspace_id`; the roster's `space` goes. The
  workspace context goes into every agent's briefing, ahead of the agent's own
  instructions.
- **Me** `{name, calls, language, status, avatar: {kind, color} | photo}` in
  `settings.rs`. The status gates notifications: Focus holds non-urgent ones, Away
  queues them.
- **Agent** gains `effort`, `always_ask[]`, `folders[] {path, write}`, a monthly
  `budget`, `muted` and `pinned`. CLI and folder stay fixed after creation, as the
  mockup's lock says.
- **Instructions history**: each save appends a version to
  `~/.hz/agents/<id>/instructions/`. Restore writes a new version; it never
  rewrites an old one.
- **Memory notes** already exist. They gain a `tag` (About you, Project,
  Decision) and a provenance line read from front matter. "Used in N answers"
  is counted by moving memory reads onto a hz `memory` MCP tool (Codync's model):
  each read of a note bumps its count, and the agent still sees plain Markdown.
- **Inbox item** `{id, kind: approval|question|mention|done, agent, title, sub,
  payload, created, state, resolution?}`, derived and persisted in `inbox.json`.
  - An *approval* is ACP `session/request_permission`.
  - A *question* is a new team tool, `ask_user`, which blocks like `team_ask`.
  - A *mention* is `@Me` in a channel.
  - *Done* is a turn that finished while you were elsewhere.
  - Resolving an approval answers the pending ACP request.
- **Channel** `{id, workspace, name, purpose, members[], lead, mode: mention |
  turns | lead, rounds}` with its own transcript. Each agent gets a separate
  execution thread per channel (OpenBot's rule), so channel turns stay out of its
  own chat.
- **Routine** extends `automations.rs`:
  - fields: `trigger: schedule{days, time, tz} | webhook{source, event}`, `agent`,
    `act`, `prompt`, `to: agent chat | channel | inbox`, `quiet`;
  - a `runs[]` history with duration, cost and status.
- **Plugin** = an MCP server per workspace `{id, kind: catalog|custom, slug?,
  transport, url|command, env, tools[] {name, policy: allow|ask|off}, grants[]
  agent_id}`.
  - **Skill** = a `SKILL.md` per workspace with `grants[]`.
  - Grants decide which servers and skills go into an agent's `mcpServers` and
    briefing on its next session.
- **Usage**: per turn, from `usage_update` (tokens, cost), rolled up per agent and
  month.
- **CLI status**: version, path, account, adapter version and an available update,
  from `binpath.rs` and `~/.hz/adapters`.

### Phases

Size is S, M or L. "Done when" is the check before ticking the box.

**A. Foundation.** L
- [ ] Tokens from `studio.css` into `App.css`. Map shadcn's names (`--background`,
      `--muted`, `--border`…) onto them so untouched screens keep working.
- [ ] `<AgentTile>`, `<PixelBanner>`, `<Dither>` on one canvas helper. `<BrandMark>`
      from `brands.ts`.
- [ ] `ui/sheet` (docked, centered, full-screen, bare), toasts with an action
      (Undo), popover menus with sections and checks, the confirm dialog with
      type-to-confirm.
- [ ] DESIGN.md rewritten to the new language.

Done when a demo page renders every primitive in both sheet homes.

**B. Shell, workspaces and you.** M
- [x] Sidebar as the mockup: workspace switcher, Jump to, Inbox with count,
      Routines, Plugins, channels with faces, agents with role, a live line,
      Working / Needs you chips, unread dot, and the status menu on you.
- [x] Workspaces: create (name, colour, context), switch, rename, logo upload and
      generate, delete (type the name).
- [x] Settings → Profile and Workspace pages. Spaces settings deleted.

Done when two workspaces each show only their own agents and channels after a
restart. (Built and tested: agents filter by `workspaceId`, the pick is durable. Channels
is a placeholder page until G; the Invite button is disabled until M.
Checked in the browser against the mockup with a mocked backend, not yet in `pnpm tauri dev`.)

**C. Agent chat.** L
- [x] Header chips (CLI, model ▾, folder, permission ▾), and the ⋯ menu: Pin to top,
      Mute, Export to .md, Clear chat (a fold, nothing deleted), Remove agent (type
      the name).
- [x] Message rows, the hover bar (react, reply, copy, more), reactions that
      toggle, and **reply**: the composer header and the quote that jumps. More:
      Remember this (a memory note plus an index line), Copy link, Make it a
      routine, Delete message with Undo.
- [x] "See what it did" with timings, file and PR cards opening a docked sheet
      (document: Open in editor, Download, Ask the agent; PR: diff, Open on
      GitHub, Approve), the exchange line and its sheet, the inline approval,
      the live checklist and terminal card, the working pill with a clock and
      Stop, Take over.
- [x] Composer:
  - [x] `@` mention list with keys and `/` commands (`remember`, `routine`,
        `clear`, `ask`, `handoff`);
  - [x] format buttons, attach chips, emoji, dictation (`useTranscription`) with
        a clock;
  - [x] Enter sends.

Done when a reply survives a restart and still jumps to its quote. (The data does:
`reply_to` is on the logged prompt and tested through the log round trip. Checked in
the browser with a mocked backend, not yet in the running window.)

What is not there, and why:
- **Take over is line based.** A real shell on a pty (`pty.rs`), but no terminal
  emulator, so full-screen programs draw as noise. It does not pause the agent; the
  sheet offers Stop.
- **Copy link copies `hz://chat/<session>#<seq>`; nothing opens it.** That needs a
  deep-link handler.
- **Make it a routine and `/routine` open the routine editor** (phase H), prefilled
  through `routineDraft`.
- **No thread-draft card.** Nothing an agent emits today is one.
- **Reactions, tombstones and page folds live in the webview's storage**, like the
  roster's old copy: another machine does not see them, and clearing site data loses
  them. They are view state; the log is never touched.
- **The terminal card shows the tool's result, not a live tail**, because the result
  arrives whole.

**D. Agent profile.** L
- [x] Hero with banner, face and numbers (messages over 14 days, tasks, notes,
      hours).
- [x] Overview: Right now, Recent work, the sheet with model and effort menus,
      Knows, Works with.
- [x] Instructions: the editor with autosave, snippets, "what it reads first" with
      token counts, and version history with restore.
- [ ] Memory: search, tag filter, edit, forget with Undo, new note, Tidy now.
- [ ] Access: the permission ladder, always-ask switches, folders, tools, who can
      talk to it, budget.
- [x] Activity: the heatmap and the filtered feed.

Done when editing instructions here changes the next turn's system prompt. (It
does: the roster mirrors to Rust, the briefing's digest changes and the next send
re-sends it. Checked by the briefing tests, not yet by a live Claude turn.)

Built in `components/profile/` and the Rust modules `agent_profile.rs`,
`agent_activity.rs`, `budget.rs` and `memory_mcp.rs`; the Agent tab and
`AgentPanel.tsx` are deleted. Checked in the browser with a mocked backend
(`demo-profile.html`), not yet in `pnpm tauri dev`. Why two boxes stay open:
- **Memory:** every control works against the files and is tested, but "used in N
  answers" counts reads through the new `memory` MCP tools, and no live agent has
  called them yet; Tidy now is a real hidden turn that has not been run against
  one either. Tick it after a live Claude agent reads, writes and tidies.
- **Access:** the ladder, who-can-talk (refused in `team.rs`), the Team and Memory
  tool switches and the budget (warn at 80%, refuse prompts at 100%) are enforced.
  **Always-ask rules are advisory**: they are hard lines in the briefing and no
  tool call is intercepted. Folders are real for Claude only (`additionalDirectories`,
  unrun live); the other CLIs are told in words, and read only is a rule, not a lock.
  Tool switches cover hz's own servers; the plugins an agent holds are switched
  in the same block (phase I).

**E. New agent and edit look.** M
- [x] The Discord-style card: banner, face on its edge, live name and role.
- [x] Templates, who it is (faces and colours), where it runs (CLI, folder,
      permission), how it works.
- [x] Edit look reuses the card.

Done when Create opens the chat and the agent greets. (The card was checked against
the mockup in the browser with mocked IPC. The greeting is the existing path in
`App.tsx`, not yet checked in `pnpm tauri dev`.)

**F. Inbox.** L
- [x] Items from permission requests, `ask_user`, agent mentions and finished
      turns, persisted in `~/.hz/inbox.json` (`inbox.rs`).
- [x] Channel mentions: filed with the channel and answered into it from the Inbox.
- [x] Reading pane: approval with the command, the post preview or the diff,
      question with choices or free text, mention with reply (into the agent's
      chat).
- [x] Resolve, Undo (disabled with "Already sent" once the agent has the
      answer), the settled check, J / K / A / D / E / 1–3, Mark mentions read,
      inbox zero.
- [x] "Always allow" writes an allow rule that `raise_permission` enforces
      (allow-once only, command words or folder, never shell syntax).
- [x] The old tracker Inbox is deleted (`InboxView`, `InboxTabs`, `lib/inbox*`,
      old `useInbox`); the sidebar badge counts open items.

Done when Allow in the Inbox lets a blocked agent continue. Built on the
existing `respond_permission` path and covered by the store tests and a mocked
page; **not yet checked against a live CLI in `pnpm tauri dev`**.

**G. Channels.** L
- [x] Create and edit (name, purpose, members, mode, lead, rounds), members sheet,
      archive.
- [x] Rounds: `@name` picks who answers, otherwise the lead routes. Each agent
      answers once per round; rounds are capped.
- [x] Task cards and the about panel. Approvals inside a channel are the same
      Inbox items.

Built in `channels.rs` and `ChannelView.tsx`; see FEATURES.md, Channels. Enforced:
rounds, the 10-answer cap, once per agent per round, owner-only task updates, thread
separation. Advisory: Mute (unread mark only). **Not yet run against a live agent in
`pnpm tauri dev`**; checked by `cargo test` with a scripted host and in the browser on
`demo-channel.html`.

Live bug (first real run, #teste): a post showed "answering" forever and the agent's
answer sat in its hidden thread. Cause: mcode's prompt reply has only a `stopReason`, so
every turn closed with `final_text: null` and the ask read it as `(pass)`. Fixed in the
mapper (last answer text becomes `final_text`). Same round: channel threads carry
`purpose: "channel"` and are silent everywhere (no unread, toast, banner, search hit,
page); the "Task finished" card is deleted; `routeForSession` blocks raw session pages;
twin names are numbered; failures get a Retry. Not done: a read-only view for sessions
no agent owns.

Bug-fix round (tests only, still no live agent): two chains in one room no longer clear
each other's typing line; Stop settles the ask in flight and leaves no "could not
answer" note; the open page learns of a new message's counters, so the sidebar dot
clears; the page reads after its listeners attach; a refused post puts the words back.
The composer lost its mascot, Commit row, goal control, permission selector and
context ring.

**H. Routines.** L
- [x] Schedule on the existing poll. History per run.
- [x] The week strip with faces per run, and the sentence rows with editable
      words.
- [x] Run now, pause, duplicate, delete with Undo, and the centered editor with
      templates and a live sentence.
- [ ] Webhooks: the local endpoint, then a public URL through the relay (open
      question 3), with a signing secret to copy and reveal. (The local endpoint,
      HMAC checks for GitHub, Stripe, Linear, Sentry and Custom, and the secret
      to show, copy, replace and regenerate are done and curl-tested against the
      built binary. The public relay is the part left, by decision 3.)

Done when a routine fires into the agent's chat on schedule and from a signed
webhook, and its run shows on the week strip. (Built and tested: next-run math,
migration, HMAC, webhook mapping and history in `cargo test`, sentence and week
bucketing in vitest. Checked in the browser with a mocked backend, and the
listener with curl against the built binary; not yet a live agent answering a
routine in `pnpm tauri dev`.)

What is not there, and why:
- **The Inbox and Channels take results now** (`routines::Live`): a done note in the
  Inbox, a post in the channel as the agent. Tested with a spy sink, not live.
- **No IANA time zones.** `tz` is `local`, `UTC` or a fixed offset: no timezone
  database in the build. `local` follows the machine through daylight saving.
- **No public URL.** The reader points their own tunnel at the local port; the
  editor's helper text says how.
- **A routine from before agents has no agent** and runs as its own session on
  its old interval until it is saved in the editor.

**I. Plugins.** L
- [x] Connected cards with real marks and calls per week; the agent × plugin grant
      matrix.
- [x] The centered detail: pixel banner, per-tool Allow / Ask / Off, grants,
      recent calls, Reconnect, Disconnect.
- [ ] Catalog from servers with official remote MCP and OAuth (GitHub, Linear,
      Notion, Sentry, Stripe, Vercel, Supabase…), the three-step Connect, and Add
      MCP server with a test.
- [x] Skills: paper cards, the editor, grants.

Done when a granted tool shows up in an agent's next session and a revoked one
does not. (Built in `plugin_store.rs`, `plugin_proxy.rs`, `plugin_oauth.rs`,
`mcp_client.rs`, `keychain.rs` and `PluginsView` with `components/plugins/`; the old
mcode-backed page is gone. **Enforced, not advisory:** grants become the `mcpServers`
of the next session as loopback proxy entries, so the agent never holds a token;
the proxy lists a server's tools minus those set to Off and gates every call, a
revoked grant stops a live session at once, and Ask raises an Inbox question.
Checked by `cargo test`, by the proxy end to end against a real MCP server, and in
the browser with a mocked backend; not by a live agent.)

Why one box stays open:
- **Catalog and Connect:** every entry is real and the pieces are exercised (Add MCP
  with Test listed the tools of a real stdio server; Google's Gmail MCP listed over
  HTTP; Linear's 401 and OAuth discovery ran live; the whole sign-in ran against a
  mock authorization server). No provider's consent screen has been clicked
  through yet. Tick it after one real Connect of a `oauth` entry (Linear is
  the cheapest) and one token entry (GitHub with a PAT). Slack, Gmail, Drive and
  Calendar also need a client ID of the reader's own, because those providers
  register no one; **Browser is Playwright MCP run with npx**, not hz's embedded
  browser, so there is no take-over.

**J. Settings.** M
- [x] Preferences: theme (Dark, Light, System through the existing mode switch;
      the polish of the light palette is still phase N), density, text size,
      living faces, send key, steps and trace defaults, clock, notifications,
      quiet hours, a real test banner, shortcuts (the existing rebinder).
- [x] Agent defaults, stored on the workspace: CLI, stance, folder, say hello,
      nightly tidy, shared memory, hand-offs and wait (feed `team.rs`), and the
      limit fallback (wait, move to Codex, ask).
- [x] Usage & limits: per-CLI windows with reset times (Claude and Codex read from
      the CLIs, OpenCode reports none, an estimate from our own counts where a
      reading fails), spend per agent, workspace budget and its action, alert
      threshold, per-task cap, CSV export.
- [x] CLIs: version, path, account, adapter, check, update with progress, sign in
      and out, the update-check and warm-up switches.
- [ ] Install more agents (Gemini, Cursor). Not ticked: hz has no engine for
      either, so the rows are listed and disabled with "Not available yet".

Built and tested with `cargo test` (quiet-hours math, both usage parsers against
real captures, the estimate, the fallback decision, the budget verdicts, the CSV,
the tidy schedule, the CLI parsers) and vitest, and checked in the browser on
`demo-settings.html` against the mockup. **Read live on this machine:** Claude's
`/usage` through the adapter (Max, 5-hour and weekly windows), Codex's
`account/rateLimits/read` (Plus), and `cli_overview` for all three CLIs
(`cargo test live_ -- --ignored`). **Not run live:** an actual limit hit
triggering the fallback, the nightly tidy at its hour, a shared note written by
two agents, the budget's Ask me holding a real prompt, the task cap interrupting
a real turn, sign in and out, and Update (all are unit-tested decisions around
real code paths). Not done: Claude's live `rate_limit_event` is not consumed (the
Refresh button and the five-minute cache do the job), and Gemini's `/usage`.

**K. Jump to.** S
- [x] Groups: Agents, Channels, Needs you, In memory, Routines, Plugins, Do, with
      the older Sessions, Messages, Code, Projects and Workspaces after them.
- [x] Filter as you type over title and subtitle, arrows, Enter, hover, four rows
      per group while empty, "Create an agent called …" with the name filled in.

**O. Pull requests board.** M
- [x] The three lanes from the existing PR list and agent authorship, the agent filter, Refresh. Attribution is by branch; the PR body marker is not read (the list carries no body).
- [ ] The centered sheet on `PrPanel`: note, diff, checks, reviewers, Ask an agent to review, Approve, Merge with confirm and Undo (Undo = revert PR). Not ticked: the sheet's PrPanel sections, Approve, Merge and Undo were never run against a live GitHub PR (the demo stubs one read); `revert_pr` is untested end to end. Built and type-checked.
- [x] Sidebar entry with the "needs you" count, fed by `usePrMarks`. The count comes from one repo-wide `search` alias in the marks query, checked with `gh api graphql`. One count per branch, and team review requests are not counted.

**L. Cleanup.** M
- [x] Delete Issues (see decision 1). The old Inbox went with phase F. Issue tags, the `#` picker, the session Issue tab, `hz issue` and the protocol bump to v8 went with it; the Linear MCP plugin and Linear routine sources stay (they are plugins and webhooks, not the Issues surface).
- [x] Delete `Sidebar.tsx`, `AgentPanel.tsx`, the Agent tab in `RightPanel`,
      `SpacesSettings.tsx`, and dead hooks and lib files. Sidebar's pure ordering moved to `lib/sessionOrder.ts`; `lib/space.ts` and the project-space commands are gone. Left: `settings.space` and `spaces` (read by the webview's preference migration only), and the Usage page, which is still routed.
- [x] Update FEATURES.md for every surface above.
- [x] Remove `design/studio*` from the bundle path (it was never in it) and keep it
      as the reference.

**M. People in a workspace.** L
- [ ] Invites by email, pending and revoke, and members who can talk to the agents
      and see the channels. Settings stay with the owner.
- [ ] This needs a sync server: an account, a workspace record and a relay for
      messages. It is the first part of hz that is not on the laptop (open
      question 4).

**N. Light theme.** M
- [ ] Light and System in Preferences. Same tokens, a second palette, checked
      screen by screen against the dark one.
      Checked in light, against the dark side: the primitives page (menus,
      toasts, confirm, sheets, banners, tiles, brands), the sidebar with agents,
      the inbox, routines, pull requests, plugins with its centred sheet, the
      agent chat with its composer, the new-agent dialog, Jump to, and
      Preferences, where Light switches live and the theme cards show the real
      palettes. Not yet checked in light: the agent profile's five tabs, chat
      cards, reply bar and transcript sheets, and a toast or confirm raised over
      live content. System was not clicked; it resolves through the same path.

Order: A → B → C → E → D → F → G → H → I → J → K → O → N → L (M postponed). C and E come first because
they are what the reader touches every minute. F needs C's approval cards. G needs
F's mentions.

### Decisions (taken 2026-10-23, Hamerti said "decide tudo")

1. **Issues are removed. Pull requests stay, on their own page.** The Linear issues
   surface goes: `IssuesView`, `IssuePanel`, `useIssues`, `useIssueSearch`, `lib/issue*`,
   the Rust `issues/` module and its credentials. The agent Inbox is the only Inbox, and
   `InboxView.tsx`, `lib/inbox*` and `useInbox` go with it. **Pull requests** become a
   sidebar entry under Routines, drawn as a three-lane board in the mockup
   ([prs.js](design/studio/prs.js)): *Needs you* (review or approve), *Agents working*
   (draft, checks running, changes requested) and *Ready to merge*. A card shows repo and
   number, title, the agent that opened it, +/− and files, checks and reviewers. Click
   opens the centered sheet with the agent's note, the diff, checks, reviewers, Ask an
   agent to review, Open on GitHub, Approve and Merge (confirm, then Undo).
2. **Plan limits are real, read from each CLI the way OpenBot does** (ideas only; its
   licence is non-commercial, so no code is copied). Found in its
   `src/backend/claude-client.ts` and `docs/architecture/providers.md`:
   - **Claude:** the Agent SDK has an experimental usage read whose result carries
     `rate_limits` with `five_hour`, `seven_day`, `seven_day_opus` and
     `seven_day_sonnet`, each with a percentage and a reset time. The same windows
     also arrive live as `rate_limit_event` messages (`status: rejected` means a limit
     was hit). hz runs Claude through `claude-agent-acp`, which wraps that SDK: first
     check whether the adapter forwards the event or its `_meta`; if not, run one
     private probe session that reads usage and closes.
   - **Codex:** the app-server method `account/rateLimits/read`, plus
     `account/rateLimits/updated` pushes.
   - **OpenCode:** a rolling window from its own usage data.
   - **Gemini:** a private `/usage` prompt, parsed from the answer.
   Where a CLI gives nothing, fall back to our own token counts against the plan the
   reader picks, and label the bar "estimated". A missing reading is never shown as
   zero (OpenBot's rule too).
3. **Public webhooks.** Local endpoint first, pointed at through the reader's own tunnel. A hz relay comes later.
4. **Phase M is postponed** (Hamerti, 2026-10-23: "não fazer agora"). Skipped in every overnight run. The Invite button stays in the mockup and is the one box left unticked in the checklist.

5. **Sidebar order and loading (fix round, 2026-10-23).** Agents, channels and the two sections are draggable and the order is stored per workspace (`agent_order`, `channel_order`, `section_order`). Pages draw skeletons instead of loading text; Usage & limits and CLIs fill card by card. Not live-verified in the packaged app: only on mocked-invoke browser pages.

## Production readiness

Written 2026-10-23 after phases A–O. Everything above is built and green on unit
tests, but **almost none of it has been driven end to end with real agents in the real
window.** This is what stands between that and a project the reader can hand over and
trust. Ordered by how badly each one hurts if it is wrong.

### P0. Prove it works (nothing else counts until this is done)

- [ ] **A real end-to-end pass in `pnpm tauri dev`** with a real Claude, Codex and
      OpenCode agent: create an agent, chat, tool use, approval, Stop, restart and resume;
      a channel round with two agents; an `ask_user`; a routine run; a plugin call; a PR
      merge. Record each as a script or checklist that can be re-run. Today every UI path
      was checked only on mocked-IPC pages.
- [ ] **A scripted E2E harness** (Playwright against the Tauri webview, or the `hz` CLI
      socket) that runs that pass on every PR. At minimum a smoke test that boots the app,
      sends one prompt per CLI and asserts an answer lands in the chat and in a channel.
- [ ] **Replace "advisory" with "enforced"** for the safety rules the UI shows. Always-ask
      rules and read-only folders are briefing text only. For an agent trusted with a
      real project they must be real: intercept the tool call, check the path against the
      allowed folders, and ask. Same for the budget: stop mid-turn, not only before the
      next prompt.
- [ ] **Never lose work**: a crash or kill mid-turn must resume cleanly. Test SIGKILL during
      a turn, during a routine, during a channel round, and during a plugin OAuth.

### P1. Safety and trust

- [ ] **Default stance**. New agents default to `auto`; pick the default with care (Ask
      first or Plan) and make Full access require a typed confirmation.
- [ ] **Secrets**. Plugin tokens are in the Keychain; audit that nothing else (webhook
      secrets, adapter env, logs, analytics, exported transcripts, memory notes) can hold
      one. Run the secret scan the plan promised before any export.
- [ ] **Webhook listener** (127.0.0.1:47831): rate limit, body size cap, replay window on
      the signature, and a documented tunnel setup.
- [ ] **Prompt injection**. Text from webhooks, PRs, files and web pages reaches agents;
      mark it as untrusted in the briefing and never let it widen an agent's permissions.
- [ ] **Agent-to-agent limits** are tested under load: loops, 64 outstanding asks, 10
      minute timeouts, channel round caps, and the cost they can burn unattended.
- [ ] **Budgets that bite**: per-task cap and workspace budget interrupt a running turn.

### P2. Reliability and data

- [ ] **Durable state**. Reactions, deleted messages and Clear folds live in webview
      storage, and the held-notification queue is in memory. Move them to Rust-owned files
      (the plan's SQLite store with a `rev` is the clean fix) with atomic writes and
      migrations, and a backup/export of `~/.hz`.
- [ ] **Queue and steer**. Messages sent while an agent is busy need the durable queue
      (visible, editable, crash safe) from the roadmap, and Stop must be reliable.
- [ ] **Compaction and rollover** so an endless chat never hits the context wall; handoff
      packet; `history_search`.
- [ ] **Fallback** between CLIs on a limit, tested against a real limit hit.
- [ ] **Per-agent process lifecycle**: idle release, resume from disk, a cap on live
      children, and cleanup of orphaned adapter processes on quit and crash.
- [ ] **Offline and error states** on every screen: no network, CLI missing or signed out,
      adapter install failed, MCP server down. Each shows what happened and what to do.

### P3. Performance

- [ ] Measure first: cold start, sidebar with 50 agents, a 10,000-message chat, a
      11 MB transcript, a channel with 5 agents streaming. Budgets: first paint under
      1 s, chat scroll at 60 fps.
- [ ] Virtualize long feeds, lazy-load transcripts, and index search.
- [ ] Slim the bundle: remove mcode (182 MB) and the adapter payloads (about 330 MB
      each); the runtime manager with pinned downloads, hash check and progress.
- [ ] Idle CPU: dither canvases and shimmer animations pause when the window is hidden or
      "Living faces" is off.

### P4. Ship it

- [ ] Signed, notarized builds; the updater, idle-aware (never restart a running turn)
      with version floors.
- [ ] First-run flow: detect installed CLIs, walk sign-in, create the first workspace
      and agent.
- [ ] Recovery screens, a support bundle, a TROUBLESHOOTING doc, a privacy statement per
      feature, and an analytics inventory.
- [ ] Finish the leftovers from the legacy cleanup (split view, worktree UI, fan-out
      send paths, archive state, CLI `browser` and `new`) and the open plan boxes.
- [ ] Phase M (team sync) and the public webhook relay stay postponed.
