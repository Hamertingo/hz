# Agents talking to each other, the Bots way

The person wants hz's agent-to-agent conversations to work like the Bots app. This note is the behaviour we
copy (read from Bots' source, described in our words; clean room: never copy their code or prompt text) and the
target design for hz. Also see `DS-BOT-IDEAS.md` (non-blocking hand-offs, merged unread messages).

## What Bots does

**One tool, never blocking.** `message_bot(bot, text)` (text ≤ 4000 chars, optional idempotency `operation_id`)
returns at once. The sender is told to tell the person in a line or two what it passed on, then end its turn.
- Name match: case-insensitive, leading @ ignored, exact name first then prefix; limited to the bots the caller
  can reach. A failed lookup lists who it can reach. There is no list tool; teammates are in the prompt.
- **From a group**: the target must be a member; the text is posted in the group as "@Target …" and the target
  answers there.
- **Elsewhere**: a **pair conversation** for the two bots is found or created. The person can read it but not
  write in it. The text is added there; the message remembers where the sender wrote from (so the answer finds
  its way back), the hop count and the person's original message. The receiver is woken **inside the pair**.
  - Sender's chat gets a row "Sent a message to Viktor" (expandable; opens the pair).
  - Receiver's own chat gets one line "N messages with X" (latest message + count; consecutive thread messages
    update the same line until something else is said there).
- **The answer comes back by itself**: the receiver's plain reply in the pair *is* the answer. The sender is woken
  in the chat it wrote from, with the answer framed as "[X answered in your thread]: …". Not woken when: it
  already has a run queued in the pair; the hop limit is reached; the answer only announced work ("I'll check…")
  — then the receiver keeps working and only its result wakes the sender. A reply of `NO_REPLY` wakes nobody and
  shows nothing. An aborted (stopped) turn never sends a half answer back.
- `post_to_group(group, text)`: posts in a group the bot belongs to; @mentions wake those members there; answers
  stay in the group. `read_group(group?, limit)`: list its groups, or the last N messages of one.
- The bot's next turn in its own chat gets a short "meanwhile in your groups" note (last 48 h, ≤ 20 lines).

**Loop and spam protection**
- Hops: the person's message is 0; each message_bot is +1, each answer is +1; refused above 4.
- Rate: at most 12 bot-triggered runs per conversation in 10 minutes, then one quiet status line saying it paused.
- No thanking: an acknowledgement-only message wakes nobody; prompts say NO_REPLY to small talk/thanks/goodbye.
- No double wake within one turn; a message that already triggered a run is skipped.
- `@Name` typed in your own chat reaches nobody (the prompt says so).

**Prompts (summarised)**
- With teammates around: list of teammates with one-line descriptions; the main agent hands work to the best
  placed teammate and keeps the person posted; others ask the main agent when unsure; offer to pass work on and
  only send once the person agrees (unless they asked); write a complete briefing (who asked and why, exact paths,
  what is known, cautions, ask them to report back); then tell the person in one or two sentences.
- Receiver in a pair: private thread with a colleague; the person can read, not write; answer short, like a
  colleague; if work was asked, do it and give the result there; route decisions for the person through the other
  agent; don't greet the person; NO_REPLY when nothing is left; sees the last 10 unseen thread messages.
- Sender woken by an answer: tell the person briefly what came back and carry on; NO_REPLY if it was small talk;
  answer the colleague with message_bot.

**Status**: each agent runs one turn at a time; person-started runs go first; a person's message to an agent busy
in a pair interrupts that work, which is re-queued after with a "resume" note. Pair messages never push or ring.
After a restart, turns cut off in the last 10 minutes are re-queued once with a "you were cut off" note.

## Target in hz

- Replace the blocking `team_ask` (team.rs waits up to 10 min) with the Bots flow; keep `team_message` as the one
  tool (rename the description to match), plus `read_channel`/`post_to_channel` for channels (hz calls groups
  "channels"). Keep the workspace's hand-off limit setting but default it to 4 hops.
- A **pair thread** = a hidden, read-only channel-like thread between two agents, persisted. Reuse hz's channel
  machinery where it fits (each agent already gets its own ACP session per channel in `orchestration.rs` /
  `channels.rs`), so the receiver answers in its pair session and its own chat stays clean.
- Waking the sender = a prompt into the sender's session (the one it wrote from), framed with the answer.
- UI: the sender row (`components/chat/TeamMessage.tsx` / `TeamLine.tsx`, just restyled as a centred pill) and the
  receiver line "N messages with X"; both open the pair thread read-only (a sheet or the channel view, read-only).
  The sidebar/header status "waiting for X" (amber) and "working for X" use `lib/agentStatus.ts` activities.
- Briefing layers in `agents.rs` replace the current team text with the rules above, in our words.
