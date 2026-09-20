import { useCallback, useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { bloubSkinFor, type AgentSkin, type BloubSkin } from "@/lib/bloubAgent";

/// Where the reader's picks live — one map, not a key per Agent.
///
/// **The webview's own store, and deliberately not `~/.hz/settings.json`.** A bot
/// is a picture the reader chose for their own screen; it is not a fact about the
/// Agent, and it is not something every build has to agree about. Same filing as
/// the diff style and the panel widths: the window's, not the reader's.
const KEY = "hz.agentSkins";

let skins: Record<string, AgentSkin> | null = null;
const listeners = new Set<() => void>();

function all(): Record<string, AgentSkin> {
  // Read lazily and kept: the map is small, and reading JSON out of storage on
  // every render of every avatar would be the one expensive thing here.
  skins ??= readLocalStorage<Record<string, AgentSkin>>(KEY, {});
  return skins;
}

function emit() {
  for (const listener of listeners) listener();
}

/// The skin the reader chose for an Agent, or `null` for one nobody has dressed.
///
/// Readable outside React, for the same reason every other store here is: the
/// avatar is drawn in places that have no hook of their own to spend on it.
export function agentSkinOf(name: string): AgentSkin | null {
  return all()[name] ?? null;
}

/// Dresses an Agent, or `null` to hand it back to the name.
export function setAgentSkin(name: string, skin: AgentSkin | null): void {
  if (!name) return;
  const next = { ...all() };
  if (skin) next[name] = skin;
  else delete next[name];
  skins = next;
  writeLocalStorage(KEY, next);
  emit();
}

/// Watches the picks, so every avatar redraws the moment one is made.
///
/// `useSyncExternalStore` rather than state: the picks are module-level, and a
/// per-component copy is what lets two rows disagree about the same Agent — the
/// bargain `useCodeTheme` makes.
export function useAgentSkin(name: string): AgentSkin | null {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // The entry itself is the snapshot, so it compares equal between renders: the
  // map is rebuilt by a write, and a write means a redraw anyway.
  return useSyncExternalStore(subscribe, () => agentSkinOf(name));
}

/// The bot an Agent wears, everything considered.
///
/// **One resolver, because three things decide it** — the reader's pick, the
/// Agent's own portrait marker, and its name — and a second copy of that order is
/// a second answer to the same question.
export function agentBloubFor(
  agent: { name: string; avatar?: string | null },
  marker: number | null,
): BloubSkin {
  return bloubSkinFor(agent.name, marker, agentSkinOf(agent.name));
}
