// The left column's fake data: three channels, two folders, pins, unread marks and a few inbox rows,
// so the sidebar in a plain browser holds what the mockup's does.
import { DEFAULT_WORKSPACE_DEFAULTS } from "@/lib/workspace";
import { ROSTER } from "../devMock";

const NOW = Date.now();

const min = (n: number) => NOW - n * 60000;
const iso = (n: number) => new Date(min(n)).toISOString();

const sessionItem = (a: { sessionId: string; name: string; projectPath: string; modelId: string; pinned: boolean }, ago: number, status = "idle") => ({
  sessionId: a.sessionId, harness: "claude-acp", cwd: a.projectPath, projectPath: a.projectPath, branch: null, worktreeName: null,
  worktreeRemoved: false, title: a.name, model: a.modelId, effort: null, permissionMode: "auto", fast: false, status,
  forkFrom: null, threadId: null, parentSessionId: null, purpose: null, contextReading: null,
  created: iso(9000), modified: iso(ago), archived: false, pinned: a.pinned,
});

const GLANCE: Record<string, [string, number]> = {
  "s-a1": ["Pricing for the Pro plan is closed.", 20],
  "s-a2": ["Running pnpm test --filter api", 0],
  "s-a3": ["Can I publish the launch thread?", 40],
  "s-a4": ["3 sources on usage-based billing.", 120],
  "s-a5": ["Draft is in Drive: Sandbox VMs.", 1700],
  "s-a6": ["Firecracker pool is at 72%.", 50],
  "s-a7": ["No new CVEs in the base image.", 3000],
};

const sessions = () =>
  ROSTER.map((a) => sessionItem(a, GLANCE[a.sessionId]?.[1] ?? 60, a.sessionId === "s-a2" ? "in_progress" : "idle"));

const channel = (id: string, name: string, purpose: string, members: string[], lead: string, ago: number, rounds: number, unread: boolean) => ({
  id, workspaceId: "w1", name, purpose, members, lead, mode: "mention", rounds, muted: false, archived: false, created: min(9000),
  lastSeq: 9, lastTs: min(ago), lastAgentSeq: 9, readSeq: unread ? 7 : 9,
});
const CHANNELS = [
  channel("launch", "launch", "Mila: thread is ready for review", ["a1", "a3", "a5"], "a3", 35, 3, true),
  channel("infra-alerts", "infra-alerts", "Ada: pool alert cleared", ["a2", "a1"], "a2", 120, 2, false),
  channel("general", "general", "Atlas: Monday sync notes are in", ["a1", "a2", "a3", "a4", "a5"], "a1", 3200, 3, false),
];

const inboxItem = (id: string, kind: string, agentId: string, title: string, sub: string, payload: Record<string, unknown>, ago: number) => ({
  id, kind, agentId, title, sub, payload, why: null, created: min(ago), state: "open", resolution: null, ok: false, resolvedAt: null,
  sent: false, archived: false, sessionId: `s-${agentId}`, ref: id, channel: null,
});
const opt = (id: string, label: string, kind: string) => ({ id, label, kind });
const OPTS = [opt("o1", "Allow once", "once"), opt("o3", "Deny", "deny")];

// The window is translucent over native vibrancy, which a browser tab has none of: without a floor the light theme reads grey over the pane behind it.
const floor = document.createElement("style");
floor.textContent = "html{background:var(--background)}";
document.head.append(floor);

try {
  if (!localStorage.getItem("hz.sidebar")) {
    localStorage.setItem(
      "hz.sidebar",
      JSON.stringify({
        w1: {
          pins: ["a1", "#launch", "a2"],
          folders: [
            { id: "f1", name: "Launch week", ids: ["a3", "a5"] },
            { id: "f2", name: "Infra", ids: ["#infra-alerts", "a6", "a7"] },
          ],
          hidden: [], shut: [], order: ["a4", "#general", "a3", "a5", "#infra-alerts", "a6", "a7"], unread: ["a4"], seen: {},
        },
      }),
    );
  }
} catch { /* storage blocked */ }

const workspace = (id: string, name: string, color: string, order: number) => ({
  id, name, mark: name[0], color, logo: null, context: "", members: [], defaults: DEFAULT_WORKSPACE_DEFAULTS,
  agentOrder: [], channelOrder: [], sectionOrder: [], order,
});

export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  workspaces_list: () => [workspace("w1", "Hyze Cloud", "#6a8cf0", 0), workspace("w2", "HyzeVM", "#55b884", 1), workspace("w3", "Personal", "#e2a440", 2)],
  
  list_sessions: () => sessions(),
  list_session_index_items: () => sessions(),
  channels_list: () => CHANNELS,
  agent_glances: (a) =>
    (a.sessionIds as string[]).flatMap((id) => {
      const g = GLANCE[id];
      return g ? [{ sessionId: id, line: g[0], atMs: min(g[1]), ...(id === "s-a2" ? { doing: g[0] } : {}) }] : [];
    }),
  inbox_list: () => ({
    clearedToday: 0,
    rules: [],
    items: [
      inboxItem("i1", "approval", "a3", "Publish the launch thread on X?", "7 posts, scheduled for Oct 30 at 10:00. Needs your OK.", { form: "post", tool: "Post", command: null, path: null, posts: ["Pro is live."], input: {}, options: OPTS, always: null }, 12),
      inboxItem("i2", "approval", "a2", "Run pnpm db:migrate on staging?", "Adds the usage_events table. Reversible.", { form: "cmd", tool: "Bash", command: "pnpm db:migrate", path: null, posts: [], input: {}, options: OPTS, always: null }, 25),
      inboxItem("i3", "question", "a1", "Which annual price should the page show?", "Both beat the monthly plan on margin.", { question: "Which annual price should the page show?", choices: ["$290 / year", "$278 / year"], answer: null }, 40),
      inboxItem("i4", "mention", "a5", "Leo mentioned you in #launch", "@Gabriel can you check the blog title before I schedule it?", { text: "@Gabriel can you check the blog title before I schedule it?", place: "#launch" }, 60),
    ],
  }),
};
