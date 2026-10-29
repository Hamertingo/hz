import { handlers as shell } from "./shell";

const NOW = Date.now();
const day = 86_400_000;
const routine = (id: string, agentId: string, name: string, days: number[], time: string, on: boolean) => ({
  id, name, agentId, trigger: { kind: "schedule", days, time, tz: "UTC" }, act: name.toLowerCase(), prompt: name, to: "agent_chat", quiet: false, on,
  nextRunAt: new Date(NOW + day).toISOString(), skipped: [], runs: [], secret: null, createdAt: new Date(NOW - 9 * day).toISOString(), deletedAt: null,
  projectPath: null, model: null, legacyEveryMinutes: null,
});
const feed = (kind: string, title: string, sub: string, ago: number, seq: number, extra: Record<string, unknown> = {}) => ({
  group: kind === "pr" ? "file" : "file", kind, title, sub, atMs: NOW - ago * day, seq, path: kind === "file" ? `/tmp/${title}` : null, url: null, number: null, repo: null, peer: null, ask: null, answer: null, ...extra,
});

let vm = "stopped";

export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  routines_list: () => ({
    routines: [
      routine("r1", "a3", "Daily content", [0, 1, 2, 3, 4, 5, 6], "10:00", true),
      routine("r2", "a3", "Weekly pricing review", [0], "09:00", true),
      routine("r3", "a1", "Roadmap sync", [0], "09:00", false),
    ],
    running: [],
  }),
  routine_set_on: (a) => ({ ...routine(String(a.id), "a3", "Daily content", [0], "10:00", Boolean(a.on)) }),
  agent_instr_list: () => [
    { n: 12, atMs: NOW - day, summary: "Added 3 lines", chars: 240 },
    { n: 11, atMs: NOW - 4 * day, summary: "Restored V8", chars: 210 },
    { n: 10, atMs: NOW - 9 * day, summary: "Added 1 line", chars: 190 },
  ],
  kit_logins: () => [
    { site: "github.com", user: "hyzecloud", used: "today" },
    { site: "vercel.com", user: "gabriel@hyze.cloud", used: "2 days ago" },
    { site: "notion.so", user: "gabriel@hyze.cloud", used: "last week" },
    { site: "figma.com", user: "design@hyze.cloud", used: "last week" },
  ],
  kit_vm_state: () => vm,
  kit_vm_start: () => {
    vm = "running";
    return null;
  },
  kit_takeover_state: () => false,
  kit_takeover: () => null,
  kit_screen_for: () => 1,
  kit_screenshot: () => {
    throw new Error("no screen in the browser");
  },
  kit_vm_size: () => null,
  channel_get: (a) => {
    const channel = (shell.channels_list({}) as { id: string }[]).find((c) => c.id === a.id);
    const msg = (seq: number, from: string, text: string, ago: number) => ({
      seq, ts: NOW - ago * 60_000, from, text, replyTo: null, reactions: [], round: 1, taskId: null, kind: "message", attachments: [],
    });
    const task = (id: string, title: string, status: string) => ({
      id, channelId: String(a.id), title, owner: "a3", status, created: NOW - day, updated: NOW - 3_600_000, messageSeq: null, result: null, steps: [],
    });
    return {
      channel,
      messages: [msg(1, "a3", "Thread draft is in. @Leo can you match the blog title to it?", 45), msg(2, "a5", "Done. Title is “Sandbox VMs, explained”.", 40)],
      tasks: [
        task("t1", "Freeze the pricing page copy", "done"),
        task("t2", "Finish the launch thread (7 posts)", "done"),
        task("t3", "Match blog title to the thread", "writing"),
        task("t4", "Schedule everything for Oct 30, 10:00", "waiting"),
      ],
      threads: [],
      working: { agents: [], round: 0 },
    };
  },
  agent_spend: () => ({ month: "2026-10", spentUsd: 3.4, budgetUsd: 20, state: "ok" }),
  agent_activity: () => ({
    messages: Array.from({ length: 140 }, (_, i) => NOW - Math.floor(((i * 37) % 130) * day) - (i % 5) * 3_600_000),
    tasks: [], spend: [], lastTotal: 120, open: null,
    calls: [1, 3, 6, 9].map((h) => ({ atMs: NOW - h * 3_600_000, inputTokens: 48_000 + h * 1000, outputTokens: 6_000, costUsd: 0.21 })),
    feed: [
      feed("pr", "github.com", "hyzecloud · pull · 482", 0, 5, { url: "https://github.com/hyzecloud/x/pull/482" }),
      feed("pr", "vercel.com", "hyzecloud · deployments", 0, 6, { url: "https://vercel.com/hyzecloud" }),
      feed("file", "pricing-analysis.md", "Document · today", 0, 1),
      feed("file", "hero-v2.png", "Image · yesterday", 8, 2),
      feed("file", "launch-thread.md", "Document · yesterday", 9, 3),
      feed("file", "demo-reel.mp4", "Video · yesterday", 9, 4),
    ],
  }),
};
