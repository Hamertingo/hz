/// The mockup's six routines (design/simple/core.js), so the page can be compared with it row for row.
const NOW = Date.now();
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const routine = (id: string, agentId: string, name: string, days: number[], time: string, act: string, on: boolean) => {
  const next = new Date(NOW);
  const [hh, mm] = time.split(":").map(Number);
  next.setHours(hh, mm, 0, 0);
  if (next.getTime() < NOW) next.setDate(next.getDate() + 1);
  return {
    id, name, agentId, trigger: { kind: "schedule", days, time, tz: "local" }, act, prompt: act, to: "agent_chat", quiet: false, on,
    nextRunAt: on ? iso(next.getTime()) : null, skipped: [], runs: [], secret: null, createdAt: iso(NOW - 20 * DAY), deletedAt: null,
    projectPath: null, model: null, legacyEveryMinutes: null,
  };
};

const ROUTINES = [
  routine("r1", "a3", "Daily Hyze content (IG + TikTok)", [0, 1, 2, 3, 4, 5, 6], "10:00", "post the daily content", true),
  routine("r2", "a3", "Check email tracking and build the trial funnel", [0, 1, 2, 3, 4, 5, 6], "11:00", "check email tracking and build the trial funnel", true),
  routine("r3", "a1", "Pricing review", [0], "09:00", "review pricing and write the summary", true),
  routine("r4", "a6", "Pool capacity report", [4], "08:30", "report pool capacity", true),
  routine("r5", "a7", "Weekly CVE scan", [1], "07:00", "scan the base image for CVEs", false),
  routine("r6", "a2", "Nightly test run", [0, 1, 2, 3, 4, 5, 6], "02:00", "run the full test suite", true),
];

export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  routines_list: () => ({ routines: ROUTINES, running: [] }),
};
