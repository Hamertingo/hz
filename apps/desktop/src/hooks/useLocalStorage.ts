/// Which of the two preference stores answers, and why a key is in one of them.
///
/// **Durable preferences live in `~/.hz/settings.json`**: the composer's row, a
/// model's star, every rebinding, the editor a click opens, the update channel,
/// the spaces. Each is a fact about the reader rather than about the window, so
/// each has to be the same in a dev build and a released one, survive clearing
/// site data, and be readable by something that is not the webview. They are
/// read and written through [`prefs`](../lib/prefs.ts), whose table is the whole
/// list, and `src-tauri/src/settings.rs` states the rule they moved under.
///
/// **The rest stay here, in the webview's own store**, for one of two reasons.
///
/// The pre-paint script in `index.html` reads `hz.theme`, `hz.mode` and
/// `hz.fontSizes` with a bare `getItem` before the first frame. Nothing there
/// can await a command — the script runs before React, before the bridge is
/// asked anything — and a palette that arrives a frame late is a flash of the
/// default one.
///
/// The others *are* the window: `hz.sidebarCollapsed`, `hz.sidebarWidth`,
/// `hz.rightPanelWidth`, `hz.splitGroups`, `hz.splitLearned`, `hz.filesListSide`,
/// `hz.filesListWidth`, `hz.filesListShown`, `hz.projectFilter`, `hz.diffStyle`,
/// `hz.codeTheme`, `hz.recentCommands`. Which panel is folded, how wide it is,
/// what a diff looks like — they are not facts about the reader, and their
/// shapes are per-session, so a second build reading the first one's
/// arrangement is not something anybody asked for.
///
/// Everything below owns that second store. The two readers a plain module uses
/// — `readLocalStorage` and `writeLocalStorage` — answer a moved key from the
/// durable side instead: `useSessions`' `canAnnounce` reads the active space
/// outside React, from a listener registered once, and a space that is up is not
/// something a helper can be wrong about.

import { useCallback, useState } from "react";

import { isDurableKey, readPreference, writePreference } from "@/lib/prefs";

/// The namespace every key here lives in, and the one it lived in before the
/// app was renamed.
///
/// The prefix is written out at every call site — `"hz.sidebarCollapsed"` — so
/// renaming the app could not change what is already on disk. A reader who
/// opens the new build over the old one would find each setting back at its
/// default, which is indistinguishable from a fresh install.
const KEY_PREFIX = "hz.";
const PREVIOUS_KEY_PREFIX = "ade.";

/// Moves every preference stored under the app's previous name onto the current
/// one. Called once from `main.tsx`, before the first render reads one.
///
/// A key this build has already written wins over the old one: the reader may
/// have changed that setting since the last launch under the old name, and the
/// write is the newer of the two by definition.
export function adoptPreviousStorageKeys(): void {
  try {
    const moved: [string, string][] = [];

    for (let i = 0; i < localStorage.length; i += 1) {
      const previous = localStorage.key(i);
      if (previous === null || !previous.startsWith(PREVIOUS_KEY_PREFIX)) continue;

      const current = KEY_PREFIX + previous.slice(PREVIOUS_KEY_PREFIX.length);
      if (localStorage.getItem(current) === null) moved.push([previous, current]);
    }

    for (const [previous, current] of moved) {
      const raw = localStorage.getItem(previous);
      if (raw === null) continue;
      localStorage.setItem(current, raw);
      localStorage.removeItem(previous);
    }
  } catch {
    // A store the webview refuses costs the preferences, never the launch.
  }
}

/// One stored preference, read outside a render.
///
/// A key that has moved is answered from `~/.hz/settings.json` — see the note at
/// the top of this file — so a plain function can read it through the name it
/// has always used. Exported for the reason it is not `useState`-shaped: a
/// module store keeping its own copy of the JSON encoding is a contract that
/// drifts once and then silently reads every stored value as its default.
export function readLocalStorage<T>(key: string, initial: T): T {
  if (isDurableKey(key)) return readPreference(key, initial) as T;

  try {
    const raw = localStorage.getItem(key);
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}

/// Stores one preference, best-effort: a refused write costs the preference
/// its next launch, never the render. A moved key is written where it now
/// lives, for the same reason [`readLocalStorage`] reads it there.
export function writeLocalStorage<T>(key: string, value: T): void {
  if (isDurableKey(key)) {
    writePreference(key, value);
    return;
  }

  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or a store the webview refuses; the value lives in state meanwhile.
  }
}

/// State that survives reload. Reads lazily so a throwing or absent store costs the
/// initial value rather than the render, and writes are best-effort for the same reason.
///
/// **For the keys that stayed**: a durable one belongs in `usePreference`, which
/// is a store rather than a per-component copy — two controls reading one
/// setting must not be able to disagree about it, which is exactly what a
/// `useState` each gives you.
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readLocalStorage(key, initial));

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        writeLocalStorage(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, set] as const;
}
