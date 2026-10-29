import { ROSTER } from "../devMock";

const LONG = Array.from({ length: 30 }, (_, i) => `${i + 1}. Keep answers short, say the risk last, and write what you learn to memory so the next run starts ahead.`).join("\n");

/// Gives Ada a 3000-character brief, so the Edit agent dialog is seen against the instructions it really meets.
export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  agents_load: () => ROSTER.map((a) => (a.id === "a2" ? { ...a, instructions: `You are Ada, the developer agent for Hyze Cloud.\n\n${LONG}` } : a)),
};
