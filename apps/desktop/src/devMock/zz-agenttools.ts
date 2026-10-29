// What an agent posts with its hz tools (src-tauri/src/agent_tools.rs), as it reaches the transcript: each tool call
// with the input the agent sent and the answer hz gave, so `lib/hzTools.ts` draws every card from the same shapes a
// real run logs. Appended to Atlas's chat, after the turns `chat.ts` gives it; the sign-in still waiting is Leo's,
// whose chat nothing else appends to, so it stays the turn in flight.
import { handlers as chat } from "./chat";

const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();
const SESSION = "s-a1";
const WAITING = "s-a5";
const WAKE_MARK = "<hz-wake/>";

const svg = (body: string, w = 640, h = 400) =>
  `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)}`;

// A desktop with a browser and a code on it, at the region the qr_login call names.
const QR_CELLS = Array.from({ length: 21 * 21 }, (_, i) => i)
  .filter((i) => ((i * 7919) % 13) % 3 === 0 || [0, 1, 2, 20, 21, 22, 40, 41, 42].includes(i % 63))
  .map((i) => `<rect x="${230 + (i % 21) * 8}" y="${90 + Math.floor(i / 21) * 8}" width="8" height="8"/>`)
  .join("");
const SCREEN = svg(
  `<rect width="640" height="400" fill="#2b2d31"/><rect x="40" y="30" width="560" height="340" rx="8" fill="#fff"/>` +
    `<rect x="40" y="30" width="560" height="28" rx="8" fill="#e8e8ea"/><text x="60" y="49" font-size="13" fill="#555">web.whatsapp.com</text>` +
    `<rect x="222" y="82" width="184" height="184" fill="#fff"/><g fill="#111">${QR_CELLS}</g>` +
    `<text x="320" y="300" font-size="15" text-anchor="middle" fill="#333">Scan to link a device</text>`,
);
const DEPLOY = svg(
  `<rect width="640" height="400" fill="#f4f4f6"/><rect x="0" y="0" width="640" height="36" fill="#1f2937"/>` +
    `<text x="16" y="23" font-size="14" fill="#fff">Deploys - hyze-cloud</text>` +
    [0, 1, 2, 3].map((i) => `<rect x="24" y="${60 + i * 74}" width="592" height="60" rx="8" fill="#fff"/><circle cx="52" cy="${90 + i * 74}" r="8" fill="${i ? "#22c55e" : "#f59e0b"}"/><text x="72" y="${95 + i * 74}" font-size="14" fill="#111">${i ? `v0.20.${16 - i} - live` : "v0.20.16 - building"}</text>`).join(""),
);

const PAGE_V = [
  `<h1>Pro plan pricing</h1><p>Annual at <b>$290</b> keeps margin at 44% with churn flat.</p>`,
  `<h1>Pro plan pricing</h1><p>Annual at <b>$290</b> keeps margin at 44% with churn flat.</p><table><tr><th>Price</th><th>Margin</th></tr><tr><td>$278</td><td>40%</td></tr><tr><td>$290</td><td>44%</td></tr></table>`,
  `<h1>Pro plan pricing</h1><p>Annual at <b>$290</b> keeps margin at 44% with churn flat. Test $278 after launch.</p><table><tr><th>Price</th><th>Margin</th><th>Churn</th></tr><tr><td>$278</td><td>40%</td><td>2.1%</td></tr><tr><td>$290</td><td>44%</td><td>2.1%</td></tr><tr><td>$310</td><td>43%</td><td>2.9%</td></tr></table>`,
];

const WIDGET = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:"><script>window.hz={reply:function(t){parent.postMessage({type:'hz-reply',text:String(t)},'*')}};</script></head><body>
<style>body{font:14px system-ui;margin:16px;color:#222}label{display:block;margin:8px 0}button{margin-top:10px;padding:6px 12px;border-radius:8px;border:1px solid #ccc;background:#f6f6f6;cursor:pointer}</style>
<b>Seats calculator</b><label>Seats <input id="n" type="range" min="1" max="50" value="12" oninput="o.textContent=n.value*24"></label>
<p>US$ <span id="o">288</span> a month</p><button onclick="hz.reply('Go with '+n.value+' seats')">Use this</button></body></html>`;

const DRAFTS = [
  { id: "d_9f2c41aa01", to: "ana@acme.com", subject: "Your October invoice", body: "Hi Ana,\n\nThe October invoice is attached: 12 seats, US$ 288. It is due on Nov 10.\n\nThanks,\nGabriel", attachments: ["invoice-oct.pdf"], channel: "gmail", state: { state: "draft" }, receipt: null },
  { id: "d_7a1b2c3d4e", to: "X · @hyzecloud", subject: "Post 1 of 3", body: "Sandbox VMs by the hour, built for agents. The Pro plan opens Oct 30.", attachments: [], channel: "clipboard", state: { state: "draft" }, receipt: null },
];

type Ev = Record<string, unknown>;
const result = (text: string, isError = false) => ({ text, isError, structured: null, exitCode: null, durationMs: 420, images: [] });

function turns(start: number, session: string): Ev[] {
  let seq = start;
  const out: Ev[] = [];
  const push = (payload: Ev, ago: number, turnId: string) =>
    out.push({ id: `${session}-hz${++seq}`, sessionId: session, harness: "claude-acp", seq, ts: iso(ago), turnId, subagent: null, payload, raw: null });
  const call = (turnId: string, callId: string, tool: string, input: Ev, answer: string | null, ago: number, isError = false) => {
    push({ type: "tool_call_started", callId, name: `mcp__hz__${tool}`, toolType: "mcp", input, rawInput: null, title: null }, ago, turnId);
    if (answer !== null) push({ type: "tool_call_completed", callId, result: result(answer, isError) }, ago, turnId);
  };
  const user = (turnId: string, text: string, ago: number) =>
    push({ type: "user_message", text, images: [], baseline: null, queued: false, from: null, replyTo: null, cwd: null }, ago, turnId);
  const done = (turnId: string, text: string, ago: number) => {
    push({ type: "assistant_text", block: 0, text }, ago, turnId);
    push({ type: "turn_completed", status: "completed", stopReason: "end_turn", finalText: text, usage: null, durationMs: 61000, head: null }, ago, turnId);
  };

  user("hz1", "Draft Ana's invoice email, post the pricing page and show me where launch stands. And we need someone on support.", 30);
  call("hz1", "h1", "show_plan", { steps: [{ text: "Draft Ana's email", status: "running" }, { text: "Post the pricing page" }, { text: "Show the numbers" }, { text: "Make a support agent" }] }, "Plan shown (id c_plan00001): 0 of 4 done.", 29);
  call("hz1", "h2", "propose_draft", { to: "ana@acme.com", subject: "Your October invoice", body: DRAFTS[0].body, attachments: ["invoice-oct.pdf"], via: "gmail" }, `Draft posted (id ${DRAFTS[0].id}). It is a card in the chat now: the person edits it, then sends, copies or discards it.`, 28);
  call("hz1", "h3", "page_create", { title: "Pro plan pricing", html: PAGE_V[0] }, "Page posted (id p_51c0de2a9b, version 1). The person opens it from its card.", 27);
  call("hz1", "h4", "page_update", { id: "p_51c0de2a9b", html: PAGE_V[2], base_version: 1 }, "Page updated (id p_51c0de2a9b, version 3). 2 block(s) changed. Next base_version is 3.", 26);
  call("hz1", "h5", "show_chart", { title: "Signups this week", kind: "line", unit: "", points: [["Mon", 42], ["Tue", 51], ["Wed", 48], ["Thu", 66], ["Fri", 80], ["Sat", 71], ["Sun", 93]].map(([label, value]) => ({ label, value })), note: "Friday's post doubled Monday." }, "Chart shown in the chat (id c_chart0001): 7 points.", 25);
  call("hz1", "h6", "show_chart", { title: "Where trials come from", kind: "pie", unit: "%", points: [{ label: "X", value: 46 }, { label: "Search", value: 31 }, { label: "Referral", value: 23 }] }, "Chart shown in the chat (id c_chart0002): 3 points.", 25);
  call("hz1", "h7", "show_widget", { title: "Seats calculator", html: "<b>Seats calculator</b>…" }, "Widget \"Seats calculator\" shown (id w_0c0ffee123). It has no network.", 24);
  call("hz1", "h8", "share_screenshot", { caption: "The deploy page: 0.20.16 is still building" }, `Screenshot shared (id c_shot00001) (file ${DEPLOY}). The person sees it in the chat and in your Library.`, 23);
  call("hz1", "h9", "wake_when_done", { pid: 4242, label: "the 0.20.16 build", log: "/tmp/build.log" }, "Watching pid 4242 (id c_watch0001): the 0.20.16 build. When it ends you get a message in this chat.", 22);
  call("hz1", "h10", "create_agent", { name: "Ivy", role: "Support", job: "Answer support tickets in plain words. Ask Atlas before refunds." }, "Made Ivy (id c_agent0001), Support. They are on the team and in the person's sidebar.", 21);
  call("hz1", "h11", "show_plan", { steps: [{ text: "Draft Ana's email", status: "done" }, { text: "Post the pricing page", status: "done" }, { text: "Show the numbers", status: "done" }, { text: "Make a support agent", status: "done" }] }, "Plan shown (id c_plan00002): 4 of 4 done.", 21);
  done("hz1", "Ana's email is a draft for you to send, the pricing page is up (version 3), and Ivy is on support. I'll pick up when the build finishes.", 20);

  user("hz2", `${WAKE_MARK}"the 0.20.16 build" finished after 7 min.\nLast log lines:\nbundling… done\n✓ built in 6m 58s`, 12);
  call("hz2", "h12", "request_login", { site: "github.com", why: "To publish the 0.20.16 release." }, "Sign-in card (id c_login0001) answered. The person says they are signed in to github.com on your computer.", 11);
  done("hz2", "The build is done and the 0.20.16 release is published.", 10);
  if (session === SESSION) return out;

  out.length = 0;
  user("hz3", "Can you read the support group on WhatsApp?", 2);
  call("hz3", "h13", "qr_login", { site: "WhatsApp Web", why: "So I can read the support group.", region: { x: 222, y: 82, w: 184, h: 184 } }, null, 1);
  return out;
}

export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  get_session_by_id: (a) => {
    const base = chat.get_session_by_id(a) as { events: Ev[] } | null;
    if (!base || (a.sessionId !== SESSION && a.sessionId !== WAITING)) return base;
    const last = Math.max(0, ...base.events.map((e) => Number(e.seq)));
    // The QR card waits on a live turn. The mock sends no `session_status`, so Leo's chat reads as at rest and the
    // card as unanswered until one arrives with `in_progress`.
    return { ...base, events: [...base.events, ...turns(last, String(a.sessionId))] };
  },
  kit_drafts_list: () => DRAFTS,
  kit_draft_send: (a) => ({ ...DRAFTS.find((d) => d.id === a.id), body: a.body, state: { state: "sent" }, receipt: "10:02" }),
  kit_draft_act: (a) => ({ ...DRAFTS.find((d) => d.id === a.id), state: { state: a.action === "discard" ? "discarded" : "draft" } }),
  kit_page_get: (a) => {
    const v = typeof a.version === "number" ? a.version : 3;
    return { id: a.id, title: "Pro plan pricing", version: v, current: 3, html: PAGE_V[v - 1] ?? PAGE_V[2] };
  },
  kit_page_history: () => [[3, NOW / 1000 - 1560], [2, NOW / 1000 - 1600], [1, NOW / 1000 - 1620]],
  kit_page_restore: () => 4,
  kit_widget_get: () => WIDGET,
  kit_screenshot: () => SCREEN,
  kit_login_answer: () => null,
  kit_login_pending: () => ({ type: "signin", site: "WhatsApp Web", why: "So I can read the support group.", qr: true, region: { x: 222, y: 82, w: 184, h: 184 }, state: "waiting" }),
  // The mock keeps no cards, so each one is drawn from its call's input, as a real one is until its card loads.
  kit_post_get: () => {
    throw new Error("no such card");
  },
};
