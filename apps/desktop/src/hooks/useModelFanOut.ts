import { useCallback, useSyncExternalStore } from "react";

import { toggleFanOut } from "@/lib/fanOut";
import type { ModelId } from "@/types/events";

/// The models a send will fan out to, keyed by the composer they were picked in.
///
/// Module-level for the reason `useAttachments` and `useDraft` are: the picker
/// that writes this lives in `ComposerToolbar` and the send that reads it lives
/// in `useSessions`, several components apart, and `ComposerToolbar` reaches
/// `ChatInput` as an opaque node.
///
/// Empty is the ordinary case — a single model, sent the way it always was.
const bySession = new Map<string | null, ModelId[]>();
const listeners = new Set<() => void>();
const EMPTY: ModelId[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(sessionId: string | null, next: ModelId[]) {
  if (next.length) bySession.set(sessionId, next);
  else bySession.delete(sessionId);
  emit();
}

/// Adds or removes one model, in the order they were picked.
export function toggleFanOutModel(sessionId: string | null, modelId: ModelId) {
  write(sessionId, toggleFanOut(bySession.get(sessionId) ?? EMPTY, modelId));
}

export function clearFanOut(sessionId: string | null) {
  if (bySession.has(sessionId)) write(sessionId, EMPTY);
}

export function fanOutModels(sessionId: string | null): ModelId[] {
  return bySession.get(sessionId) ?? EMPTY;
}

export function useFanOutModels(sessionId: string | null): ModelId[] {
  const getSnapshot = useCallback(() => bySession.get(sessionId) ?? EMPTY, [sessionId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
