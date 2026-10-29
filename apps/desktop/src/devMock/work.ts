// Fake data for kit_work.rs: the sidebar digest, a routine offer, the brain, the scripted first chat and run timings.
const NOW = Date.now();
const brains: Record<string, { mode: string | null; turboUntil: number | null; lastHeavyAt: number | null; strong: boolean }> = {
  a2: { mode: "rotate", turboUntil: null, lastHeavyAt: null, strong: false },
};
let offered = true;

const FOCUS = ["Inbox and calendar", "Research and reading", "Writing and content", "Code and projects"];
const step = (agentText: string, state: unknown, extra: Record<string, unknown> = {}) => ({ agentText, choices: [], effects: [], state, done: false, task: null, ...extra });

export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  kit_digests: (a) =>
    (a.sessionIds as string[]).includes("s-a4") ? [{ sessionId: "s-a4", seq: 9, line: "4 updates: Found 3 sources on pricing · Wrote the summary · Flagged one risk" }] : [],
  kit_routine_offer: (a) =>
    a.agentId === "a3" && offered
      ? { task: "daily post write", weekday: null, minuteOfDay: 600, prompt: "Can you write today's post and check the calendar?", line: 'You ask for "daily post write" around 10:00 often. Make it a routine?', atMs: NOW }
      : null,
  kit_routine_answer: (a) => {
    offered = false;
    return a.answer === "no" || a.answer === "dismiss" ? null : { id: "r-new" };
  },
  kit_brain_get: (a) => brains[String(a.agentId)] ?? { mode: null, turboUntil: null, lastHeavyAt: null, strong: false },
  kit_brain_set: (a) => {
    const id = String(a.agentId);
    const s = { ...(brains[id] ?? { mode: null, turboUntil: null, lastHeavyAt: null, strong: false }), mode: (a.mode as string | null) ?? null };
    if (a.turbo === true) s.turboUntil = Math.floor(Date.now() / 1000) + 3600;
    if (a.turbo === false) s.turboUntil = null;
    brains[id] = s;
    return s;
  },
  kit_onboarding_start: () => ({ ...step("Hi, I'm new here. Before we start, what should I focus on for you? Pick one, or just tell me in your own words.", "Hello"), choices: FOCUS }),
  kit_onboarding_next: (a) => {
    const st = a.state as string | Record<string, { focus: string; name?: string }>;
    const input = String(a.input).trim();
    if (st === "Hello") {
      return step(`Got it: ${input}. I'll work that way. What would you like to call me?`, { FocusPicked: { focus: input } }, {
        effects: [{ kind: "job", value: `Main focus: ${input}.` }, { kind: "label", value: input.slice(0, 24) }],
      });
    }
    if (typeof st === "object" && "FocusPicked" in st) {
      return step(`${input} it is. Where shall we start? Pick a first task or give me your own.`, { Named: { focus: st.FocusPicked.focus, name: input } }, {
        effects: [{ kind: "name", value: input }],
        choices: ["Read my project and explain how it fits together", "Find the next bug worth fixing", "Write tests for the part I trust least"],
      });
    }
    return step(`Starting now: ${input}.`, { Done: { task: input } }, { done: true, task: input });
  },
  kit_timings: (a) => [
    { session: a.sessionId, seq: 8, at: NOW, agent: null, model: "claude-sonnet-5-5", input: 52_000, output: 1_800,
      report: { turn_ms: 42_000, wake_ms: 0, screen_ms: 0, first_output_ms: 3_400, tool_ms: 12_600, model_ms: 29_400, tools: { Read: 80, Write: 120, Bash: 12_400 } } },
  ],
  kit_engine_updates: () => [{ engine: "codex", installed: "0.48.0", latest: "0.49.1" }],
};
