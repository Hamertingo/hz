// The conversation's fake data: each roster agent's chat carries what the mockup's does, so the
// transcript can be compared card for card in a plain browser. Rich cards ride in the agent's text as
// ```hz-card blocks, the same way a real agent would post one.
import { ROSTER, item } from "../devMock";

const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();
const card = (c: Record<string, unknown>) => "```hz-card\n" + JSON.stringify(c) + "\n```";

type Turn = { ask: string; say?: string; steps?: number; open?: boolean; approve?: boolean; ago: number };

function build(sessionId: string, turns: Turn[]) {
  let seq = 0;
  const out: Record<string, unknown>[] = [];
  const push = (payload: Record<string, unknown>, ago: number, turnId: string) =>
    out.push({ id: `${sessionId}-e${++seq}`, sessionId, harness: "claude-acp", seq, ts: iso(ago), turnId, subagent: null, payload, raw: null });
  turns.forEach((t, i) => {
    const id = `t${i}`;
    push({ type: "user_message", text: t.ask, images: [], baseline: null, queued: false, from: null, replyTo: null, cwd: null }, t.ago + 2, id);
    for (let s = 0; s < (t.steps ?? 0); s += 1) {
      const callId = `${id}c${s}`;
      push({ type: "tool_call_started", callId, name: "Read", toolType: "read", input: { path: `file${s}.md` }, rawInput: { path: `file${s}.md` }, title: `Read file${s}.md` }, t.ago + 1.5, id);
      push({ type: "tool_call_completed", callId, result: { text: "ok", isError: false, structured: null, exitCode: null, durationMs: 800 + s * 300, images: [] } }, t.ago + 1.4, id);
    }
    if (t.approve) {
      push({ type: "permission_requested", requestId: `r${i}`, toolUseId: `${id}x`, toolName: "Bash", displayName: "Run a command", title: "Run pnpm db:migrate on staging?", description: "Adds the usage_events table. Reversible.", input: { command: "pnpm db:migrate --env staging" }, blockedPath: null, decisionReason: null, decisionReasonType: null, agentId: null, options: [{ id: "o1", label: "Approve", kind: "once" }, { id: "o2", label: "Always allow this", kind: "always_rule" }, { id: "o3", label: "Deny", kind: "deny" }] }, 1, id);
    }
    if (t.open) return;
    push({ type: "assistant_text", block: 0, text: t.say ?? "" }, t.ago, id);
    push({ type: "turn_completed", status: "completed", stopReason: "end_turn", finalText: t.say ?? "", usage: null, durationMs: 44000, head: null }, t.ago, id);
  });
  return out;
}

const CHATS: Record<string, Turn[]> = {
  "s-a1": [
    {
      ask: "How does the Pro plan pricing look?",
      ago: 70,
      say: `Morning, Gabriel. I closed the pricing analysis for the Pro plan. The annual plan at **$290** beats $278 on margin by 4 points.\n\n${card({ type: "chart", title: "Margin by annual price", unit: "%", bars: [["$250", 31], ["$265", 36], ["$278", 40], ["$290", 44], ["$310", 43]], highlight: 3, note: "Churn stays flat up to $290, then rises." })}\n\n${card({ type: "sources", items: [{ domain: "stripe.com", title: "Stripe Billing docs" }, { domain: "paddle.com", title: "SaaS pricing report 2026" }, { domain: "hyzecloud.com", title: "Our usage data, last 90 days" }] })}`,
    },
    {
      ask: "Good. Can you also check what Mila has queued for launch day?",
      steps: 4,
      ago: 40,
      say: `Mila has the launch thread, the blog post and two stories queued. The thread needs your OK before it goes out, so I asked her to wait.\n\n${card({ type: "page", title: "Pro plan pricing page", url: "pages.hz/hyze/pro", version: 3 })}\n\n${card({ type: "call", who: "Atlas", duration: "2:14", summary: ["Show $290 a year on the page, test $278 after launch.", "Mila holds the thread until you approve it.", "Atlas sends the funnel numbers on Friday."] })}\n\n${card({ type: "question", who: "Atlas", title: "Which annual price should the page show?", detail: "Both beat the monthly plan on margin.", options: ["$290 / year", "$278 / year"], recommended: 0, time: "21:15" })}`,
    },
  ],
  "s-a2": [
    {
      ask: "Run the api tests and fix whatever fails.",
      ago: 30,
      say: `On it. I'll run the filtered suite first, then the full one if it's clean.\n\n${card({ type: "approved", what: "Terminal command", command: "pnpm test --filter api", time: "20:58" })}\n\n${card({ type: "code", file: "src/webhook.rs", code: "let delay = base * 2u64.pow(attempt);\nlet delay = delay.min(60_000);\nsleep(Duration::from_millis(delay)).await;" })}`,
    },
    { ask: "Fix the retry backoff too.", steps: 3, ago: 2, open: true, approve: true },
  ],
  "s-a3": [
    {
      ask: "Can I publish the launch thread?",
      ago: 50,
      say: `The launch thread is ready: 7 posts, one image. I won't publish without you.\n\n${card({ type: "draft", to: "X · @hyzecloud", part: "Post 1 of 7", body: "Sandbox VMs by the hour, built for agents.\n\nThe Pro plan opens Oct 30. Spin up a VM, let your agent work, pay for the minutes it ran." })}\n\n${card({ type: "message", text: "Show me the first post.", time: "20:55", failed: true })}`,
    },
  ],
  "s-a4": [
    {
      ask: "What are people paying for sandboxes by the hour?",
      ago: 120,
      say: `${card({ type: "voice", duration: "0:42" })}\n\n3 sources on usage-based billing. Short version: per-minute billing wins trust, per-hour wins margin.\n\n${card({ type: "sources", items: [{ domain: "e2b.dev", title: "E2B pricing" }, { domain: "modal.com", title: "Modal pricing" }, { domain: "fly.io", title: "Fly Machines pricing" }] })}`,
    },
  ],
  "s-a5": [
    {
      ask: "Make a cover image for the Sandbox VMs post.",
      ago: 1700,
      say: `${card({ type: "gen", color: "#38bdf8" })}\n\nDraft is in Drive: Sandbox VMs. The cover is still rendering.`,
    },
  ],
  "s-a6": [
    {
      ask: "How is the Firecracker pool?",
      ago: 50,
      say: `Firecracker pool is at 72%. I can add a second region, but I need a key.\n\n${card({ type: "key", name: "HETZNER_API_TOKEN", why: "To create the second pool in Falkenstein." })}`,
    },
  ],
  "s-a7": [
    {
      ask: "Anything new on the base image?",
      ago: 3000,
      say: `No new CVEs in the base image. One thing needs you: the AWS console wants a second factor.\n\n${card({ type: "takeover", site: "console.aws.amazon.com", why: "Sign in needs your phone. Take over the browser, finish it, then give it back." })}\n\n${card({ type: "qr", site: "WhatsApp Web", why: "Scan this with your phone so I can read the support group." })}`,
    },
  ],
};

const model = (id: string, label: string) => ({
  id, label, efforts: [], defaultEffort: null, baseId: id, contextWindow: 200000, maxTokens: 64000, variant: "", arg: id, provider: "", acceptsImages: true, secondary: false,
});

export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  list_models: () => [model("claude-sonnet-5-5", "Sonnet 5.5"), model("claude-opus-5-5", "Opus 5.5")],
  get_session_by_id: (a) => {
    const id = String(a.sessionId);
    const r = ROSTER.find((x) => x.sessionId === id);
    if (!r) return null;
    return { ...item(r), events: build(id, CHATS[id] ?? []), hasOlder: false };
  },
};
