/// Where the reader has been, so ⌘[ and ⌘] can walk back and forward through
/// the sessions they have opened.
///
/// A trail with a cursor rather than a stack pair, because "back, then open
/// something else" is the case that has to be right: opening truncates the
/// forward tail, which a cursor does by construction and a pair of stacks only
/// does if both are remembered to be cleared.
export type VisitHistory = { trail: readonly string[]; at: number };

export const EMPTY_VISITS: VisitHistory = { trail: [], at: -1 };

/// How much of the trail is kept. A session list is walked a few dozen deep at
/// most, and the trail is in memory for one run — this is only a bound on a
/// long day, not a feature.
const LIMIT = 50;

/// The session currently at the cursor, or null on an empty trail.
export function currentVisit(h: VisitHistory): string | null {
  return h.trail[h.at] ?? null;
}

/// Records arriving at `id`.
///
/// A move to the session already at the cursor is the same arrival seen twice —
/// a re-render, or a selection the app made for itself — and must not push, or
/// ⌘[ would walk back through duplicates of one visit. Arriving anywhere else
/// **truncates the forward tail**: the reader went somewhere new, and the branch
/// they left is not somewhere ⌘] can return to.
export function visit(h: VisitHistory, id: string): VisitHistory {
  if (currentVisit(h) === id) return h;
  const trail = [...h.trail.slice(0, h.at + 1), id].slice(-LIMIT);
  return { trail, at: trail.length - 1 };
}

/// Where ⌘[ / ⌘] lands, with the trail the step leaves behind — or null when
/// there is nothing that way.
///
/// Entries are checked against `alive` and **stepped over** rather than landed
/// on: a trail outlives the sessions in it, and a step onto a deleted one would
/// put the reader through the "Session not found" rollback on a key they pressed
/// to go somewhere.
export function step(
  h: VisitHistory,
  delta: number,
  alive: ReadonlySet<string>,
): { history: VisitHistory; to: string } | null {
  for (let i = h.at + delta; i >= 0 && i < h.trail.length; i += delta) {
    if (alive.has(h.trail[i])) return { history: { ...h, at: i }, to: h.trail[i] };
  }
  return null;
}

/// Drops the entries the index no longer holds, keeping the cursor on the same
/// session where it survived.
///
/// The same reference comes back when nothing is dead, which is the ordinary
/// case and what keeps this safe to run on every index change.
export function prune(h: VisitHistory, alive: ReadonlySet<string>): VisitHistory {
  if (h.trail.every((id) => alive.has(id))) return h;
  const here = currentVisit(h);
  const trail = h.trail.filter((id) => alive.has(id));
  const at = trail.indexOf(here ?? "");
  // A cursor whose own session was deleted goes to the newest entry that
  // survived, which is where the reader is about to be anyway.
  return { trail, at: at === -1 ? trail.length - 1 : at };
}
