import { useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";

/// What the reader has done to the *view* of a chat, kept beside it and never in
/// the log: messages deleted from sight, and the pages a Clear started.
///
/// Neither touches the conversation. The agent still has every message, and the
/// transcript on disk is whole — a tombstone hides a row, a boundary folds what
/// is above it. That is the point: "Clear chat" must not cost the agent its
/// memory, and a deleted message must come back with Undo.

const HIDDEN_KEY = "hz.chat.hidden";
const PAGES_KEY = "hz.chat.pages";

/// A line drawn across the chat where the reader cleared it: everything with a
/// `seq` below it is the previous page.
export type Boundary = { seq: number; ts: string };

/// `list` with `key` hidden. Idempotent, so a double click is one tombstone.
export function withHidden(list: readonly string[], key: string): string[] {
  return list.includes(key) ? [...list] : [...list, key];
}

/// `list` with `key` shown again.
export function withoutHidden(list: readonly string[], key: string): string[] {
  return list.filter((k) => k !== key);
}

/// `list` with a boundary at `at`, kept in order and one per `seq`.
export function withBoundary(list: readonly Boundary[], at: Boundary): Boundary[] {
  if (list.some((b) => b.seq === at.seq)) return [...list];
  return [...list, at].sort((a, b) => a.seq - b.seq);
}

/// The newest page break, or `null` for a chat never cleared.
export function lastBoundary(list: readonly Boundary[]): Boundary | null {
  return list.length === 0 ? null : list[list.length - 1];
}

/// Whether a message at `seq` belongs to a page the reader has put behind them.
/// `showEarlier` is the "Show earlier" toggle and lifts the fold.
export function isFolded(seq: number, list: readonly Boundary[], showEarlier: boolean): boolean {
  if (showEarlier) return false;
  const last = lastBoundary(list);
  return last !== null && seq < last.seq;
}

/// The key a message is hidden and reacted to by.
export function messageKey(sessionId: string, eventId: string): string {
  return `${sessionId}:${eventId}`;
}

type Hidden = Record<string, string[]>;
type Pages = Record<string, Boundary[]>;

let hidden: Hidden = readLocalStorage<Hidden>(HIDDEN_KEY, {});
let pages: Pages = readLocalStorage<Pages>(PAGES_KEY, {});
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function hideMessage(sessionId: string, key: string) {
  hidden = { ...hidden, [sessionId]: withHidden(hidden[sessionId] ?? [], key) };
  writeLocalStorage(HIDDEN_KEY, hidden);
  emit();
}

export function restoreMessage(sessionId: string, key: string) {
  hidden = { ...hidden, [sessionId]: withoutHidden(hidden[sessionId] ?? [], key) };
  writeLocalStorage(HIDDEN_KEY, hidden);
  emit();
}

export function clearPage(sessionId: string, at: Boundary) {
  pages = { ...pages, [sessionId]: withBoundary(pages[sessionId] ?? [], at) };
  writeLocalStorage(PAGES_KEY, pages);
  emit();
}

const NO_KEYS: string[] = [];
const NO_PAGES: Boundary[] = [];

export function useHiddenMessages(sessionId: string | null): readonly string[] {
  return useSyncExternalStore(subscribe, () => (sessionId ? (hidden[sessionId] ?? NO_KEYS) : NO_KEYS));
}

export function useBoundaries(sessionId: string | null): readonly Boundary[] {
  return useSyncExternalStore(subscribe, () => (sessionId ? (pages[sessionId] ?? NO_PAGES) : NO_PAGES));
}
