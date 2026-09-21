import type { AgentEvent, DelegatedMember, ToolResult } from "@/types/events";

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

/// Whether a session's subagent rows are folded away in the sidebar.
///
/// **The reader's own pick wins; failing that the group follows the work.** Open
/// while anything is still running, folded once none is — so a fan-out is
/// watchable the whole time it is happening, and six finished runs stop being six
/// rows of history in a list that is a worklist. What they leave behind is not
/// lost: the spawning call is in the transcript, and its `SubagentRow` opens the
/// same view the sidebar row did.
export function foldSubagents(
  pick: boolean | undefined,
  members: readonly DelegatedMember[],
): boolean {
  return pick ?? !members.some(isActive);
}

/// What a roster member is called, wherever one is drawn.
///
/// The task first: that is the brief somebody wrote, and the thing two runs of
/// the same agent are told apart by. The agent's own name second, and
/// "Subagent" as the floor — a row still needs something to read and click on.
export function memberTitle(member: DelegatedMember): string {
  return member.task?.trim() || member.agentName?.trim() || "Subagent";
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

/// The child Session a run's own result names, where it names one.
///
/// **The `task` tool reports the id in its structured result** (`sub_session_id`),
/// and that id is the very thing the roster is keyed by — so the join stops being
/// a guess the moment the call answers. It arrives at completion for a foreground
/// child and at the start for a background one; `memberFor`'s best-effort match
/// stands in until then.
export function subSessionIdOf(result: ToolResult | undefined): string | null {
  const details = result?.structured;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const id = (details as Record<string, unknown>).sub_session_id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

/// The roster row a run *is*, exactly where the run's own result says.
///
/// Two ways in, in order of trust: the child's session id off the call's result
/// when the roster still holds it, and the label-and-title guess otherwise. The
/// second is only ever reached while a foreground child is still working — which
/// is exactly the window a reader is watching it in — so the guess matters, and it
/// fails toward drawing nothing rather than toward drawing somebody else's work.
export function memberIdOf(
  run: { id: string; label: string | null; description: string | null },
  members: readonly DelegatedMember[],
  result: ToolResult | undefined,
): string | null {
  const exact = subSessionIdOf(result);
  if (exact !== null && members.some((member) => member.sessionId === exact)) return exact;
  return memberFor(run, members)?.sessionId ?? null;
}

/// The brief a spawning call carried, where the harness states one.
///
/// **Read off the call alone, and that is the whole of what is available.** A
/// roster is live-only, so a transcript replayed after a restart holds runs whose
/// children are gone — the call is then the only account of what the subagent was
/// asked to do, and drawing a sentence is better than drawing an empty box.
///
/// mcode's `task` puts it at the top level as `prompt`. The nested shapes other
/// harnesses use are deliberately not chased: guessing wrong puts somebody else's
/// paragraph under the reader's nose, where a miss costs a sentence and says so.
export function runBrief(run: { spawn: AgentEvent | null }): string | null {
  const payload = run.spawn?.payload;
  if (payload?.type !== "tool_call_started") return null;

  const prompt = (payload.input as Record<string, unknown> | null)?.prompt;
  return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : null;
}
