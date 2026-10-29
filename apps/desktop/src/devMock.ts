// Runs the real app in a plain browser with made-up data, so a screen can be looked at without the Tauri
// window. Only installed in `vite dev` when Tauri's bridge is absent; nothing here ships.
const agent = (id: string, name: string, role: string, color: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id, name, role, color, kind, harness: "claude-acp", projectPath: "/Users/you/hyze-cloud", modelId: "claude-sonnet-5-5", effort: null,
  workspaceId: "w1", permission: "auto", instructions: `${role} agent for Hyze Cloud`, pinned: false, sessionId: `s-${id}`, ...extra,
});
const ROSTER = [
  agent("a1", "Atlas", "Strategy", "#a58bfa", "ghost", { pinned: true, shape: "ghost", look: { eyes: "round", mouth: "smile", acc: "glasses", pat: "none" } }),
  agent("a2", "Ada", "Dev", "#f58a3c", "fox", { pinned: true, shape: "squircle", look: { eyes: "dot", mouth: "grin", acc: "headphones", pat: "none" } }),
  agent("a3", "Mila", "Marketing", "#ee73b2", "cat", { shape: "diamond", look: { eyes: "wide", mouth: "smile", acc: "bow", pat: "cheeks" } }),
  agent("a4", "Hugo", "Research", "#3ec46d", "frog", { shape: "cloud", look: { eyes: "round", mouth: "o", acc: "sprout", pat: "spots" } }),
  agent("a5", "Leo", "Content", "#38bdf8", "bunny", { shape: "drop", look: { eyes: "happy", mouth: "smile", acc: "cap", pat: "none" } }),
  agent("a6", "Vex", "Infra", "#d8d8d4", "owl", { shape: "hex", look: { eyes: "visor", mouth: "flat", acc: "antenna", pat: "stripes" } }),
  agent("a7", "Nox", "Security", "#6d6df0", "cat", { permission: "manual", shape: "cat", look: { eyes: "sleepy", mouth: "cat", acc: "horns", pat: "belly" } }),
];

const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();
const LAST: Record<string, [string, number]> = {
  a3: ["Posted the daily content. Want a carousel for tomorrow?", 4],
  a4: ["Found 3 sources on the pricing change.", 38],
  a5: ["Draft of the launch post is ready.", 130],
  a6: ["Disk on node-2 is at 82%.", 600],
  a1: ["Roadmap for Q4 is in the doc.", 1500],
  a2: ["Fixed the flaky test, PR is open.", 2900],
};
export const item = (a: (typeof ROSTER)[number]) => ({
  sessionId: a.sessionId, harness: a.harness, cwd: a.projectPath, projectPath: a.projectPath, branch: null, worktreeName: null,
  worktreeRemoved: false, title: a.name, model: a.modelId, effort: null, permissionMode: "auto", fast: false, status: "idle",
  forkFrom: null, threadId: null, parentSessionId: null, purpose: null, contextReading: null,
  created: iso(3000), modified: iso(LAST[a.id]?.[1] ?? 60), archived: false, pinned: a.pinned,
});
let seq = 0;
const ev = (sessionId: string, payload: Record<string, unknown>, minAgo: number, turnId: string | null = "t1") => ({
  id: `e${++seq}`, sessionId, harness: "claude-acp", seq, ts: iso(minAgo), turnId, subagent: null, payload, raw: null,
});
function events(sessionId: string) {
  seq = 0;
  const a = ROSTER.find((r) => r.sessionId === sessionId);
  const last = a ? LAST[a.id]?.[0] ?? "Done." : "Done.";
  return [
    ev(sessionId, { type: "user_message", text: "Can you write today's post and check the calendar?", images: [], baseline: null, queued: false, from: null, replyTo: null, cwd: null }, 12),
    ev(sessionId, { type: "tool_call_started", callId: "c1", name: "Read", toolType: "read", input: { path: "calendar.md" }, rawInput: { path: "calendar.md" }, title: "Read calendar.md" }, 11),
    ev(sessionId, { type: "tool_call_completed", callId: "c1", result: { text: "12 events", isError: false, structured: null, exitCode: null, durationMs: 80, images: [] } }, 11),
    ev(sessionId, { type: "tool_call_started", callId: "c2", name: "Write", toolType: "edit", input: { path: "post.md" }, rawInput: { path: "post.md" }, title: "Write post.md" }, 10),
    ev(sessionId, { type: "tool_call_completed", callId: "c2", result: { text: "wrote post.md", isError: false, structured: null, exitCode: null, durationMs: 120, images: [] } }, 10),
    ev(sessionId, { type: "assistant_text", block: 0, text: last }, 5),
    ev(sessionId, { type: "permission_requested", requestId: "r1", toolUseId: "c3", toolName: "Bash", displayName: "Run a command", title: "Run a command", description: "Run the build to check the post renders", input: { command: "pnpm build" }, blockedPath: null, decisionReason: null, decisionReasonType: null, agentId: null, options: [
      { id: "o1", label: "Allow once", kind: "once" }, { id: "o2", label: "Always allow this", kind: "always_rule" }, { id: "o3", label: "Deny", kind: "deny" }] }, 3),
    ev(sessionId, { type: "turn_completed", status: "completed", stopReason: "end_turn", finalText: last, usage: null, durationMs: 42000, head: null }, 4),
  ];
}
const app = (id: string, name: string, category: string, color: string, description: string, connected: boolean) => ({
  id, slug: id, name, category, color, mark: name[0], description, support: "ready", note: "", tools: ["read", "search", "create"],
  transport: { kind: "http", url: `https://mcp.example.com/${id}` }, auth: { kind: "oauth", label: null, hint: null, target: null, scopes: [] }, connected,
});
const APPS = [
  app("gmail", "Gmail", "Mail", "#ea4335", "Search, read and draft mail. It never sends on its own.", true),
  app("calendar", "Calendar", "Time", "#4285f4", "See what is coming and propose events.", true),
  app("github", "GitHub", "Code", "#8b949e", "Issues, pull requests and reviews.", true),
  app("notion", "Notion", "Docs", "#e6e6e6", "Read and write pages in your workspace.", false),
  app("slack", "Slack", "Chat", "#9b59b6", "Post and read in channels.", false),
  app("linear", "Linear", "Work", "#5e6ad2", "Issues and cycles.", false),
];
const plugin = (a: (typeof APPS)[number]) => ({
  id: a.id, kind: "catalog", slug: a.slug, name: a.name, description: a.description, category: a.category, transport: a.transport,
  auth: "oauth", tokenTarget: null, status: "connected", grants: ["a1", "a2", "a3"], connectedAt: NOW - 86400_000, account: "you@example.com",
  color: a.color, mark: a.mark, error: null,
  tools: [{ name: "read", description: "Read", policy: "allow" }, { name: "create", description: "Create", policy: "ask" }],
});
const WORKSPACES = [{ id: "w1", name: "Hyze Cloud", logo: null, order: 0, defaults: null }];
const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  agents_load: () => ROSTER,
  agents_sync: () => null,
  workspaces_list: () => WORKSPACES,
  plugins_list: () => ({
    plugins: APPS.filter((a) => a.connected).map(plugin),
    skills: [{ slug: "daily-post", name: "Daily post", by: "Mila", grants: ["a3"], md: "Write the daily post.", path: "/skills/daily-post" }],
    catalog: APPS.map(({ connected: _c, ...rest }) => rest),
    calls: [],
  }),
  routines_list: () => ({ routines: [], runs: [] }),
  list_models: () => [],
  get_me: () => ({ name: "Gabriel", calls: "Gabriel", language: "English", status: "available", avatar: { kind: "sun", color: "#6a8cf0" }, photo: null }),
  agent_availability: () => [
    { harness: "claude-acp", available: true, label: "Claude Code", reason: "" },
    { harness: "codex-acp", available: true, label: "Codex", reason: "" },
    { harness: "opencode", available: true, label: "OpenCode", reason: "" },
  ],
  analytics_identity: () => null,
  list_projects: () => [{ path: "/Users/you/hyze-cloud", name: "hyze-cloud" }],
  agent_glances: (a) =>
    (a.sessionIds as string[]).flatMap((id) => {
      const r = ROSTER.find((x) => x.sessionId === id);
      const l = r && LAST[r.id];
      return l ? [{ sessionId: id, line: l[0], atMs: NOW - l[1] * 60000 }] : [];
    }),
  agent_activity: () => ({
    messages: Array.from({ length: 40 }, (_, i) => NOW - i * 3600_000 * (1 + (i % 7))),
    tasks: [], feed: [], spend: [], calls: [], lastTotal: 120, open: null,
  }),
  agent_memory_list: () => [
    { name: "tone.md", size: 210, modifiedMs: NOW - 86400_000 },
    { name: "pricing.md", size: 340, modifiedMs: NOW - 3600_000 },
  ],
  agent_memory_read: (a) =>
    `---\nname: ${String(a.name).replace(".md", "")}\ndescription: Short and warm, no hype.\ntype: feedback\n---\nShort and warm, no hype.`,
  agent_memory_usage: () => ({}),
  list_sessions: () => ROSTER.map(item),
  list_session_index_items: () => ROSTER.map(item),
  get_session_by_id: (a) => {
    const r = ROSTER.find((x) => x.sessionId === a.sessionId);
    return r ? { ...item(r), events: events(String(a.sessionId)), hasOlder: false } : null;
  },
  list_channels: () => [],
  channels_list: () => [],
  inbox_list: () => ({ items: [], clearedToday: 0, rules: [] }),
  get_preferences: () => ({}),
  load_preferences: () => ({}),
};
// Each surface keeps its own fake data in src/devMock/<name>.ts: `export const handlers = {...}`, merged here.
const extra = import.meta.glob<{ handlers?: typeof handlers }>("./devMock/*.ts", { eager: true });
for (const m of Object.values(extra)) Object.assign(handlers, m.handlers ?? {});
export { ROSTER, NOW, LAST };
const listeners = new Map<number, string>();
let cb = 1;
export function installDevMock() {
  const w = window as unknown as Record<string, unknown>;
  if (w.__TAURI_INTERNALS__) return;
  try {
    if (!localStorage.getItem("hz.roster")) localStorage.setItem("hz.roster", JSON.stringify(ROSTER));
  } catch { /* storage blocked */ }
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: (f: unknown) => { const id = cb++; (w as Record<string, unknown>)[`_${id}`] = f; return id; },
    unregisterCallback: () => {},
    convertFileSrc: (p: string) => p,
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === "plugin:event|listen") { listeners.set(cb, String(args.event)); return cb++; }
      if (cmd.startsWith("plugin:")) return null;
      const h = handlers[cmd];
      if (h) return h(args);
      console.debug("[devMock] unhandled", cmd);
      return /^(inbox_viewing|check_update|set_|track_|write_)/.test(cmd) ? null : [];
    },
  };
}
