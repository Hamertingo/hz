import { isWaiting } from "@/lib/prList";
import type { PrListItem } from "@/types/events";

/// The three lanes of the pull requests board, in the order a reader works down.
export type PrLane = "you" | "work" | "ready";

/// Which lane an open pull request sits in.
///
/// **Who has the next move decides the lane, in this order.** A review asked of
/// the reader comes first, because nothing else moves until they answer. A draft,
/// a failing or running check, or a change request all mean the author still has
/// work to do. Only approved work with green checks and no conflict is ready.
/// Anything else (no review yet, say) is still waiting on others, so it sits with
/// the work and not in a lane of its own: the board has three lanes, not four.
export function prLane(item: PrListItem, viewer: string | null): PrLane {
  if (isWaiting(item, viewer) && !item.isDraft) return "you";
  if (item.isDraft) return "work";
  if (item.reviewDecision === "CHANGES_REQUESTED") return "work";
  if (item.checksState === "RUNNING" || item.checksState === "FAILING") return "work";
  if (
    item.reviewDecision === "APPROVED" &&
    item.checksState === "CLEAR" &&
    item.mergeable !== "CONFLICTING"
  ) {
    return "ready";
  }
  return "work";
}

/// One agent's branch, as the roster knows it: the agent, the repository its
/// session runs in, and the branch that session works on.
export type AgentBranch = { agentId: string; projectPath: string; branch: string };

/// The agent that opened a pull request, or `null` when none of ours did.
///
/// Matched on repository *and* branch: a branch name says nothing about which
/// checkout it belongs to, and two projects can each have a `feature` branch.
/// The PR body marker the design also names is not read here: the list carries
/// no body, and reading one per PR would cost a call per row.
export function attributeAgent(
  pr: { cwd: string; headRefName: string },
  agents: readonly AgentBranch[],
): string | null {
  return agents.find((a) => a.projectPath === pr.cwd && a.branch === pr.headRefName)?.agentId ?? null;
}

/// Open pull requests only, sorted into lanes. The board never draws merged or
/// closed rows, so a settled PR that is still listed does not count anywhere.
export function boardLanes<T extends PrListItem>(
  items: readonly T[],
  viewer: string | null,
): Record<PrLane, T[]> {
  const lanes: Record<PrLane, T[]> = { you: [], work: [], ready: [] };
  for (const item of items) {
    if (item.state !== "OPEN") continue;
    lanes[prLane(item, viewer)].push(item);
  }
  return lanes;
}
