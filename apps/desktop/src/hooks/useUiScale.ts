import { useSyncExternalStore } from "react";

import { channel } from "@/lib/channel";
import {
  applyUiScale,
  coerceUiScale,
  nextUiScale,
  UI_SCALE_KEY,
} from "@/lib/uiScale";
import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";

/// The window's zoom, held once for the app — same shape as `useFontSizes` and
/// lazy for the same reason: applying it touches the webview, which must not
/// happen at import in a test with no window.
///
/// In local storage rather than `settings.json`, beside the font sizes and for
/// the split `useLocalStorage` records: this is how big the interface is *in
/// this window*, not a preference about the work.
const changed = channel<void>();
let current: number | null = null;

function store(): number {
  if (current === null) {
    current = coerceUiScale(readLocalStorage<unknown>(UI_SCALE_KEY, null));
    applyUiScale(current);
  }
  return current;
}

function commit(next: number) {
  if (next === store()) return;
  current = next;
  applyUiScale(next);
  writeLocalStorage(UI_SCALE_KEY, next);
  changed.emit();
}

/// What `main.tsx` calls at boot, so a stored scale is applied from the start
/// rather than the first time something asks for it.
export function startUiScale(): void {
  store();
}

export function zoomBy(delta: number) {
  commit(nextUiScale(store(), delta));
}

/// ⌘0. Back to 1 rather than to "the last non-default", which is the browser's
/// rule and the one thing a reader presses this for.
export function resetUiScale() {
  commit(1);
}

/// The current scale, for anything that wants to show it. Nothing does yet —
/// it is here because a store nobody reads is a store nobody notices going
/// stale, and the shortcuts tab draws its keycaps from the registry rather than
/// from this.
export function useUiScale(): number {
  return useSyncExternalStore(changed.subscribe, store, store);
}
