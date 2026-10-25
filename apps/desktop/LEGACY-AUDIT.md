# Legacy audit

Scope: the old per-session hz app, measured against the mockup in `design/studio/`
(the spec, per [AGENTS-PLAN.md](AGENTS-PLAN.md) "From mockup to app"). The product is:
sidebar, agent chat, channel, agent profile (five tabs), New agent, Inbox, Routines,
Pull requests board, Plugins, Settings (six pages), Jump to.

Method: a reachability walk from `src/main.tsx` (388 of 403 frontend files are reached;
the 15 unreached are listed below), `invoke` names against `generate_handler!` (Rust
commands with no frontend caller), and importer checks for every candidate. Engine
(ACP, session, mapper, store, `Harness::Other` log reads) is kept unless the UI that
drove it is the only reason it existed.

Rule for this table: **KEEP** means the new UI reaches it or the user asked for it;
**REMOVE** means no mockup surface needs it. A row marked `deferred` is a REMOVE the
pass did not finish, with the reason.

## Dead (not reachable from `main.tsx`)

| Candidate | Decision | Reason |
|---|---|---|
| `components/changes/*` (5 files) | REMOVE | Session Changes tab; nothing imports them. |
| `components/plugins/AgentAvatar.tsx` | REMOVE | Unreached; `AgentAvatar` lives in `components/AgentAvatar.tsx`. |
| `hooks/useChanges.ts`, `hooks/useRepo.ts` | REMOVE | Only the dead Changes tab used them. |
| `hooks/useAvatar.ts` | REMOVE | Unreached; avatar comes from `useMe`/`useAgentGlances`. |
| `hooks/usePluginAgents.ts` | REMOVE | Unreached; its `plugin agent` commands have no caller. |
| `lib/agentSkin.ts`, `lib/agents.ts` (+ `agents.test.ts`) | REMOVE | Unreached. |
| `lib/bloub/cycles.ts` | REMOVE | Unreached. |
| `lib/commit.ts` (+ `commit.test.ts`) | REMOVE | Commit-message helper of the Changes tab. |
| `styles/attention-glow.css` | REMOVE | Unreached stylesheet. |
| `demoStudio.tsx` + `demo-studio.html` | KEEP | Phase-A primitives page; a separate Vite entry, not in the app graph. |

## Pages and routes (App.tsx `MainPage`)

| Candidate | Decision | Reason |
|---|---|---|
| `SearchView` page (+ `search_content`, `search_transcripts`) | REMOVE | Not in the mockup; the Jump-to palette is the search. |
| `UsageView` standalone page | REMOVE | Mockup puts usage in Settings → Usage & limits, already `UsageSettings`. |
| `RunsView`, `RunDetail`, `useWorkflowRuns`, `useWorkflowRun`, `useRunLog`, `lib/logs.ts` | REMOVE | Actions/runs sub-tab of the old PR page; the board has no runs. |
| `ChannelView`, `AgentInbox`, `RoutinesView`, `PluginsView`, `PrsView` (board), `AgentProfile`, `NewAgentDialog` | KEEP | Mockup screens. |
| `channels` placeholder branch | KEEP | Empty state of the real Channels page. |

## Window header, tabs and panes

| Candidate | Decision | Reason |
|---|---|---|
| `SessionHeader` (`layout/`) | REMOVE | Session title/branch header; `AgentChatHeader` replaces it. The header row stays as the drag bar. |
| `components/Tab*`, `TabRow`, `TabButton`, `TabBody` | KEEP | Still used by the PR board's pane and the sub-tabs. |
| `SplitView` (+ `DragGhost`, `DropZone`), `lib/groups.ts`, `lib/dragSession.ts`, `lib/sessionOrder.ts` | deferred | Multi-session pane grid. Removal reaches `useSessions` (146 KB) and the sidebar's drop targets; not finished this pass. |
| `RightPanel` session tabs: Browser, Files, Todo, PR, Docs | REMOVE | Mockup has no session side panel. |
| `RightPanel` shell and `PanelToggle` | KEEP | The PR board's detail pane still uses them. |
| `BrowserPane` (`browser/`) | REMOVE | Session browser tab; not in the mockup. |
| `components/files/*` (`FilesView`, `FileTabs`, `FileTree`, `FileViewer`) | REMOVE | Session Files tab. The file sheet from a chat link (`ChatSheets`, `openWith`) is KEEP. |
| `TodoPanel` | REMOVE | Session Todo tab. `TodoRows` stays (transcript rows use it). |
| `DocsPanel` | REMOVE | Session Docs tab; not in the mockup. |
| `PrPanel` (session PR tab) | KEEP | Session tab removed; `PrPanel` is still the body of the PR board sheet (`PrDetail` in `PrsView`), so it stays. |
| `OpenInButton` | KEEP | Used by `PrPanel` (open the checkout in an editor). |
| `WorktreeDialog`, `lib/worktree.ts` | REMOVE | Worktree delete from the UI. The Rust worktree engine stays. |

## Composer (ChatInput and toolbar)

| Candidate | Decision | Reason |
|---|---|---|
| `ComposerToolbar`, `ModelSelector` (model, effort, fast mode, project and branch pickers) | REMOVE | The mockup composer has no such controls; models live in agent settings. `fastMode.ts` stays (see deferred). |
| `lib/fastMode.ts` | deferred | `useSessions` reads it for the send path. |
| Fan-out: `useModelFanOut`, `lib/fanOut.ts` (+ test) | REMOVE | Not in the mockup. |
| Stash: `useStash`, `StashBadge` (+ test) | REMOVE | Not in the mockup. |
| `FollowupStrip` (live runs and plan strip) | REMOVE | Replaced by the mockup's working bar (`AgentWorking`, KEEP). |
| Worktree delete button in ChatInput | REMOVE | Worktree UI removed. |
| `PickerMenu`, mention and slash menus, `AttachButton`, `EmojiButton`, `MentionButton`, `DictateControl`, `ReplyBar`, `AgentWorking` | KEEP | Mockup composer. |
| `useCitations` | KEEP | Quote-to-composer flow (mockup reply bar). |

## Chat (Chat.tsx and transcript)

| Candidate | Decision | Reason |
|---|---|---|
| `CheckpointRail` (outline rail) | REMOVE | Session outline; not in the mockup. |
| Search-hit navigation (`seq` targeting) | REMOVE | Went with `SearchView`. |
| Session titles, forks | deferred | Fork and rename are wired through `useSessions`; the agent sidebar still calls `onFork`. |
| `SubagentChat` view and `useSubagentWork`, `StopDelegations` | REMOVE | Subagent column; not in the mockup. |
| `SubagentRow` in `TurnBlock` | KEEP | Transcript row for what the agent did. Revisit with the subagent view. |
| `TeamLine`, `TeamMessage`, `TeamReceived` | KEEP | Team messages are the ask-a-teammate flow (mockup slash command). |
| `TerminalCard` | KEEP | Terminal row for Take over (mockup). |
| `ToolCall`, `ToolGroupRow`, `StepTrace`, `AgentTrace`, `ImageRow`, `CodeView`, `FileLink`, `ChatSheets` | KEEP | Transcript and sheets that the mockup draws. |

## Sidebar, palette, shortcuts, menus

| Candidate | Decision | Reason |
|---|---|---|
| Sidebar row menu: Fork, Export, Delete session | deferred | Mockup agent row has no session menu; wiring crosses `useSessions`. |
| `CommandPalette` rows and `usePaletteSources` for removed pages | REMOVE for removed pages | Rows for Search, Usage, Runs, panes. Jump-to groups for agents, channels, routines, plugins, notes stay. |
| Shortcuts for removed actions (`search`, `usage.open`, `pane.*`, `panel.tab.*`, `view.browser`, `view.files`, `doc.save`, `worktree.toggle`, `model.next`, `effort.next`, `project.next`, `stash.prompt`, `notice.delete`) | REMOVE | Bound to removed surfaces. |
| Shortcuts for kept surfaces (`palette.open`, `settings`, `inbox.open`, `prs.open`, `plugins.open`, `dictate`, `attach`, `zoom.*`, `sidebar.toggle`, `queue.send`) | KEEP | Mockup surfaces. |
| `ShortcutsSettings` (Settings → Preferences → Shortcuts) | KEEP | The mockup Preferences page has a Shortcuts section. |
| `QuitDialog` | KEEP | App-level quit guard. |
| Rust menu (`quit.rs`: Hyze Code, Edit, View, Window) | KEEP | No menu item points at a removed screen. |
| `analytics.ts` (`track_feature`) | KEEP | Generic; removed call sites go with their features. |

## Settings

| Candidate | Decision | Reason |
|---|---|---|
| CLIs page → "Model providers (older sessions)" (`ProviderSettings`, `ProviderModels`, `ProviderMark`) | REMOVE | Old-session providers; the mockup CLIs page has none. `Harness::Other` reads stay in Rust. |
| Preferences → Apps: `OpenFilesRow`, `BrowserRow` | REMOVE | Session file and browser settings. |
| Preferences → Dictation (`TranscriptionSettings`) | KEEP | The mockup composer has Dictate. |
| Preferences → About (updates, analytics, feedback) | KEEP | App-level. |
| CLIs → `SourceControlSettings` | KEEP | The PR board needs `gh`. |
| Profile, Workspace, Agent defaults, Usage & limits, CLIs (`ClisSettings`) | KEEP | Mockup pages. |

## CLI (`apps/cli`)

| Candidate | Decision | Reason |
|---|---|---|
| `hz browser` | deferred | Drives the removed session browser. Socket handler is in Rust and not yet cut. |
| `hz new` | deferred | Starts a per-session task with project, model and worktree flags. |
| `hz ls`, `hz send`, `hz update`, `hz skill` | KEEP | Send to an agent and list agents. |

## Rust commands with no frontend caller

| Candidate | Decision | Reason |
|---|---|---|
| `plugin_mcp_server` family (create, get, list, update, delete, set enabled), `list_plugin_skills`, `read_plugin_skill`, `set_plugin_skill_enabled` | deferred | Registered but unused; the plugin screen uses `plugin_*`. Needs grep for other callers before delete. |
| Session goal: `create/edit/move/clear_session_goal`, `undo_turn`, `context_snapshot`, `log_commits`, `log_branch_commits` | deferred | Unused. The goal tests use the mcode `goal.rs` path, which stays. |
| `pty_open`, `pty_write`, `pty_close`, `pty_resize` | KEEP | Terminal for Take over (user asked). `pty_resize` has no caller yet, so Take over is not wired. |
| `agent_memory_delete`, `agent_memory_dir`, `cli_overview`, `channel_task(s)` | deferred | Unused. `channel_task(s)` is suspicious: `TaskSheet.tsx` may need it. |
| `list_workflow_runs`, `get_workflow_run`, `rerun_workflow` (in `github.rs`) | REMOVE with RunsView | Only the runs UI calls them; `github.rs` stays for the PR board. |
| Chromium and CEF (`chromium.rs`, `cef/`, `browser`) | KEEP | Plugin sign-in browser. |
| `search.rs` (`search_content`, `search_transcripts`) | REMOVE with SearchView | Only the search page calls them; the file index is checked before any cut. |
| `docs.rs` | deferred | Only DocsPanel and `useDocs` call it. `useDocs.openPath` is used by `FileLink` and stays. |
| `orchestration.rs` | KEEP | Routine and channel engine. |
| `pty.rs`, `shared_rules.rs`, `team.rs`, `routines.rs`, `automations.rs`, `inbox.rs`, `channels.rs`, `plugins.rs`, `plugin_*.rs`, `workspaces.rs`, `agent_profile.rs`, `limits.rs`, `budget.rs`, `spend.rs` | KEEP | Mockup features. |
| `session.rs`, `harness/*`, `store.rs`, `settings.rs`, `apps.rs`, `projects.rs` | KEEP | Engine. |

## Outcome

Removed this pass. Verified green: `tsc`, `biome lint src`, vitest (1083 tests), `pnpm build`, `cargo test` (832 tests), `cargo clippy --all-targets -- -D warnings`, `pnpm types`.

**Frontend, about 60 files deleted**
- Dead and unreached: `components/changes/*`, `components/plugins/AgentAvatar`, `components/ModelMark`, `hooks/useChanges|useRepo|useAvatar|usePluginAgents|useOpenFiles`, `lib/agentSkin|agents|commit|bloub/cycles`, `styles/attention-glow.css`.
- Search page: `SearchView`, `lib/search`, the palette's message and file-line rows and their query plumbing.
- Usage page: `UsageView`. Settings → Usage & limits stays.
- Runs: `RunsView`, `RunDetail`, `useWorkflowRuns|useWorkflowRun|useRunLog`, `lib/runs`, `lib/logs`. The PR board lost its Actions sub-tab.
- Session right pane: `components/files/*`, `components/browser/*`, `TodoPanel`, `DocsPanel`, `useDocs`, `lib/fileTree`, `lib/markdown`, `MetaLine`, `TabButton`. `RightPanel` is now a slim frame for the PR pane.
- Session header: `layout/SessionHeader`. The top row shows the page name only.
- Subagent view: `SubagentChat`, `useSubagentWork`, `StopDelegations`, the subagent column and its props. `SubagentRow` and `BackgroundTasksIndicator` draw without a click target.
- Composer: `ComposerToolbar`, `ModelSelector`, `StashBadge`, `FollowupStrip`, `useWorkStatus`; fan-out and stash UI; the model, effort and project chords; the worktree delete button.
- Settings: `ProviderSettings|ProviderModels|ProviderMark`, `hooks/useProviders`, the "Model providers (older sessions)" block.
- Keyboard: 16 registry rows for removed actions (search, usage, panel, doc, view, model, effort, project, stash, subtab).

**Rust, 41 Tauri commands unregistered, and their code**
- `search.rs` deleted (session transcript and content search).
- Workflow runs (`github.rs`): commands, `WorkflowRun`/`WorkflowJob`/`WorkflowStep`, their tests and the fixture.
- Git: `undo_turn`, `log_commits`, `log_branch_commits`, `fork_point`, `parse_log`, `in_tree`, and their tests.
- Docs: `save_doc`, `watch_docs` and the watcher. `read_doc` stays for the chat file sheet.
- Files: `list_dir` and its tests and helpers.
- Store and session: `record_context_reading`, `put_context_reading`, the `context_snapshot` method.
- Session goals (`create|move|edit|clear_session_goal`), `session_delegation_messages`, `context_snapshot`.
- Providers (`list|add|remove|test`, presets), the plugin MCP-server family, plugin agents, plugin skill list and read.
- Agent memory: `agent_memory_dir`, `agent_memory_delete`. `cli_overview` is now a private helper behind `cli_check_updates`.
- Rust tests about removed helpers removed. One test that depended on a deleted composer file now uses `MentionMenu.tsx`.

**Changed behaviour (on purpose)**
- A transcript link opens in the system browser. The in-app browser pane is gone.
- A plain click on a file link opens the chat's file sheet, not the Docs or Files panel.
- The PR page is the board only; the old Actions sub-tab is gone.
- `CLAUDE.md`: three bullets about deleted surfaces removed. `FEATURES.md`: sections for Actions, the repo view, the files view and the subagent view removed. `DESIGN.md`: Actions, handoff row, providers and composer furniture sections removed.

**Kept, and why**
- `PrPanel` and `OpenInButton`: the PR board sheet body and its "open in editor" button.
- `OpenFilesRow` and `BrowserRow` (Settings → Preferences → Apps): the editor choice the file sheet's "Open in editor" uses, and the Chromium download plugin sign-in relies on.
- `TranscriptionSettings` (Dictation): the composer's mic is in the mockup.
- `SourceControlSettings`: the PR board needs `gh`.
- `pty_open|write|close|resize`: Take over, as asked. Gap: nothing in the frontend calls them yet, so Take over is not wired.
- `changes_since`, `file_change`, `head_tree`, turn snapshots ("See what it did"). Gap: no frontend call to these remains either, so check that the diff path still reaches them.
- `channel_task`, `channel_tasks`: the channel task sheet. Gap: no frontend call either.
- `lib/providerLimits`, `lib/providerNames`: groundwork for the plan-limits feature in AGENTS-PLAN. No UI yet, but tested. Left for that phase.
- `lib/modelVisibility`: only `mcode.test.ts` uses it now. It holds the model and effort rules that test pins.
- The engine: ACP, session, mapper, store, `Harness::Other`, mcode providers, plugin engine.
- `hz` CLI: unchanged this pass.

**Deferred (not finished, each with a reason)**
- Split view and groups (`SplitView`, `lib/groups`, `dragSession`, `sessionOrder`, the `pane.1-9` chords, `paneChatProps`). Removing it reaches `useSessions` (146 KB), which owns the group model.
- Worktree UI: `WorktreeDialog`, `lib/worktree`, `askAboutWorktree`, the worktree notice cards in `NoticeStack`. The notice machinery has special cases for those kinds.
- Fan-out send path and stash (`useModelFanOut`, `lib/fanOut`, `useStash`, `fastMode`) are still read by `useSessions`, so the send code keeps dead branches.
- Archive state in `ChatInput` ("Unsettle") and the archived list. A session concept outside the mockup, but it runs through the sidebar.
- Sidebar row menu: Fork, Export, Delete session. The mockup agent row has none of them.
- Export rows in the Jump-to palette (`session.export`, `session.exportJson`).
- CLI `hz browser` (drives the removed pane) and `hz new` (per-session task with worktree flags). Both need the socket handler and `hz-proto` changed together.
- `FEATURES.md` still names removed components in places (for example the Pull requests section). A full pass over the 320 KB file is its own job.
