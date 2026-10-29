/// Where the app opens, and where it goes when what the reader was looking at is
/// gone. The blank "new session" composer is not a place anyone lands.

export type ViewKind = "agent" | "channel" | "page";

/// One place in the main column: an agent's chat, a channel, or a page by name.
export type ViewTarget = { kind: ViewKind; id: string };

/// What `settings.json` holds under `lastView`.
///
/// The top-level triple is the last place seen anywhere; `byWorkspace` is the
/// last place seen in each workspace, so switching back restores that one.
export type LastView = {
  workspaceId: string | null;
  kind: ViewKind;
  id: string;
  byWorkspace: Record<string, ViewTarget>;
};

/// The pages worth coming back to. Search and profile are transient, and a
/// channel or an agent is named by its own id instead.
export const RESTORABLE_PAGES = ["inbox", "prs", "plugins", "routines"] as const;

const KINDS: readonly string[] = ["agent", "channel", "page"];

function asTarget(raw: unknown): ViewTarget | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { kind, id } = raw as Record<string, unknown>;
  if (typeof kind !== "string" || !KINDS.includes(kind) || typeof id !== "string" || !id) return null;
  return { kind: kind as ViewKind, id };
}

/// Tolerant of a hand edit or an older shape: anything unreadable is "nothing
/// stored", which lands on the fallback rather than failing the launch.
export function readLastView(raw: unknown): LastView | null {
  const top = asTarget(raw);
  if (!top) return null;
  const r = raw as Record<string, unknown>;
  const byWorkspace: Record<string, ViewTarget> = {};
  if (typeof r.byWorkspace === "object" && r.byWorkspace !== null) {
    for (const [ws, value] of Object.entries(r.byWorkspace)) {
      const t = asTarget(value);
      if (t) byWorkspace[ws] = t;
    }
  }
  return {
    workspaceId: typeof r.workspaceId === "string" ? r.workspaceId : null,
    ...top,
    byWorkspace,
  };
}

const same = (a: ViewTarget | undefined | null, b: ViewTarget) => a?.kind === b.kind && a.id === b.id;

/// `prev` with `target` recorded for `workspaceId`; the same object when nothing
/// would change, so the caller can skip the write.
export function withView(prev: LastView | null, workspaceId: string, target: ViewTarget): LastView {
  if (prev && prev.workspaceId === workspaceId && same(prev, target) && same(prev.byWorkspace[workspaceId], target)) {
    return prev;
  }
  return {
    workspaceId,
    kind: target.kind,
    id: target.id,
    byWorkspace: { ...(prev?.byWorkspace ?? {}), [workspaceId]: target },
  };
}

/// What was stored for a workspace, or null.
export function storedFor(last: LastView | null, workspaceId: string): ViewTarget | null {
  if (!last) return null;
  const own = last.byWorkspace[workspaceId];
  if (own) return own;
  return last.workspaceId === workspaceId ? { kind: last.kind, id: last.id } : null;
}

export type LandingAgent = { id: string; modified: number | null };

/// Where to land: the stored target if it still exists, else the agent that spoke
/// last, else the first agent, else the first channel. Null means the workspace
/// holds nothing, which is the empty state's cue and not a reason to open a blank
/// composer.
export function resolveLanding(input: {
  stored: ViewTarget | null;
  agents: readonly LandingAgent[];
  channelIds: readonly string[];
}): ViewTarget | null {
  const { stored, agents, channelIds } = input;

  if (stored?.kind === "agent" && agents.some((a) => a.id === stored.id)) return stored;
  if (stored?.kind === "channel" && channelIds.includes(stored.id)) return stored;
  if (stored?.kind === "page" && (RESTORABLE_PAGES as readonly string[]).includes(stored.id)) return stored;

  if (agents.length > 0) {
    let best = agents[0];
    for (const a of agents) if ((a.modified ?? -1) > (best.modified ?? -1)) best = a;
    return { kind: "agent", id: best.id };
  }
  if (channelIds.length > 0) return { kind: "channel", id: channelIds[0] };
  return null;
}
