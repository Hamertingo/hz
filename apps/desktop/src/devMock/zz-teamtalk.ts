// Agents talking to each other (talk.rs): Atlas asked Hugo where the pricing numbers came from, Hugo answered in
// their thread and Atlas was woken with it; Atlas then wrote to Mila, who is answering now. So Atlas's chat shows
// "Sent a message to Hugo" and "Answer from Hugo", Hugo's shows "2 messages with Atlas", and the sidebar says
// Atlas is waiting for Mila and Mila is working for Atlas.
import { handlers as tools } from "./zz-agenttools";

const NOW = Date.now();
const ms = (minAgo: number) => NOW - minAgo * 60000;
const iso = (minAgo: number) => new Date(ms(minAgo)).toISOString();

type Ev = Record<string, unknown>;

const ASK_HUGO =
  "Gabriel wants to know where the Pro plan numbers in pricing.md came from. Check the sources in research/pricing/ and tell me which ones back the $29 figure, with links. Report back here.";
const HUGO_SAYS =
  "Two sources back $29: the Q3 survey (research/pricing/survey-q3.md, 61% would pay $25–35) and the competitor sheet (E2B and Modal sit at $25 and $30). The third file is from 2024 and out of date.";
const ASK_MILA = "Can you turn Hugo's two sources into one line for the pricing page footnote? Keep it under 20 words.";

const answerPrompt = (from: string, text: string) =>
  `[${from} answered in your thread]\n\n${text}\n\n(Tell the person in a line or two what came back, then carry on. If it needs nothing from you, answer NO_REPLY. To write back to ${from}, use team_message.)`;

function atlasTurns(start: number): Ev[] {
  let seq = start;
  const out: Ev[] = [];
  const push = (payload: Ev, ago: number, turnId: string) =>
    out.push({ id: `s-a1-tt${++seq}`, sessionId: "s-a1", harness: "claude-acp", seq, ts: iso(ago), turnId, subagent: null, payload, raw: null });
  const user = (turnId: string, text: string, ago: number, from: Ev | null = null) =>
    push({ type: "user_message", text, images: [], baseline: null, queued: false, from, replyTo: null, cwd: null }, ago, turnId);
  const send = (turnId: string, callId: string, to: string, text: string, result: string | null, ago: number) => {
    push({ type: "tool_call_started", callId, name: "mcp__team__team_message", toolType: "mcp", input: { to, text }, rawInput: { to, text }, title: "team_message" }, ago, turnId);
    if (result) push({ type: "tool_call_completed", callId, result: { text: result, isError: false, structured: null, exitCode: null, durationMs: 40, images: [] } }, ago, turnId);
  };
  const done = (turnId: string, text: string, ago: number) => {
    push({ type: "assistant_text", block: 0, text }, ago, turnId);
    push({ type: "turn_completed", status: "completed", stopReason: "end_turn", finalText: text, usage: null, durationMs: 9000, head: null }, ago, turnId);
  };

  user("tt1", "Where did the Pro plan numbers come from? Ask Hugo.", 9);
  send("tt1", "tt-c1", "Hugo", ASK_HUGO, "Sent to Hugo. Tell the person in a line or two what you passed on, then end your turn: the answer comes back to this chat by itself.", 9);
  done("tt1", "I asked Hugo to check the sources behind the $29 figure. I'll tell you what he finds.", 9);

  user("tt2", answerPrompt("Hugo", HUGO_SAYS), 6, { sessionId: "s-a4", title: "Hugo" });
  done("tt2", "Hugo found two sources behind $29: the Q3 survey and the competitor sheet. The third file is from 2024, so I'd drop it.", 6);

  user("tt3", "Good. Have Mila write the footnote.", 3);
  send("tt3", "tt-c2", "Mila", ASK_MILA, "Sent to Mila. Tell the person in a line or two what you passed on, then end your turn: the answer comes back to this chat by itself.", 3);
  done("tt3", "Passed it to Mila: one footnote line from Hugo's two sources.", 3);
  return out;
}

const msg = (seq: number, from: string, text: string, minAgo: number, fromChat: boolean, toChat: boolean) => ({
  seq, ts: ms(minAgo), from, text, replyTo: null, reactions: [], round: 0, taskId: null, kind: "message", attachments: [], fromChat, toChat,
});

const PAIRS = [
  { channelId: "pair-a1-a4", members: ["a1", "a4"], messages: [msg(1, "a1", ASK_HUGO, 8.9, true, false), msg(2, "a4", HUGO_SAYS, 6.1, false, true)] },
  { channelId: "pair-a1-a3", members: ["a1", "a3"], messages: [msg(1, "a1", ASK_MILA, 2.9, true, false)] },
];

const detail = (p: (typeof PAIRS)[number]) => ({
  channel: {
    id: p.channelId, workspaceId: "w1", name: p.channelId, purpose: "", members: p.members, lead: p.members[0], mode: "mention", rounds: 1,
    muted: true, archived: false, created: ms(60), lastSeq: p.messages.length, lastTs: p.messages[p.messages.length - 1].ts,
    lastAgentSeq: p.messages.length, readSeq: 0, pair: true,
  },
  messages: p.messages, tasks: [], threads: [], working: { agents: [], round: 0 },
});

export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  get_session_by_id: (a) => {
    const base = tools.get_session_by_id(a) as { events: Ev[] } | null;
    if (!base || a.sessionId !== "s-a1") return base;
    const last = Math.max(0, ...base.events.map((e) => Number(e.seq)));
    return { ...base, events: [...base.events, ...atlasTurns(last)] };
  },
  team_status: () => [
    { agentId: "a1", waitingFor: ["a3"], workingFor: [] },
    { agentId: "a3", waitingFor: [], workingFor: ["a1"] },
  ],
  team_pairs: (a) =>
    PAIRS.filter((p) => p.members.includes(String(a.agentId))).map((p) => ({
      channelId: p.channelId,
      other: p.members.find((m) => m !== a.agentId),
      messages: p.messages,
    })),
  team_pair_between: (a) => {
    const p = PAIRS.find((x) => x.members.includes(String(a.a)) && x.members.includes(String(a.b)));
    return p ? detail(p) : null;
  },
};
