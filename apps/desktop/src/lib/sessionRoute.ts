import type { SessionIndexItem } from "@/types/events";

/// A session that exists for an errand of the app's own (an agent's thread in a
/// channel) rather than as somebody's chat. It raises no toast, banner or unread
/// mark, and no page opens it: its answers live in the channel.
export function isHiddenSession(item: Pick<SessionIndexItem, "purpose"> | null | undefined): boolean {
  return item?.purpose != null;
}

export type SessionRoute =
  | { kind: "open" }
  | { kind: "blocked"; reason: string };

/// Whether a raw session may be opened as a page. Only an agent's own chat is a
/// page; a hidden thread, or a session no agent owns (`hz new`, an old routine
/// run), has no view in the agent UI, so every path that would reach one stops
/// here and says why. A session the index does not know yet passes through, so
/// a chat that was just created is never refused.
export function routeForSession(
  sessionId: string,
  index: Pick<SessionIndexItem, "sessionId" | "purpose">[],
  ownerSessionIds: ReadonlySet<string>,
  rosterReady: boolean,
): SessionRoute {
  const item = index.find((i) => i.sessionId === sessionId);
  if (!item) return { kind: "open" };
  if (isHiddenSession(item)) {
    return { kind: "blocked", reason: "That conversation belongs to a channel. Its answers are in the channel." };
  }
  if (rosterReady && !ownerSessionIds.has(sessionId)) {
    return { kind: "blocked", reason: "That session is not an agent's chat, so there is no page for it." };
  }
  return { kind: "open" };
}
