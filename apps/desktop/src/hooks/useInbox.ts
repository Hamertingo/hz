import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

import type { InboxSnapshot, TrailStep } from "@/types/events";

/// The agents' inbox, as the backend keeps it in `inbox.json`. One store for the
/// page and for the sidebar's badge, so the number and the list cannot disagree.
const EMPTY: InboxSnapshot = { items: [], clearedToday: 0, rules: [] };

let snapshot: InboxSnapshot = EMPTY;
/// Whether the first read has answered, so the page can tell "empty" from "not
/// read yet" and draw a skeleton for the second.
let loaded = false;
let started = false;
const listeners = new Set<() => void>();

function set(next: InboxSnapshot) {
  snapshot = next;
  loaded = true;
  for (const l of listeners) l();
}

function start() {
  if (started) return;
  started = true;
  invoke<InboxSnapshot>("inbox_list").then(set).catch((e) => {
    started = false;
    console.error("[inbox]", e);
  });
  // The backend pushes the whole list on every change, so a decision made in a
  // chat card, a new request and an expiry all arrive the same way.
  void listen<InboxSnapshot>("inbox_changed", (e) => set(e.payload));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

export function useInbox(): InboxSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/// Whether the inbox has been read at least once.
export function useInboxLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loaded);
}

/// Settles an item. Rejects with the backend's sentence when the agent is no
/// longer waiting, so the page can say so instead of pretending it was sent.
export async function resolveInboxItem(id: string, verdict: string, extra?: string): Promise<InboxSnapshot> {
  const next = await invoke<InboxSnapshot>("inbox_resolve", { id, verdict, extra: extra ?? null });
  set(next);
  return next;
}

export async function undoInboxItem(id: string) {
  set(await invoke<InboxSnapshot>("inbox_undo", { id }));
}

export async function archiveInboxItem(id: string, archived: boolean) {
  set(await invoke<InboxSnapshot>("inbox_archive", { id, archived }));
}

/// How many mentions were open and are now read.
export function markMentionsRead(): Promise<number> {
  return invoke<number>("inbox_mark_mentions_read");
}

export function inboxTrail(id: string): Promise<TrailStep[]> {
  return invoke<TrailStep[]>("inbox_trail", { id });
}

/// Which chat is on screen, so a turn that ends there is not filed as news.
export function reportViewing(sessionId: string | null) {
  invoke("inbox_viewing", { sessionId }).catch(() => {});
}
