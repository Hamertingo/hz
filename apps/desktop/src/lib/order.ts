/// `items` in the saved `order`: ids the order names come first, in its order;
/// the rest keep the place they came in, after them. An id the order names that
/// is gone is skipped, and a new item lands at the end rather than vanishing.
export function applyOrder<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...items];
  const byId = new Map(items.map((i) => [i.id, i]));
  const named = order.flatMap((id) => {
    const item = byId.get(id);
    byId.delete(id);
    return item ? [item] : [];
  });
  return [...named, ...items.filter((i) => byId.has(i.id))];
}

/// `ids` with `id` taken out and put just before or after `target`. A drop on
/// itself, or on something not in the list, changes nothing.
export function moveRelative(ids: readonly string[], id: string, target: string, after: boolean): string[] {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return [...ids];
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/// `ids` with `id` one place up (-1) or down (1). Stops at either end.
export function moveBy(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/// `ids` with `id` first: what pinning an agent writes.
export function toFront(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)];
}

/// Whether a pointer at `y` is in the lower half of a row, i.e. a drop lands after it.
export function isAfter(y: number, top: number, height: number): boolean {
  return y - top > height / 2;
}

export type Section = "channels" | "agents";

/// A saved section order made safe: both sections exactly once, channels first
/// where the save is missing or wrong, so a section can never be lost.
export function readSections(saved: readonly string[]): Section[] {
  const ok = saved.length === 2 && saved.includes("channels") && saved.includes("agents");
  return ok ? (saved as Section[]) : ["channels", "agents"];
}
