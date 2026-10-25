import { useSyncExternalStore } from "react";

import type { ReplyTo } from "@/types/events";

/// The message the composer is answering, per session. Not persisted: it is a
/// half-made send, and the sent message carries the target from then on.
export type ReplyDraft = ReplyTo & {
  /// Who is quoted, as the bar names them. `agent` is the id.
  name: string;
};

let drafts: Record<string, ReplyDraft> = {};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function startReply(sessionId: string, draft: ReplyDraft) {
  drafts = { ...drafts, [sessionId]: draft };
  emit();
}

export function cancelReply(sessionId: string | null) {
  if (!sessionId || !drafts[sessionId]) return;
  const { [sessionId]: _, ...rest } = drafts;
  drafts = rest;
  emit();
}

/// The target to send with the next prompt, taken off the draft. The caller
/// clears it once the send has gone.
export function replyFor(sessionId: string | null): ReplyDraft | null {
  return sessionId ? (drafts[sessionId] ?? null) : null;
}

export function useReplyDraft(sessionId: string | null): ReplyDraft | null {
  return useSyncExternalStore(subscribe, () => (sessionId ? (drafts[sessionId] ?? null) : null));
}
