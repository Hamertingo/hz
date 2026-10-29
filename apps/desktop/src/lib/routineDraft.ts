import { useSyncExternalStore } from "react";

/// Words handed to the routine editor from the chat — a message's "Make it a
/// routine" or `/routine …` — held until the editor takes them. The routines page
/// is a placeholder until its phase lands; this is the seam it will read.
export type RoutineDraft = { text: string; agentId: string | null; at: number };

let draft: RoutineDraft | null = null;
const listeners = new Set<() => void>();

export function setRoutineDraft(next: RoutineDraft | null) {
  draft = next;
  for (const l of listeners) l();
}

/// Reads and clears the pending draft, for the editor when it opens.
export function takeRoutineDraft(): RoutineDraft | null {
  const taken = draft;
  if (taken) setRoutineDraft(null);
  return taken;
}

export function useRoutineDraft(): RoutineDraft | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => draft,
  );
}
