# Bots parity: what to build in Rust, and where it lives

A feature list of the Bots app (agent daemon + native UI), written from what each part **does**, so we can build our own in Rust.
We build from this behaviour, never from their code. Names, copy and artwork are ours.

Status: `have` (already in the app) · `partial` · `todo` · `skip` (with the reason).
New Rust goes in `src-tauri/src/agentkit/`, one file per row, each with its own tests. Tauri commands and the React screens come after (section F).

## A. Safety and trust

| Module | What it does | Status |
|---|---|---|
| `untrusted.rs` | Wraps outside text (mail, calendar invites, messages, fetched pages, connector answers) in one envelope plus a fixed notice, and gives agents a system-prompt rule: what's inside is data, never instructions | built in `agentkit/` (logic + tests); wiring pending |
| `secrets.rs` | Keys the agent never sees: it writes `{{NAME}}`, we substitute the value at run time and scrub it from the output. Names are CAPS/digits/`_`/`.`. Values live in the keychain. Also masks passwords and one-time codes in text | built in `agentkit/` (logic + tests); wiring pending |
| `reviewer.rs` | Decides a shell command: `always_ask`, `auto_review` (only if **every** part is a read-only program: no redirection, substitution, sudo or writes), `allow_all`, `off`. A hard "safety floor" always asks (typing a card or password, destructive patterns) | built in `agentkit/` (logic + tests); wiring pending |
| `operations.rs` | Idempotent actions: the same `operation_id` returns the saved result instead of running twice; an attempt cut off before its result is `unknown` and is never re-run on its own | built in `agentkit/` (logic + tests); wiring pending |
| `payments.rs` | Small purchases an agent may make: off by default, per-purchase and per-month limits, only chosen agents, ten-minute window after the agent states amount/purpose/place; above limits it asks | built in `agentkit/` (logic + tests); wiring pending |
| `browser_guard.rs` | Filters browser tool answers: hides passwords/codes, shortens snapshots (unchanged page → one line, small change → the diff, huge → cut), detects CAPTCHAs, adds `read_page` | built in `agentkit/` (logic + tests); wiring pending |
| approvals | Permission requests become cards the agent blocks on | have (ACP `session/request_permission`) |
| "always allow this" | Remember an approval for a command pattern | todo (in `reviewer.rs`) |

## B. What agents post and how they work

| Module | What it does | Status |
|---|---|---|
| `drafts.rs` | An agent never sends mail or messages: it posts a draft card; you edit and Send, Copy or Discard. State machine `draft → send_requested → sent | failed(reason)`. Attachments ride along | built in `agentkit/` (logic + tests); wiring pending |
| `pages.rs` | Live pages: HTML body, each top-level block gets an id so "what changed" survives a full rewrite, numbered versions with history, conflict notice if the agent edited first | built in `agentkit/` (logic + tests); wiring pending |
| `genui.rs` | Rich answers: `chart` (plain data → native chart), `widget` (small sandboxed HTML page, no network; a button can reply as the user; images from the agent's folder embedded and shrunk) | built in `agentkit/` (logic + tests); wiring pending |
| `plan.rs` | Steps of long work as a card, ticked as done, closed when the run ends; a tool for engines without their own list | built in `agentkit/` |
| `digest.rs` | Several unread agent messages become one line in the list, made by a small model at run end, kept on the newest | built in `agentkit/` (logic + tests); wiring pending |
| `group_triage.rs` | In a group with no @mention, one quick read picks who answers; only those work, in parallel; falls back to everyone | built in `agentkit/` (logic + tests); wiring pending |
| `routine_suggest.rs` | Notices the same request three times in 14 days (same time ±1 h or same weekday) and offers a routine once: Yes / Other time / No (No is forever); max one a day | built in `agentkit/` (logic + tests); wiring pending |
| `watches.rs` | "Wake me when done": the agent gives a process id (and optional log); we poll and wake it in the same chat with the duration and last log lines; persisted across restarts; capped lifetime | built in `agentkit/` (logic + tests); wiring pending |
| `rotation.rs` | "Light and strong" brain: light by default, moves up when the request is heavy, back after 20 idle minutes, never mid-request; "turbo" for an hour; per-engine mapping (model, effort, variant) | built in `agentkit/` (logic + tests); wiring pending |
| `usage.rs` | Tokens and estimated cost per run from a price table; sums per agent (profile, Settings → Usage) | built in `agentkit/` |
| `onboarding.rs` | Scripted first chat for a new agent: asks the main focus, sets its job and label, asks its name, offers three first tasks; works with no engine | built in `agentkit/` (logic + tests); wiring pending |
| `bot_factory.rs` | The main agent can create new agents (name, role, job) when asked; capped per request | built in `agentkit/` (logic + tests); wiring pending |
| `timings.rs` | Where a run's time goes: wake, screen, each tool call, first output, model; one log line and a ring file of the last 500 | built in `agentkit/` (logic + tests); wiring pending |
| memory, reactions, teams, groups, routines, budget, skills | | have |
| `skills_teach.rs` | "Teach a task": record the agent's screen while you do it, it watches frames and writes itself a step-by-step guide plus a memory line | built in `agentkit/` (logic + tests); wiring pending |
| plugins/MCP connectors, ask/free per connector | | have |

## C. Accounts, engines, integrations

| Module | What it does | Status |
|---|---|---|
| `accounts.rs` | Different sign-ins per agent on the same engine: one folder per account, env per engine (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_DATA_HOME`, a linked `HOME`) | built in `agentkit/` (logic + tests); wiring pending |
| `engine_updates.rs` | Which installed agent CLI has a newer version; update with its own command; checked every 6 hours | built in `agentkit/` (logic + tests); wiring pending |
| `e2e.rs` | End-to-end encryption: AES-256-GCM, `e1:` + base64(nonce‖ciphertext‖tag), one key per account, recovery code, key shown as QR for a second device | built in `agentkit/` (logic + tests); wiring pending |
| `bark.rs` | Push to a phone through Bark; by default only "who and what kind", optionally encrypted text | built in `agentkit/` (logic + tests); wiring pending |
| `onepassword.rs` | Sign-in cards can ask the `op` CLI for a login; Touch ID in 1Password; password goes into the page, never through us or the agent; per-agent opt-in | built in `agentkit/` (logic + tests); wiring pending |
| `google.rs` + `gmail_organize.rs` | Gmail (search, read, draft; never send), Calendar (list; create asks), Drive (search, read as text); bulk organize with preview on 50, undo for 30 days | built in `agentkit/` (logic + tests); wiring pending |
| `composio.rs` | Paste one key; apps connect through a link card the agent shows | built in `agentkit/` (logic + tests); wiring pending |
| `relay.rs` | Messaging bridge on a local Matrix server (find chat, read, download attachments, hear voice notes); sending is always a draft | built in `agentkit/` (logic + tests); wiring pending |
| `frameio.rs` | Browse and download from Frame.io with the user's own Adobe app | built in `agentkit/` (logic + tests); wiring pending |
| `pdf.rs` | HTML body → good-looking PDF through a Chromium-family browser already on the machine; falls back to HTML | built in `agentkit/` (logic + tests); wiring pending |
| `app_api.rs` | Connected apps: a read-only local API for other apps (who the agents are, memories, live work). Per-app key (we store only its sha256), revocable, last-used time | built in `agentkit/` (logic + tests); wiring pending |
| plugin OAuth, MCP client, proxy | | have |
| Supabase store/auth, shared groups, access-watch, agent self-update, phone login | | skip: we are local-first and already ship an updater |
| direct-apps (LM Studio/Ollama tool loop) | | skip: agents run through ACP engines |

## D. The agents' computer, voice, you in control

| Module | What it does | Status |
|---|---|---|
| `takeover.rs` | You in control of an agent's screen: a mark file; the agent's next computer/browser command waits and continues on hand back; stale after 30 minutes; the agent can ask you to take over (login, CAPTCHA, payment) | built in `agentkit/` (logic + tests); wiring pending |
| `screens.rs` / `vm.rs` | One shared Linux VM (Lima on macOS) with one screen per agent, on only while needed; start/stop/sleep after idle; computer size (Small/Medium/Large); a terminal on the VM; shared `/workspace` | built in `agentkit/` (logic + tests); wiring pending |
| `screenshot.rs` | Agent shares a screenshot into the chat and the library | built in `agentkit/` (logic + tests); wiring pending |
| `work_screen.rs` | An agent's screen never sits on a blank page: it shows what it is doing | built in `agentkit/` (logic + tests); wiring pending |
| `cursor_buddy.rs` | Where each Mac action lands (tool, x, y, short label, never typed text) so the mascot can fly there | built in `agentkit/` (logic + tests); wiring pending |
| `call.rs` + `speech.rs` | Voice calls: dictation to text, the reply spoken sentence by sentence as it is written; the local voice server; summary posted when you hang up; "stop" when you talk over it | built in `agentkit/` (logic + tests); wiring pending |
| `voice_memo.rs` | The agent sends an audio message with its voice and the transcript | built in `agentkit/` (logic + tests); wiring pending |
| `site_login.rs` / `qr_login.rs` | Sign in without the agent seeing the password (typed straight into the page); QR logins as a cropped, refreshed card, or phone-number pairing | built in `agentkit/` (logic + tests); wiring pending |
| `browser` (CEF automation) | | have |
| Call link over local TCP, iPhone screen relay | | skip: no phone app |

## E. Not in Rust: native UI behaviours to match

Waiting centre (inbox), search palette, bulk actions (select, hide, move), undo stack toasts, reactions, reply quotes, threads, read aloud, make PDF, copy message id, versions sheet, browser logins sheet, computer size sheet, brain-for-many sheet, new-bot sheet (from scratch / ready-made), profile sheets, voice list, usage rows, what's new, suggest an idea, island at the notch with hover approve/deny/answer, in-app banners, offline view, setup/sign-in screens.

## Progress

Step 1 and 2 are done as pure, tested modules: 43 files in `src-tauri/src/agentkit/`, 511 tests. `kit_cmds.rs` exposes the first sixteen Tauri commands (review, speech, cost, drafts, pages, watches, payments, e2e, takeover). Still to wire: the real runners (Lima, voice server, Gmail/Google, Composio, Matrix), the rest of the commands, and every screen.

## F. Order of work

1. `agentkit/` scaffold and the pure-logic modules (A, B, most of C), each with tests. No UI yet.
2. D: takeover, screens/VM, screenshots, cursor, call, site login (these touch processes, so they get integration tests behind a feature flag).
3. Tauri commands for everything, events into the existing normalized event model (`FEATURES.md` says how).
4. Port `design/simple` into the React app screen by screen (shared components first), delete the superseded views.
5. `cargo test`, `cargo clippy --all-targets -D warnings`, `pnpm test`, `pnpm lint`, `pnpm build`.
