import type { Working } from "@/types/events";

/// The "answering" line after `from` posted: that agent is no longer being
/// waited on, whatever the backend's own `channel_working` says next. Leaves the
/// object alone when `from` was not on it, so a reader's message re-renders
/// nothing.
export function afterPost(working: Working, from: string): Working {
  if (!working.agents.includes(from)) return working;
  const agents = working.agents.filter((a) => a !== from);
  return agents.length === 0 ? { agents, round: 0 } : { ...working, agents };
}

/// Whether a note is the failure line the engine writes when an agent could not
/// answer, which is the one that offers Retry.
export function isFailureNote(text: string): boolean {
  return text.includes(" could not answer: ") || text.startsWith("The agents stopped unexpectedly");
}
