import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useSyncExternalStore } from "react";

import type { ComposerPrefs } from "@/hooks/useComposerPrefs";
import type { Chord, ShortcutId } from "@/lib/shortcuts";
import type { ModelId, Preferences, PreferencesPatch, UpdateChannel } from "@/types/events";

/// The reader's picks, on the side that outlives the webview.
///
/// `localStorage` is per-build and per-webview: a dev build and a released one
/// do not share it, clearing site data loses every pick, and nothing outside the
/// webview can read it. So the picks that are *facts about the reader* live in
/// `~/.hz/settings.json` instead — `settings.rs` states the rule and names what
/// stays behind. They are read in one command before the first render, which is
/// what makes a store out of the webview answerable synchronously everywhere
/// below: a picker paints the reader's pick on its first frame, and a chord
/// reads the space that is up rather than the one the app launched in.
///
/// What stays in the webview is the window's own state — folded panels, widths,
/// diff style — and the keys the pre-paint script reads. `useLocalStorage` is
/// still the right tool for all of those.

/// Every preference that has moved, keyed by the key it moved *from*.
///
/// The storage keys are kept: they are one name per pick, they are what a call
/// site already holds (`SPACE_KEY`, `STARRED_MODELS_KEY`), they are what
/// [`adoptDurablePreferences`] moves, and a field of `settings.json` is one of
/// them camel-cased — which is the whole of the relationship. This table is the
/// only place the two sides meet.
const FIELDS = {
  "hz.composerPrefs": "composerPrefs",
  "hz.modelRotation": "modelRotation",
  "hz.shortcuts": "shortcuts",
  "hz.updateChannel": "updateChannel",
  "hz.openWith": "openWith",
  "hz.openFileWith": "openFileWith",
  "hz.runInTerminal": "runInTerminal",
  "hz.space": "space",
  "hz.spaces": "spaces",
} as const satisfies Record<string, PreferencesPatch["field"]>;

/// One of those keys.
export type DurableKey = keyof typeof FIELDS;

/// What each of them holds.
///
/// Spelled out here rather than read off [`Preferences`], whose fields are
/// `JsonValue`: Rust stores these verbatim and never reads one, so the shape
/// belongs to the module that owns it — `ComposerPrefs`, `lib/shortcuts`'s
/// chords, `lib/space`'s names. It is also what pairs a key with its value type,
/// so no call site casts.
export type PreferenceValues = {
  "hz.composerPrefs": ComposerPrefs;
  // `null` is "never chosen", and it means *every* model — see `modelRotation`
  // in `lib/modelRotation.ts`. The Rust side stores it as an absent field.
  "hz.modelRotation": ModelId[] | null;
  "hz.shortcuts": Partial<Record<ShortcutId, Chord>>;
  "hz.updateChannel": UpdateChannel;
  "hz.openWith": string | null;
  "hz.openFileWith": string | null;
  "hz.runInTerminal": string | null;
  "hz.space": string | null;
  "hz.spaces": string[];
};

const KEYS = Object.keys(FIELDS) as DurableKey[];

/// What the file held when it was read. A preference it does not name is
/// *absent* here rather than defaulted, and that is load-bearing:
/// [`adoptDurablePreferences`] moves on exactly the keys this has nothing for.
///
/// `const` because it is filled and emptied rather than replaced: a reader
/// holding the object across a write must see the write.
const held: Partial<Record<DurableKey, unknown>> = {};

/// Whether [`loadPreferences`] answered. Until it has, the webview's own copy is
/// the only thing that knows what the reader picked.
let loaded = false;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// Reads every durable preference, once, before the first render.
///
/// Awaited by `main.tsx`, ahead of the migration and of the render below it:
/// after it, every read here is a lookup rather than a round trip.
///
/// **A failed read is not an error to the caller.** Nothing below is left unable
/// to answer — the webview's copies answer instead — and a backend that cannot
/// be reached is a launch with larger problems than one of these.
export async function loadPreferences(): Promise<void> {
  try {
    const settings = await invoke<Preferences>("get_preferences");
    for (const key of KEYS) {
      const value = settings[FIELDS[key]];
      if (value !== null && value !== undefined) held[key] = value;
    }
    loaded = true;
  } catch (err) {
    console.error("could not read ~/.hz/settings.json", err);
  }
}

/// One durable preference, or `initial` where nothing has ever picked one.
///
/// The second signature is the seam `readLocalStorage` reads through: it holds a
/// key as a plain string and has no idea what is stored under it, where a call
/// site with a typed key gets the value its own key promises.
export function readPreference<K extends DurableKey>(
  key: K,
  initial: PreferenceValues[K],
): PreferenceValues[K];
export function readPreference(key: DurableKey, initial: unknown): unknown;
export function readPreference(key: DurableKey, initial: unknown): unknown {
  const value = held[key];
  if (value !== undefined) return value;
  // Nothing in the file for it, and no answer from the backend at all: the copy
  // this build has not moved yet is the reader's pick, and reading past it
  // would hand them a default for a setting they have.
  if (loaded) return initial;

  const copy = webviewCopy(key);
  return copy.present ? copy.value : initial;
}

/// Stores one, and tells every mounted reader of it.
///
/// Held before the write, so the next reader — a chord, a click, a menu opening
/// — sees it without waiting on a round trip, and the write is what makes it
/// survive the launch. Best-effort like `writeLocalStorage`: a refused write
/// costs the preference its next launch, never the render. The second signature
/// is the seam `writeLocalStorage` writes through, for the reason
/// [`readPreference`]'s is.
export function writePreference<K extends DurableKey>(key: K, value: PreferenceValues[K]): void;
export function writePreference(key: DurableKey, value: unknown): void;
export function writePreference(key: DurableKey, value: unknown): void {
  held[key] = value;
  emit();

  void invoke("set_preferences", { patches: [patchFor(key, value)] }).catch((err) => {
    console.error(`could not store ${key} in ~/.hz/settings.json`, err);
  });
}

/// One durable preference, and a setter that stores it.
///
/// A store rather than a per-component copy, the shape `useRoles` and
/// `useCodeTheme` have: there is one value in `settings.json`, and two mounted
/// controls reading it must not be able to disagree about which it is.
export function usePreference<K extends DurableKey>(
  key: K,
  initial: PreferenceValues[K],
): readonly [
  PreferenceValues[K],
  (next: PreferenceValues[K] | ((prev: PreferenceValues[K]) => PreferenceValues[K])) => void,
] {
  const stored = useSyncExternalStore(
    subscribe,
    () => held[key],
    () => held[key],
  );

  // The default never changes while a component is mounted, and a caller that
  // writes `[]` or `{}` inline would otherwise hand the setter a new identity on
  // every render — which is a re-render of anything memoized on it.
  const start = useRef(initial);

  const set = useCallback(
    (next: PreferenceValues[K] | ((prev: PreferenceValues[K]) => PreferenceValues[K])) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: PreferenceValues[K]) => PreferenceValues[K])(
              readPreference(key, start.current),
            )
          : next;
      writePreference(key, resolved);
    },
    [key],
  );

  return [
    stored === undefined ? readPreference(key, initial) : (stored as PreferenceValues[K]),
    set,
  ];
}

/// Whether a key is one of the moves — the question `readLocalStorage` asks
/// before it answers from the wrong store.
export function isDurableKey(key: string): key is DurableKey {
  return Object.hasOwn(FIELDS, key);
}

/// Moves the preferences a build before this one left in the webview into
/// `settings.json`.
///
/// Called once from `main.tsx`, after [`loadPreferences`] and before the first
/// render — the same place, and the same shape `adoptPreviousStorageKeys` has,
/// for the same reason: everything below reads these keys as they are stored, so
/// the move has to have happened before the first one does. A reader upgrading
/// hz must not lose their picks or their rebindings.
///
/// **The file wins, and its silence is what moves a key.** A key the file
/// already names has been answered for since the move, so the webview's copy is
/// the older of the two and is dropped rather than written back. A key only the
/// webview has is written through and then removed — *after* the write lands,
/// never before, which is what makes running this a second time a no-op: the
/// next launch finds nothing to move, and a copy left behind by a failed write
/// is simply tried again. Nothing here can lose a pick: the worst case is the
/// same move attempted again next launch.
export async function adoptDurablePreferences(): Promise<void> {
  // Nothing was read, so there is no telling a key the file already answers for
  // from one it does not: writing any of them could undo a newer pick.
  if (!loaded) return;

  const moving: { key: DurableKey; value: unknown }[] = [];

  for (const key of KEYS) {
    const copy = webviewCopy(key);
    if (!copy.present) continue;

    if (held[key] !== undefined) {
      // Already stored, and the reader has picked since: the copy is the older
      // answer, and going back to it would undo whatever they picked.
      dropCopy(key);
      continue;
    }

    moving.push({ key, value: copy.value });
  }

  if (moving.length === 0) return;

  let stored = true;
  try {
    await invoke("set_preferences", {
      patches: moving.map(({ key, value }) => patchFor(key, value)),
    });
  } catch (err) {
    console.error("could not move preferences into ~/.hz/settings.json", err);
    stored = false;
  }

  for (const { key, value } of moving) {
    // Held either way, so this session reads the reader's picks even where the
    // write did not land — and only a write that landed lets the webview's copy
    // go, which is the half that keeps the move lossless.
    held[key] = value;
    if (stored) dropCopy(key);
  }
  emit();
}

/// The patch one preference change travels as.
///
/// Takes the key and the value loose because both of its callers hold them that
/// way — one is the [`writePreference`] seam, the other walks the whole table —
/// and casts once, here, rather than at each of them. Not because the two sides
/// disagree: the pair a patch carries — that field, this value — is one
/// TypeScript cannot correlate for a key it does not know, and Rust is where the
/// value is checked, parsed into the field's own type before anything is
/// written.
function patchFor(key: DurableKey, value: unknown): PreferencesPatch {
  return { field: FIELDS[key], value } as PreferencesPatch;
}

/// What the webview holds for a key, presence included, or nothing where it
/// holds none.
///
/// Read by hand rather than through `readLocalStorage`, for the one thing this
/// has to say that a value cannot: whether there is a copy at all. That is what
/// [`adoptDurablePreferences`] moves on, and it is also what lets a read before
/// the first load answer with the pick rather than with its default.
function webviewCopy(key: DurableKey): { present: boolean; value: unknown } {
  try {
    const raw = localStorage.getItem(key);
    return raw === null
      ? { present: false, value: undefined }
      : { present: true, value: JSON.parse(raw) };
  } catch {
    // A store the webview refuses, or a copy that is not the JSON this build
    // writes: there is nothing to move, and nothing to lose either.
    return { present: false, value: undefined };
  }
}

/// Removes a copy that has been stored on the other side, or one the file
/// already answers for. Best-effort: a copy that survives costs one wasted
/// adoption next launch, never a pick.
function dropCopy(key: DurableKey): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do: the next launch tries the same move again.
  }
}
