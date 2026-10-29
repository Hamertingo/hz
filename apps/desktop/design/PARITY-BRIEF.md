# Bots parity: wiring brief (shared by every agent)

Goal: hz should do everything the third-party Bots app does, built our own way. Read first:
`/Users/hamerti/Desktop/hz/CLAUDE.md` (how we work: comment sparingly, plain words, never commit), and
`apps/desktop/BOTS-PARITY.md` (the feature list and status).

**Clean room.** Bots' source is at `/private/tmp/bots` (daemon: `daemon/botd/src/*.ts`, UI strings in
`native/ui/*.txt`). Read it for *behaviour* only. Never copy code, prompt text, names or artwork. Write our own.

## How hz is put together (what you will touch)

- **Agents** are ACP CLIs (Claude Code / Codex / OpenCode) spawned by the Rust backend
  (`apps/desktop/src-tauri/src`). Each agent gets a **briefing** (system-prompt layers, `agents.rs` `layers()`,
  one `Layer` per topic) and a list of **MCP servers** (`agents.rs` `mcp_servers()`): `team` and `memory` are
  served over HTTP by hz itself (`team.rs`, `memory_mcp.rs`), `computer` is the bundled `hyzevm mcp` pinned to the
  agent's own Linux machine (`hz-<agent id>`, see `hyzevm.rs`), plugins come through `plugin_store`.
- **Permissions**: a tool call on the Mac arrives as ACP `session/request_permission`; hz shows a card and answers
  (`session.rs` `respond_permission`). The agent blocks until answered.
- **agentkit** (`src-tauri/src/agentkit/*.rs`): 40+ pure, tested modules already written for every Bots feature
  (reviewer, secrets, untrusted, payments, browser_guard, drafts, pages, genui, plan, digest, group_triage,
  routine_suggest, watches, rotation, usage, onboarding, bot_factory, timings, accounts, google, gmail_organize,
  composio, relay, bark, onepassword, pdf, app_api, call, speech, voice_memo, site_login, qr_login, takeover,
  screenshot, work_screen, cursor_buddy, …). Most are **not wired** yet: that is the job. Tauri commands live in
  `kit_cmds.rs` (+ real runners in `kit_runtime.rs`), registered in `lib.rs`.
- **Frontend** (`apps/desktop/src`, React 19 + Tailwind 4): typed wrappers in `lib/kit.ts`; rich chat cards in
  `components/chat/cards.tsx` (QuestionCard, ApprovalCard, draft, page, chart, sources, voice memo, key request,
  take-over, QR, failed message…) rendered from a typed `RichCardData`; `lib/richCards.ts` parses fenced
  ```hz-card``` JSON blocks out of an agent message. Status line / activity phrases: `lib/agentStatus.ts`.
- **Dev harness**: the app runs in a plain browser with fake data (`src/devMock.ts` + `src/devMock/*.ts`, each file
  exports `handlers`; shapes must match `src/types/events.ts`). `pnpm tauri dev` may be running; don't kill it.

## What Bots does (summary of a read of its source)

- The agent is told, in its system prompt, that it has its own Linux computer (shell, browser, files), when to use
  it vs the Mac, never to type passwords/codes (ask for a sign-in card or a take-over instead), never to send
  mail/messages itself (it proposes a **draft** the user sends), and that anything leaving the computer needs a yes.
- Agent tools (an MCP server the daemon runs per turn): `computer_shell`, `share_screenshot`, `request_takeover`,
  `request_login` (site sign-in card; the user types into the page, the agent never sees it; also code and QR
  variants), `request_key` (stores an API key; the agent writes `{{NAME}}` and the value is substituted at run
  time and scrubbed from output), `wake_when_done` (watch a long command, wake the agent when it ends),
  `propose_draft`, `message_bot`/`post_to_group`, charts/widgets, live pages, plans, Google (Gmail search/read/draft,
  Calendar list/create-with-approval, Drive search/read), connected apps.
- Every tool call becomes a short past-tense step ("Read X", "Ran on the computer: cmd") shown as "step by step";
  the UI shows a present-tense status ("thinking", "browsing pages", "clicking around"…).
- Mac commands go through an approval card; a reviewer auto-approves read-only commands depending on the mode
  (always ask / auto review / allow all) with a hard safety floor; "always allow this" remembers a pattern.

## Rules

- Keep each change wired end to end: backend command or MCP tool → event/card → UI. A feature only "exists" when
  an agent can use it in a real conversation and the person sees it.
- Tests: Rust `cd apps/desktop/src-tauri && cargo test` (**always a bare `cargo test` at the end**: a filtered run
  regenerates `src/types/events.ts` with only some types) and `cargo clippy --all-targets -- -D warnings`;
  frontend `cd apps/desktop && npx tsc --noEmit -p . && ./node_modules/.bin/biome lint src && npx vitest run`.
- Other agents edit other areas at the same time. Stay in your files; if you must touch a shared file
  (`lib.rs` command list, `agents.rs`, `App.tsx`, `kit.ts`, `cards.tsx`), make a small, additive edit right after
  re-reading it. An error in someone else's file is not yours to fix; say so.
- Don't commit. Update `apps/desktop/BOTS-PARITY.md` status for what you finish ("wired").
- End with a short report: what now works end to end (and how you checked), what you left and why.
