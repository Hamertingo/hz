// Fake data for Settings pages that read from the backend: transcription, plan limits, spend, CLIs, keys.
const NOW = Date.now();
const H = 3600_000;
const LIMITS: Record<string, unknown> = {
  "claude-acp": { harness: "claude-acp", installed: true, plan: "Max", source: "cli", note: null, readAtMs: NOW, windows: [
    { key: "5h", label: "5-hour window", usedPct: 62, resetsAtMs: NOW + 2.2 * H, estimated: false },
    { key: "week", label: "Weekly", usedPct: 31, resetsAtMs: NOW + 70 * H, estimated: false }] },
  "codex-acp": { harness: "codex-acp", installed: true, plan: "Plus", source: "cli", note: null, readAtMs: NOW, windows: [
    { key: "5h", label: "5-hour window", usedPct: 18, resetsAtMs: NOW + 3.7 * H, estimated: false },
    { key: "week", label: "Weekly", usedPct: 44, resetsAtMs: NOW + 96 * H, estimated: false }] },
  opencode: { harness: "opencode", installed: true, plan: null, source: "cli", note: null, readAtMs: NOW, windows: [
    { key: "month", label: "Monthly credits", usedPct: 72, resetsAtMs: NOW + 240 * H, estimated: true }] },
};
const CLI = (harness: string, name: string, version: string, latest: string | null, account: string | null) => ({
  harness, name, installed: true, version, path: `/usr/local/bin/${harness}`, account, signedIn: !!account, via: "login",
  adapterReady: true, latest, updateCommand: latest ? `npm i -g ${harness}` : null,
});
const CLIS: Record<string, unknown> = {
  "claude-acp": CLI("claude-acp", "Claude Code", "2.1.4", "2.1.6", "you@example.com"),
  "codex-acp": CLI("codex-acp", "Codex", "0.46.0", null, "you@example.com"),
  opencode: CLI("opencode", "OpenCode", "1.4.2", null, null),
};

const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86400_000;
const at = (daysAgo: number, h: number, m = 0) => {
  const d = new Date(NOW - daysAgo * DAY);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const run = (daysAgo: number, h: number, status: "success" | "fail" = "success") => ({
  at: iso(at(daysAgo, h)), status, durationMs: 41_000, cost: 0.08,
  outputExcerpt: status === "success" ? "Done. Posted it to the channel." : "", error: status === "fail" ? "The agent hit its limit." : null,
  via: "schedule", delivery: null,
});
const routine = (id: string, name: string, agentId: string, days: number[], time: string, act: string, to: string, on: boolean, runs: ReturnType<typeof run>[]) => {
  const next = new Date(NOW);
  const [hh, mm] = time.split(":").map(Number);
  next.setHours(hh, mm, 0, 0);
  if (next.getTime() < NOW) next.setDate(next.getDate() + 1);
  return {
    id, name, agentId, trigger: { kind: "schedule", days, time, tz: "UTC" }, act, prompt: act, to, quiet: false, on,
    nextRunAt: on ? iso(next.getTime()) : null, skipped: [], runs, secret: null, createdAt: iso(NOW - 20 * DAY), deletedAt: null,
  };
};
const ROUTINES = [
  routine("r1", "Daily content", "a3", [0, 1, 2, 3, 4, 5, 6], "10:00", "posts the daily content", "agent_chat", true, [run(2, 10), run(1, 10), run(0, 10)]),
  routine("r2", "Pool check", "a6", [0, 1, 2, 3, 4], "09:00", "checks the Firecracker pool", "inbox", true, [run(2, 9), run(1, 9, "fail")]),
  routine("r3", "Weekly pricing review", "a4", [0], "09:00", "pulls the pricing numbers", "agent_chat", true, [run(3, 9)]),
  routine("r4", "Draft the newsletter", "a5", [4], "16:00", "drafts the newsletter", "agent_chat", false, []),
];

const pr = (number: number, title: string, state: string, author: string, branch: string, add: number, del: number, checks: "RUNNING" | "FAILING" | "CLEAR", decision: string | null, requests: string[], ago: number) => ({
  number, title, url: `https://github.com/hyze/site/pull/${number}`, state, isDraft: false, author, avatar: null, headRefName: branch, baseRefName: "main",
  updatedAt: iso(NOW - ago * H), createdAt: iso(NOW - ago * H), additions: add, deletions: del, changedFiles: 3 + (number % 5),
  reviewDecision: decision, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", checksState: checks, reviewRequests: requests, labels: [],
});
const PRS = [
  pr(311, "Pricing page: Pro plan copy", "OPEN", "mila", "mila/pricing-copy", 44, 12, "CLEAR", null, [], 3),
  pr(479, "Fix webhook retry backoff", "OPEN", "ada", "ada/webhook-backoff", 21, 9, "FAILING", null, [], 9),
  pr(58, "Blog: Sandbox VMs explained", "OPEN", "leo", "leo/sandbox-post", 210, 0, "CLEAR", null, [], 26),
  pr(482, "Add usage-based billing endpoint", "OPEN", "ada", "ada/billing", 312, 41, "RUNNING", "REVIEW_REQUIRED", ["you"], 5),
  pr(96, "Pool autoscaler: scale on queue depth", "OPEN", "vex", "vex/autoscale", 128, 30, "CLEAR", "APPROVED", [], 12),
  pr(92, "Bump base image to 24.04.2", "MERGED", "nox", "nox/base-image", 6, 6, "CLEAR", "APPROVED", [], 30),
  pr(305, "UTM on outbound links", "MERGED", "mila", "mila/utm", 57, 8, "CLEAR", "APPROVED", [], 50),
];

export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  transcription_status: () => ({
    models: [
      { id: "small", name: "Small", description: "Fast, good for short dictation.", repo: "x", revision: "x", filename: "small.bin", sizeBytes: 480_000_000, sha256: "x", languages: "99 languages", speed: 80, accuracy: 60 },
      { id: "large", name: "Large", description: "Slower and more accurate.", repo: "x", revision: "x", filename: "large.bin", sizeBytes: 1_600_000_000, sha256: "x", languages: "99 languages", speed: 35, accuracy: 92 },
    ],
    installed: ["small"], selectedModel: "small", recommended: "small",
    devices: [{ name: "MacBook Pro Microphone", isDefault: true }, { name: "AirPods Pro", isDefault: false }],
    selectedDevice: null, muteWhileRecording: false, ready: true,
  }),
  get_settings: () => ({ analyticsEnabled: true, analyticsLocked: false }),
  plan_limits: (a) => [LIMITS[String(a.harness)]],
  usage_spend: () => ({
    month: "2026-10", totalUsd: 38.4,
    agents: [
      { agentId: "a3", name: "Mila", harness: "claude-acp", usd: 14.2, calls: 210, inputTokens: 3_100_000, outputTokens: 420_000 },
      { agentId: "a2", name: "Ada", harness: "claude-acp", usd: 11.8, calls: 164, inputTokens: 2_400_000, outputTokens: 310_000 },
      { agentId: "a4", name: "Hugo", harness: "codex-acp", usd: 7.5, calls: 96, inputTokens: 1_800_000, outputTokens: 96_000 },
      { agentId: "a1", name: "Atlas", harness: "claude-acp", usd: 4.9, calls: 58, inputTokens: 900_000, outputTokens: 61_000 },
    ],
  }),
  cli_info: (a) => CLIS[String(a.harness)],
  cli_check_updates: () => Object.values(CLIS),
  source_control_state: () => ({ git: "2.45.1", gh: { tokenSource: "keyring", host: "github.com", login: "you", scopes: ["repo", "read:org"], error: null } }),
  kit_payments_get: () => ({ limits: { enabled: false, per_purchase_cents: 2500, per_month_cents: 5000, agents: [] } }),
  kit_e2e_status: () => true,
  kit_app_keys: () => [{ id: "k1", label: "Raycast", created: Math.floor((NOW - 9 * 86400_000) / 1000), last_used: Math.floor((NOW - 2 * H) / 1000) }],
  kit_accounts: () => [],
  routines_list: () => ({ routines: ROUTINES, running: [] }),
  routine_hook_info: () => ({ port: 4717, base: "http://127.0.0.1:4717" }),
  list_pull_requests: (a) => ({ items: String(a.state) === "open" ? PRS.filter((x) => x.state === "OPEN") : PRS, viewer: "you" }),
  kit_engine_updates: () => [],
};
