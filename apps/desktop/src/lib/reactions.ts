import { useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";

/// The reader's reactions to messages, by `<session>:<event>`. Local to this
/// machine and to the reader — an agent is not told, the way a reaction in a team
/// chat is for the people in it, not a prompt.
const KEY = "hz.reactions";

/// The emoji offered under a message, most used first.
export const QUICK_REACTIONS = ["👍", "❤️", "🎉", "😂", "👀", "✅"] as const;

let state: Record<string, string[]> = readLocalStorage<Record<string, string[]>>(KEY, {});
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/// `list` with `emoji` added, or taken off if it was there: a second press undoes.
export function toggled(list: string[], emoji: string): string[] {
  return list.includes(emoji) ? list.filter((e) => e !== emoji) : [...list, emoji];
}

export function toggleReaction(key: string, emoji: string) {
  const next = toggled(state[key] ?? [], emoji);
  const { [key]: _, ...rest } = state;
  state = next.length > 0 ? { ...rest, [key]: next } : rest;
  writeLocalStorage(KEY, state);
  for (const listener of listeners) listener();
}

const NONE: string[] = [];

export function useReactions(key: string | undefined): string[] {
  return useSyncExternalStore(subscribe, () => (key ? (state[key] ?? NONE) : NONE));
}
