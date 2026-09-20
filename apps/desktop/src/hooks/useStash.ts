import { useCallback, useSyncExternalStore } from "react";

import type { Attachment } from "@/types/events";

/// A draft put aside for later: the text plus whatever was pinned to it.
export type StashedDraft = { text: string; attachments: Attachment[] };

/// Drafts the reader put aside, keyed by the composer they were written in.
///
/// Keyed exactly like `useDraft` and `useAttachments`, and for the same reason:
/// `AppShell` moves the footer between the empty state and a session, so moving
/// between them unmounts `ChatInput` — anything held in component state would be
/// gone on the switch that most needs it.
///
/// **In memory only.** A stash that outlived the app would have to survive
/// attachment paths that may not, and unlike t3code — whose stash lives on a
/// server that outlives every client — there is nothing here to keep it in that
/// has a longer life than the drafts it came from.
const bySession = new Map<string | null, StashedDraft[]>();
const listeners = new Set<() => void>();

// One frozen array for every empty key, for `useSyncExternalStore`'s reason: a
// fresh `[]` per read is a new snapshot and loops the render.
const EMPTY: StashedDraft[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(sessionId: string | null, next: StashedDraft[]) {
  if (next.length) bySession.set(sessionId, next);
  else bySession.delete(sessionId);
  emit();
}

/// Puts the current draft aside. Answers whether there was anything to put
/// aside, so the caller can say so rather than looking like it did nothing.
export function stashDraft(sessionId: string | null, draft: StashedDraft): boolean {
  if (!draft.text.trim() && !draft.attachments.length) return false;

  const current = bySession.get(sessionId) ?? EMPTY;
  write(sessionId, [...current, draft]);
  return true;
}

/// Takes the newest one back out, or `null` when there is nothing stashed.
///
/// Newest first, and one at a time: the badge counts them, and a menu of twelve
/// stashed drafts is a second inbox to triage.
export function popStash(sessionId: string | null): StashedDraft | null {
  const current = bySession.get(sessionId) ?? EMPTY;
  const last = current.at(-1);
  if (!last) return null;

  write(sessionId, current.slice(0, -1));
  return last;
}

/// Drops everything stashed for one composer. Called when its session is
/// deleted, so a stash cannot outlive the session it was written against — the
/// attachments it names are deleted with the session.
export function clearStash(sessionId: string | null) {
  if (bySession.has(sessionId)) write(sessionId, EMPTY);
}

export function useStashCount(sessionId: string | null): number {
  const getSnapshot = useCallback(() => bySession.get(sessionId)?.length ?? 0, [sessionId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
