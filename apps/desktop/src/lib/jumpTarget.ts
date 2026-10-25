import { useEffect, useRef } from "react";

/// Where Jump to sent the reader inside a page that was not open yet.
///
/// A page keeps its own selection (the Inbox's open item, the routine in the
/// editor), and it may not be mounted when the palette picks a row: the page is
/// lazy and the click is what opens it. So the row leaves the target here, the
/// page takes it on mount, and one already open takes it when told.
export type JumpTarget =
  | { kind: "inbox"; id: string }
  | { kind: "memory"; agentId: string; note: string }
  /// `id: null` is a new routine.
  | { kind: "routine"; id: string | null }
  | { kind: "plugin"; id: string }
  | { kind: "catalog" };

const EVENT = "hz:jump-target";
let pending: JumpTarget | null = null;

/// Leaves a target for the page about to open, and tells one that is open.
export function setJumpTarget(target: JumpTarget): void {
  pending = target;
  window.dispatchEvent(new Event(EVENT));
}

/// Takes the target if it is for `kind`, leaving it for its owner otherwise.
export function takeJumpTarget<K extends JumpTarget["kind"]>(
  kind: K,
): Extract<JumpTarget, { kind: K }> | null {
  if (pending?.kind !== kind) return null;
  const hit = pending as Extract<JumpTarget, { kind: K }>;
  pending = null;
  return hit;
}

/// Runs `on` with a target for `kind`: now if one is waiting, and again whenever
/// Jump to leaves another.
export function useJumpTarget<K extends JumpTarget["kind"]>(
  kind: K,
  on: (target: Extract<JumpTarget, { kind: K }>) => void,
): void {
  const latest = useRef(on);
  latest.current = on;
  useEffect(() => {
    const run = () => {
      const hit = takeJumpTarget(kind);
      if (hit) latest.current(hit);
    };
    run();
    window.addEventListener(EVENT, run);
    return () => window.removeEventListener(EVENT, run);
  }, [kind]);
}
