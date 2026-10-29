# Ideas from DS Bot (Apache-2.0)

Source: github.com/Fei2411/DS-Bot, cloned for reading. Apache-2.0, so code may be ported with attribution
(keep their NOTICE text in THIRD-PARTY-LICENSES.md and say which file it came from). Design notes in their
`docs/plans/*.md` (Chinese) explain each decision.

## Features, most useful first

1. **Hand-offs as a tree, never blocking.** Asking another agent ends your turn; if B hands part to C, B's answer
   to A waits until C is back, then goes up with C's result attached. Only rule: you can't message someone who is
   waiting on you (loop). Persisted across restarts. (`ds-bot/src/host/handoffs.js:95-196`, `turns.js ~590`)
   hz today: `team_ask` blocks up to 10 min.
2. **Teammate status for agents.** `list_bots` returns one line per agent: waiting for approval, working (where,
   how long, tool), waiting for X, idle. Not in the system prompt (cache). (`handoffs.js:219`)
3. **Merge unread messages from the same sender** for the same work. (`tools.js:96, 226-240`)
4. **Group chats done right.** One speaker at a time with a visible speaking order; relays pause (Continue button)
   instead of dropping; user messages join the running round; members still working after 15 s go to background
   with merged progress lines; timeout counts silence only; each member gets only what it hasn't seen; @all only
   from the admin; group notice in every member's prompt. (`groups.js:39-885`)
5. **Chief builds a team from one sentence.** create_bot/update_bot/create_group/post_to_group; every new bot
   introduces itself and knows who made it and why; "Created ⟨avatar⟩ Writer" system rows. (`roster.js:172`,
   `prompt.js:27`)
6. **Memory that writes itself.** After each turn a cheap model call proposes ≤8 add/edit/remove changes with
   strict keep rules; group and team scopes; `recall` tool; refuses secrets. (`memory.js:225-433`)
7. **Side chat (`/side`)**: ask a working agent something without touching its history. (`side.js`)
8. **Non-blocking `ask_user` / view cards**: the question ends the turn; the answer is the next message; the card
   waits above the composer. (`client/questions.js`, `shared/views.js`)
9. **Robustness**: stopped/failed turns still answer the waiting sender; tool-call-written-as-text retry; restart
   recovery of in-flight turns; idempotent `request_id`; messages over 20k chars go as a file.
10. **Long-lived sessions**: rotate to a fresh session with a handoff note when the log is huge; FTS5 search over
    all past sessions. (`steward.js`, `chat-index.js`)

## UI ideas

- Group avatar cluster (2 diagonal, 3 triangle, 4 grid, +N; ring gaps by mask). (`client/mark.js:126-170`)
- Mascot states: thinking, searching, working, sending, waiting (sway, circling eyes), alert (hop + "?"),
  done (squash); motion level Quiet/Normal/Lively.
- Activity row with phrases held ≥ 800 ms; steps aside while text streams. (`activity-row.js`, `cells.js:744-797`)
- Status capsule above the group composer: who works, who waits for approval, inline Allow/Deny, Stop.
- Header pill that stretches to say "Memory updated".
- Details panel: model + provider, "Memory: 3 entries · Manage", usage with cache hit %, scheduled tasks.
- Usage page: 24h/7d/30d/12w/12m/custom, tokens + cache hit, stacked bars by bot/model, rankings, year heatmap.
- "Thought for Ns" folded reasoning row; turn duration on group replies; A↔B exchange sheet; @ menu bots first;
  "Reference a chat"; long messages fold; "N new messages" pills.

## Code worth porting

| What | Where | Port to |
|---|---|---|
| @mention parser (skips code, links, emails, file refs; longest name first) | `shared/mentions.js` | Rust + TS |
| `isPass` / `stripOwnName` | `host/groups.js:79-80` | Rust |
| Group round engine + prompt strings | `host/groups.js:101-450` | Rust (`channels.rs`) |
| Step-line merging | `host/groups.js:858-885` | Rust |
| Hand-off tree | `host/handoffs.js:95-196` | Rust (`team.rs`) |
| Teammate status wording | `host/handoffs.js:219-261` | Rust |
| Team rules prompt | `host/prompt.js:4-38` | briefing layers |
| Delivery headers | `host/delivery.js:17-35` | Rust strings |
| Memory review prompt + parser + secret check | `host/memory.js:225-433` | Rust |
| Safe formula language for live widgets | `shared/formula.js` | TS as is |
| Request idempotency | `host/requests.js:34-90` | Rust |
| Group avatar cluster | `client/mark.js:126-170` | TSX |
