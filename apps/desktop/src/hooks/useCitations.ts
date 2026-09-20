import { useCallback, useSyncExternalStore } from "react";

/// A quotation on its way into the draft.
///
/// The composer writes it in as a blockquote at the caret and the entry goes —
/// see `insertQuote`. There is no comment field and no chip to hang one on: a
/// quotation is the words it is, and the sentence the reader writes under it is
/// what they have to say about it. Inventing a second place for that sentence
/// would put it somewhere the agent never reads.
export type Citation = {
  id: string;
  /// The quoted words, as selected. Whitespace collapsed and length capped by
  /// `quoteBlock`.
  quote: string;
};

/// What the selection toolbar has asked to cite, keyed by the composer it will
/// land in.
///
/// Module-level for the same reason `useAttachments` and `useDraft` are: the
/// toolbar lives in the transcript and the caret it has to be written at lives in
/// the composer, several components apart, with no shared parent holding state.
/// `null` is the new task's own key.
const bySession = new Map<string | null, Citation[]>();
const listeners = new Set<() => void>();

// One frozen array for every empty key — `useSyncExternalStore` re-renders on any
// snapshot that is not reference-equal to the last, so a fresh `[]` would loop.
const EMPTY: Citation[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(sessionId: string | null, next: Citation[]) {
  if (next.length) bySession.set(sessionId, next);
  else bySession.delete(sessionId);
  emit();
}

/// Queues a quotation for the composer to write in, and answers its id.
///
/// The same words twice is two quotations: the reader selected twice, and the
/// second selection may well be going to a different instruction than the first.
export function addCitation(sessionId: string | null, quote: string): string | null {
  const trimmed = quote.trim();
  if (!trimmed) return null;

  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const current = bySession.get(sessionId) ?? EMPTY;
  write(sessionId, [...current, { id, quote: trimmed }]);
  return id;
}

/// Empties the queue — called by the composer the moment it has written them in,
/// and at send. Left standing, they would be written into the next draft too.
export function clearCitations(sessionId: string | null) {
  if (bySession.has(sessionId)) write(sessionId, EMPTY);
}

/// The quotations waiting to be written in. Read-only, like `useAttachments`:
/// every mutation is a module function above.
export function useCitations(sessionId: string | null): Citation[] {
  const getSnapshot = useCallback(() => bySession.get(sessionId) ?? EMPTY, [sessionId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
