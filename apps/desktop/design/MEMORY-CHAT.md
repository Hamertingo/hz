# Memory and the person ↔ agent chat: Bots vs hz

Read from Bots' source (`/tmp/bots`) for behaviour only, in our own words. Clean room: copy no code or prompt text.

## Gaps, most important first

| What | Bots | hz today | Gap |
|---|---|---|---|
| Memory reaches the model | Pushed into every turn's prompt: up to 60 lines (preferences, then facts, then the last 10 summaries), each with a short id | Pulled: the agent must call `memory_list` / `memory_read`; the briefing only says how | missing |
| Session rotation | Fresh session after 3 h idle, past 200k tokens of context, after a safety refusal, or after `/clear`; carries the last 20 messages (≤ 600 chars each), no summary | One CLI session forever; CLI auto-compaction or a manual `/compact` | missing |
| `/clear` | A real fresh session; the history stays on screen | A page break only; the session is untouched | partial |
| Agent deletes a memory | `forget{id}` (accepts the short id) | No delete tool, yet the tidy prompt asks it to forget stale notes | missing (bug) |
| Cut-off turns after a restart | Re-queued once (last 10 min) with a "pick up where you stopped" note | Status reset to idle; the turn and the queue are lost | missing |
| Broken session or refusal | One retry in a fresh session with the recent chat; network retries; backup model | Respawn and resume a dead child only | partial |
| Memory limits | 500 chars a line, 200 lines an agent with eviction, duplicates merged, a nudge when over | None | missing |
| Facts about the person, shared | The main agent's preferences and facts go into every agent's prompt; folders isolated | Name and language line; "Teach every agent" copies a note; opt-in shared folder | partial |
| Time | Date in the system prompt (cache-safe), `now: HH:MM` on each message | None | missing |
| Memory activity in the chat | "Saved to memory" / "Deleted a memory" as steps in the turn's step list | Nothing for the agent's own writes | partial |
| Search past chats | In-chat search with jump to hits | Palette "Messages" group defined but unwired | partial |
| Message while busy | Injected into the live turn (Claude), else stop and re-read every unanswered line | Write-through during a tool, else queued to the turn's end; "Now" steers in | comparable |

## Where hz is ahead

Instruction version history, tags and provenance on notes, read counts, trash with undo, and a nightly tidy.
