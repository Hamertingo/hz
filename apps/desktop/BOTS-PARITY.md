# Bots parity: what to build in Rust, and where it lives

A feature list of the Bots app (agent daemon + native UI), written from what each part **does**, so we can build our own in Rust.
We build from this behaviour, never from their code. Names, copy and artwork are ours.

Status: `have` (already in the app) · `partial` · `todo` · `skip` (with the reason).
New Rust goes in `src-tauri/src/agentkit/`, one file per row, each with its own tests. Tauri commands and the React screens come after (section F).

## A. Safety and trust

| Module | What it does | Status |
|---|---|---|
| `untrusted.rs` | Wraps outside text (mail, calendar invites, messages, fetched pages, connector answers) in one envelope plus a fixed notice, and gives agents a system-prompt rule: what's inside is data, never instructions | wired: rule is the briefing's `safety` layer (`safety_tools::briefing_rules`); connector answers (`plugin_proxy`) and `browser_snapshot` arrive in the envelope |
| `secrets.rs` | Keys the agent never sees: it writes `{{NAME}}`, we substitute the value at run time and scrub it from the output. Names are CAPS/digits/`_`/`.`. Values live in the keychain. Also masks passwords and one-time codes in text | wired: `request_key` on the team server (`safety_tools.rs`) shows the key card in the chat, value goes to the Keychain under the agent; the `computer` server (`apps/hyzevm/src/safety.rs`) fills `{{NAME}}` in `machine_exec` (over stdin, never argv), `machine_write_file`, `browser_type`, `desktop_type` and scrubs every saved key (raw, base64, url-encoded) from all its answers. Keys listed and removable in Access. Not on the Mac's own shell |
| `reviewer.rs` | Decides a shell command: `always_ask`, `auto_review` (only if **every** part is a read-only program: no redirection, substitution, sudo or writes), `allow_all`, `off`. A hard "safety floor" always asks (typing a card or password, destructive patterns) | wired: `command_review.rs` screens every ACP shell `request_permission` under the agent's mode (Access tab; default in Settings → Agents). Floor first (also reading the keychain), card with "Safety check" and no always; an auto approval answers allow-once and logs a quiet "approved" line |
| `operations.rs` | Idempotent actions: the same `operation_id` returns the saved result instead of running twice; an attempt cut off before its result is `unknown` and is never re-run on its own | built in `agentkit/` (logic + tests); wiring pending |
| `payments.rs` | Small purchases an agent may make: off by default, per-purchase and per-month limits, only chosen agents, ten-minute window after the agent states amount/purpose/place; above limits it asks | wired: `approve_action` kind `pay` in the `computer` server asks hz (`/mcp/<agent>/safety/pay`): inside the limits it is booked and allowed, past them it is an Inbox question; per-agent "May buy" switch in Access |
| `browser_guard.rs` | Filters browser tool answers: hides passwords/codes, shortens snapshots (unchanged page → one line, small change → the diff, huge → cut), detects CAPTCHAs, adds `read_page` | wired (masking, unchanged/diff compaction, size cap, CAPTCHA → request_takeover hint) inside `apps/hyzevm/src/safety.rs`; `read_page` not added |
| approvals | Permission requests become cards the agent blocks on | have (ACP `session/request_permission`) |
| "always allow this" | Remember an approval for a command pattern | wired: the chat card's "Always allow this" writes the same per-agent rule the Inbox does (`inbox::permission_always_allow`); the safety floor still asks |

## B. What agents post and how they work

| Module | What it does | Status |
|---|---|---|
| `drafts.rs` | An agent never sends mail or messages: it posts a draft card; you edit and Send, Copy or Discard. State machine `draft → send_requested → sent | failed(reason)`. Attachments ride along | wired: `propose_draft` / `draft_status` (hz tools, `agent_tools.rs`) → draft card with Send, Edit, Copy, Discard; clipboard sends today, Gmail and apps plug in through `agent_tools::register_sender` |
| `pages.rs` | Live pages: HTML body, each top-level block gets an id so "what changed" survives a full rewrite, numbered versions with history, conflict notice if the agent edited first | wired: `page_create` / `page_update` / `page_read` → page card with a live thumbnail, Open page and a Versions sheet that brings an old one back |
| `genui.rs` | Rich answers: `chart` (plain data → native chart), `widget` (small sandboxed HTML page, no network; a button can reply as the user; images from the agent's folder embedded and shrunk) | wired: `show_chart` (bar, line, pie) and `show_widget` (sandboxed frame, no network; `hz.reply` fills the composer) |
| `plan.rs` | Steps of long work as a card, ticked as done, closed when the run ends; a tool for engines without their own list | wired: `show_plan` → steps card, newest list wins, closed with the turn |
| `digest.rs` | Several unread agent messages become one line in the list, made by a small model at run end, kept on the newest | wired: at a run's end, three or more meaningful messages make one line (local heuristic, no model call; no side-query path exists for the reader's CLIs) shown in the sidebar row while unread (`kit_work.rs`, `useAgentGlances`) |
| `group_triage.rs` | In a group with no @mention, one quick read picks who answers; only those work, in parallel; falls back to everyone | wired: channel mode "Whoever fits" (`Mode::Triage`, the default for new channels); role/name heuristic, fallback everyone, in parallel. No model variant |
| `routine_suggest.rs` | Notices the same request three times in 14 days (same time ±1 h or same weekday) and offers a routine once: Yes / Other time / No (No is forever); max one a day | wired: the reader's requests in an agent's own chat are recorded; at run end an offer card shows in that chat; Yes / Other time make the routine via `routine_save`, No is forever |
| `watches.rs` | "Wake me when done": the agent gives a process id (and optional log); we poll and wake it in the same chat with the duration and last log lines; persisted across restarts; capped lifetime | wired: `wake_when_done` watches a pid on the agent's computer (or the Mac) and wakes it in its own chat with a `<hz-wake/>` prompt |
| `rotation.rs` | "Light and strong" brain: light by default, moves up when the request is heavy, back after 20 idle minutes, never mid-request; "turbo" for an hour; per-engine mapping (model, effort, variant) | wired: Brain row + "Turbo for an hour" in the profile's Engine section; applied in `SessionManager::send_msg` before the in-place `set_config_option` (Claude by model, Codex by effort; not OpenCode); never while a turn is open; off by default |
| `usage.rs` | Tokens and estimated cost per run from a price table; sums per agent (profile, Settings → Usage) | wired: the prompt reply's per-turn tokens and model ride `turn_completed`; where the engine names no cost it is estimated (cache priced too) as a running total, so budget, profile and Settings → Usage count it. Tokens per agent in Settings → Usage and the profile's Budget |
| `onboarding.rs` | Scripted first chat for a new agent: asks the main focus, sets its job and label, asks its name, offers three first tasks; works with no engine | dropped from the UI: the person did not want a scripted intro. A new agent opens as a normal chat and, with "Say hello" on, introduces itself in its own words. The Rust module and its `kit_onboarding_*` commands are unused |
| `bot_factory.rs` | The main agent can create new agents (name, role, job) when asked; capped per request | wired: `create_agent` → the window adds it to the roster on its maker's CLI and workspace; five per reader message |
| `timings.rs` | Where a run's time goes: wake, screen, each tool call, first output, model; one log line and a ring file of the last 500 | wired: every main-thread turn is timed from its prompt (tools, model, first words), `duration_ms` filled, a line appended to `~/.hz/agentkit/timings.jsonl` (last 500), readable through `kit_timings`; not drawn in the chat (the reader did not want it there) |
| memory, reactions, teams, groups, routines, budget, skills | | have |
| agents talking (`talk.rs`) | One tool that never blocks; a pair thread per two agents the person reads and cannot write in; the receiver answers there, the sender is woken where it wrote with the answer framed; hops capped, 12 bot runs per thread per 10 min, NO_REPLY and thanks wake nobody, half answers never go back, a run that handed work on waits for it; channels get post/read tools | wired (see `design/TEAM-TALK.md`): `team_message` (`team_ask` is an alias, nothing waits), `post_to_channel`, `read_channel`, `team_list` with who is busy. Pair threads are hidden channels (`pair: true`) with one session per agent; sender row "Sent a message to X", receiver line "N messages with X", "Answer from X", read-only thread sheet; sidebar and header say "waiting for X" / "working for X" (pt/en/es). The person's message pauses that agent's thread work and it resumes after; bot runs cut off by a restart in the last 10 min are handed back once. Hop limit is the workspace's "Back and forth between agents" (default 4). Not done: the "meanwhile in your groups" note on the next own-chat turn |
| `skills_teach.rs` | "Teach a task": record the agent's screen while you do it, it watches frames and writes itself a step-by-step guide plus a memory line | built in `agentkit/` (logic + tests); wiring pending |
| plugins/MCP connectors, ask/free per connector | | have |

## C. Accounts, engines, integrations

| Module | What it does | Status |
|---|---|---|
| `accounts.rs` | Different sign-ins per agent on the same engine: one folder per account, env per engine (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_DATA_HOME`, a linked `HOME`) | built in `agentkit/` (logic + tests); wiring pending |
| `engine_updates.rs` | Which installed agent CLI has a newer version; update with its own command; checked every 6 hours | wired: Settings → CLIs runs the six-hourly registry check on open (when "Check for updates" is on) and the row offers Update |
| `e2e.rs` | End-to-end encryption: AES-256-GCM, `e1:` + base64(nonce‖ciphertext‖tag), one key per account, recovery code, key shown as QR for a second device | built in `agentkit/` (logic + tests); wiring pending |
| `bark.rs` | Push to a phone through Bark; by default only "who and what kind", optionally encrypted text | wired: `bark_push.rs` pushes approvals, questions and finished turns while hz is in the background (the banner door and the inbox's done hook); Settings → Privacy pastes the key, tests, toggles encrypted text. Take-over pushes once a producer emits kind `takeover` |
| `onepassword.rs` | Sign-in cards can ask the `op` CLI for a login; Touch ID in 1Password; password goes into the page, never through us or the agent; per-agent opt-in | partial: `op_login.rs` + Settings → Privacy switch and per-agent opt-in, `op_lookup` for the card, `login_fields` for the filler. Typing into the agent's browser waits on a way to hand hyzevm a secret off the command line |
| `google.rs` + `gmail_organize.rs` | Gmail (search, read, draft; never send), Calendar (list; create asks), Drive (search, read as text); bulk organize with preview on 50, undo for 30 days | wired: browser sign-in with the person's own OAuth client (`google_account.rs`, token in the Keychain), `google` MCP tools (`google_tools.rs`) for granted agents, Calendar create and bulk organize ask through an Inbox card, `gmail` draft-card Send creates a Gmail draft; Settings → Privacy and a Google card on the Plugins page with per-agent grants. Not exercised against Google itself |
| `composio.rs` | Paste one key; apps connect through a link card the agent shows | wired: `composio_link.rs` turns the pasted key into a tool-router session saved as a workspace plugin (proxy, grants, policies), plus `connect_app` / `wait_for_app` and a Connect card. Not exercised against Composio itself |
| `relay.rs` | Messaging bridge on a local Matrix server (find chat, read, download attachments, hear voice notes); sending is always a draft | built in `agentkit/` (logic + tests); wiring pending |
| `frameio.rs` | Browse and download from Frame.io with the user's own Adobe app | built in `agentkit/` (logic + tests); wiring pending |
| `pdf.rs` | HTML body → good-looking PDF through a Chromium-family browser already on the machine; falls back to HTML | wired: `make_pdf` agent tool (`doc_tools.rs`, server `docs`) and Make PDF on a message's menu |
| `app_api.rs` | Connected apps: a read-only local API for other apps (who the agents are, memories, live work). Per-app key (we store only its sha256), revocable, last-used time | wired: local API in `kit_runtime.rs`; Settings → Privacy → Connected apps makes, revokes and shows last use |
| plugin OAuth, MCP client, proxy | | have |
| Supabase store/auth, shared groups, access-watch, agent self-update, phone login | | skip: we are local-first and already ship an updater |
| direct-apps (LM Studio/Ollama tool loop) | | skip: agents run through ACP engines |

## D. The agents' computer, voice, you in control

| Module | What it does | Status |
|---|---|---|
| `takeover.rs` | You in control of an agent's screen: a mark file; the agent's next computer/browser command waits and continues on hand back; stale after 30 minutes; the agent can ask you to take over (login, CAPTCHA, payment) | built in `agentkit/` (logic + tests); wiring pending |
| `screens.rs` / `vm.rs` | One shared Linux VM (Lima on macOS) with one screen per agent, on only while needed; start/stop/sleep after idle; computer size (Small/Medium/Large); a terminal on the VM; shared `/workspace` | built in `agentkit/` (logic + tests); wiring pending |
| `screenshot.rs` | Agent shares a screenshot into the chat and the library | wired: `share_screenshot` → picture card in the chat, a row in the agent's Library |
| `work_screen.rs` | An agent's screen never sits on a blank page: it shows what it is doing | built in `agentkit/` (logic + tests); wiring pending |
| `cursor_buddy.rs` | Where each Mac action lands (tool, x, y, short label, never typed text) so the mascot can fly there | built in `agentkit/` (logic + tests); wiring pending |
| `call.rs` + `speech.rs` | Voice calls: dictation to text, the reply spoken sentence by sentence as it is written; the local voice server; summary posted when you hang up; "stop" when you talk over it | built in `agentkit/` (logic + tests); wiring pending |
| `voice_memo.rs` | The agent sends an audio message with its voice and the transcript | built in `agentkit/` (logic + tests); wiring pending |
| `site_login.rs` / `qr_login.rs` | Sign in without the agent seeing the password (typed straight into the page); QR logins as a cropped, refreshed card, or phone-number pairing | wired as cards: `request_login` / `qr_login` wait on the person (take-over viewer; QR cropped from a refreshed screenshot). The automatic fill (`plan_fill`) and phone pairing are not used yet |
| `browser` (CEF automation) | | have |
| Call link over local TCP, iPhone screen relay | | skip: no phone app |

## E. Not in Rust: native UI behaviours to match

Waiting centre (inbox), search palette, bulk actions (select, hide, move), undo stack toasts, reactions, reply quotes, threads, read aloud, make PDF, copy message id, versions sheet, browser logins sheet, computer size sheet, brain-for-many sheet, new-bot sheet (from scratch / ready-made), profile sheets, voice list, usage rows, what's new, suggest an idea, island at the notch with hover approve/deny/answer, in-app banners, offline view, setup/sign-in screens.

## Progress

Step 1 and 2 are done as pure, tested modules: 43 files in `src-tauri/src/agentkit/`, 511 tests. `kit_cmds.rs` exposes the first sixteen Tauri commands (review, speech, cost, drafts, pages, watches, payments, e2e, takeover). Still to wire: the real runners (Lima, voice server, Gmail/Google, Composio, Matrix), the rest of the commands, and every screen.

## Windows

The base app already builds on Windows (CI: `app-windows.yml`). The new `agentkit` modules are portable logic, but several runners are macOS-only for now. Mac first; this is the list for the Windows pass.

- [ ] Run `app-windows` on a push and fix whatever the new modules break (symlink code must stay behind `cfg(unix)`).
- [ ] VM: WSL2 instead of Lima. `agentkit/vm.rs` has `WslCmd`; still needs a distro template, first-run setup and the wiring in `kit_runtime.rs`.
- [ ] Voice: the call and voice-memo runners use `say`/`afplay`. Add a SAPI runner (`voice_memo::default_voice` already names `sapi`).
- [ ] Command reviewer: knows Unix shells only. Teach it PowerShell and `cmd` (read-only cmdlets, redirection, `Remove-Item -Recurse`), or it asks for everything.
- [ ] Accounts per agent: the linked `HOME` trick is Unix-only; use a profile directory env on Windows.
- [ ] Screenshots and the screen viewer follow the VM.
- [ ] Paths: the workspace and data folders go through `std::env::home_dir`; check each `/`-joined string in the new commands.

## F. Order of work

1. `agentkit/` scaffold and the pure-logic modules (A, B, most of C), each with tests. No UI yet.
2. D: takeover, screens/VM, screenshots, cursor, call, site login (these touch processes, so they get integration tests behind a feature flag).
3. Tauri commands for everything, events into the existing normalized event model (`FEATURES.md` says how).
4. Port `design/simple` into the React app screen by screen (shared components first), delete the superseded views.
5. `cargo test`, `cargo clippy --all-targets -D warnings`, `pnpm test`, `pnpm lint`, `pnpm build`.
