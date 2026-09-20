import type { DelegatedMember } from "@/types/events";

/// The statuses a member is still going in. The agent's own vocabulary — see
/// [`DelegatedMember::status`] — and the set that decides whether a Stop is worth
/// offering.
const ACTIVE: ReadonlySet<string> = new Set(["queued", "running", "stopping"]);

/// Whether a roster member is work the reader is still waiting on.
export function isActive(member: DelegatedMember): boolean {
  return ACTIVE.has(member.status);
}

/// How many of the roster are still going.
export function activeCount(members: readonly DelegatedMember[]): number {
  return members.filter(isActive).length;
}

/// The roster row that belongs to one run, where one can be told apart.
///
/// **Best effort, and it fails toward the transcript's own answer.** Nothing
/// joins a member to the tool call that started it: the run is keyed by the
/// call's id, and a member carries the agent's child-session id, which never
/// appears on the parent's stream. So this matches on the two facts both sides
/// state — the agent it runs as, and the short title it was given — and a run
/// nothing matches keeps the lifecycle the mapper already gave it. A row matched
/// by the wrong run costs a status word; a row that matched nothing costs
/// nothing, which is the direction a guess has to fail in.
export function memberFor(
  run: { label: string | null; description: string | null },
  members: readonly DelegatedMember[],
): DelegatedMember | null {
  const task = run.description?.trim() || null;
  const name = run.label?.trim() || null;
  if (!task && !name) return null;

  // The title first, because it is the specific one — a reader who delegated two
  // `explore` runs told them apart by exactly this.
  return (
    members.find((member) => task !== null && member.task?.trim() === task) ??
    members.find((member) => name !== null && member.agentName?.trim() === name) ??
    null
  );
}

/// A status word as the panel draws it.
///
/// The agent's strings are lowercase machine words; the panel is prose. An
/// unrecognised one is drawn as itself rather than hidden, so a status added
/// after this build reads as its own word.
export function statusWord(status: string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    default:
      return status || "Unknown";
  }
}
