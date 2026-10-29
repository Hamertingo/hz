import { useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import type { Pose } from "@/lib/face";
import { applyOrder } from "@/lib/order";

/// What the sidebar remembers per workspace that the backend has no field for: the pinned strip, folders,
/// hidden rows, the one list order that mixes agents and channels, and what the reader marked read or unread.
/// A row is an agent's id, or `#` and a channel's id, so the two can share one list.

export type SideFolder = { id: string; name: string; ids: string[] };

export type SideState = {
  pins: string[];
  folders: SideFolder[];
  hidden: string[];
  /// Folders folded shut, by id.
  shut: string[];
  order: string[];
  /// Marked unread by hand.
  unread: string[];
  /// Row id to the token of the last thing it had said when the reader marked it read.
  seen: Record<string, string>;
};

export const MAX_PINS = 4;

export const EMPTY_SIDE: SideState = { pins: [], folders: [], hidden: [], shut: [], order: [], unread: [], seen: {} };

export const channelRow = (id: string) => `#${id}`;
export const isChannelRow = (row: string) => row.startsWith("#");

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/// Tolerant of whatever an earlier build left: a field that is not what it should be reads as empty.
export function readSide(raw: unknown): SideState {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const folders = Array.isArray(o.folders)
    ? o.folders.flatMap((f): SideFolder[] => {
        const e = typeof f === "object" && f !== null ? (f as Record<string, unknown>) : {};
        return typeof e.id === "string" && typeof e.name === "string" ? [{ id: e.id, name: e.name, ids: strings(e.ids) }] : [];
      })
    : [];
  const seen: Record<string, string> = {};
  if (typeof o.seen === "object" && o.seen !== null) {
    for (const [k, v] of Object.entries(o.seen)) if (typeof v === "string") seen[k] = v;
  }
  return { pins: strings(o.pins), folders, hidden: strings(o.hidden), shut: strings(o.shut), order: strings(o.order), unread: strings(o.unread), seen };
}

const without = (xs: string[], id: string) => xs.filter((x) => x !== id);

/// Pins or unpins `row`. A fifth pin is refused by returning the same state, which the caller reads as "full".
export function withPin(s: SideState, row: string, pinned: boolean): SideState {
  if (!pinned) return { ...s, pins: without(s.pins, row) };
  if (s.pins.includes(row)) return s;
  if (s.pins.length >= MAX_PINS) return s;
  return { ...s, pins: [...s.pins, row] };
}

/// Files `row` in a folder, or takes it out of every folder when `folderId` is null.
export function withFolderMove(s: SideState, row: string, folderId: string | null): SideState {
  const folders = s.folders.map((f) => ({ ...f, ids: without(f.ids, row) }));
  return {
    ...s,
    folders: folders.map((f) => (f.id === folderId ? { ...f, ids: [...f.ids, row] } : f)),
    shut: folderId ? without(s.shut, folderId) : s.shut,
  };
}

export function withNewFolder(s: SideState, id: string, name: string): SideState {
  return { ...s, folders: [...s.folders, { id, name, ids: [] }] };
}

export function withHidden(s: SideState, rows: readonly string[], hidden: boolean): SideState {
  const set = new Set(rows);
  return { ...s, hidden: hidden ? [...s.hidden.filter((x) => !set.has(x)), ...rows] : s.hidden.filter((x) => !set.has(x)) };
}

/// Marks a row read (remembering how far it had got) or unread by hand.
export function withRead(s: SideState, row: string, read: boolean, token: string): SideState {
  return read
    ? { ...s, unread: without(s.unread, row), seen: { ...s.seen, [row]: token } }
    : { ...s, unread: s.unread.includes(row) ? s.unread : [...s.unread, row] };
}

/// Forgets a row everywhere: after it is deleted or moved to another workspace.
export function withoutRow(s: SideState, row: string): SideState {
  const { [row]: _gone, ...seen } = s.seen;
  return {
    ...s,
    pins: without(s.pins, row),
    hidden: without(s.hidden, row),
    order: without(s.order, row),
    unread: without(s.unread, row),
    folders: s.folders.map((f) => ({ ...f, ids: without(f.ids, row) })),
    seen,
  };
}

/// An agent rests once it has been quiet this long; before that it is awake and idle.
export const REST_AFTER_MS = 2 * 3_600_000;

/// What the face in the list is doing: working while a turn runs, asleep after a long quiet, awake between.
export function poseFor(working: boolean, atMs: number | null, now: number = Date.now()): Pose {
  if (working) return "work";
  return atMs === null || now - atMs > REST_AFTER_MS ? "sleep" : "idle";
}

/// The rows in the order the list draws them: the reader's own order where they dragged, newest talk first elsewhere.
export function arrangeRows(rows: readonly { id: string; at: number }[], order: readonly string[]): string[] {
  const byRecent = [...rows].sort((a, b) => b.at - a.at);
  return applyOrder(byRecent, order).map((r) => r.id);
}

const KEY = "hz.sidebar";

let all: Record<string, SideState> = (() => {
  const raw = readLocalStorage<unknown>(KEY, {});
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, readSide(v)]));
})();
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/// Applies `f` to a workspace's sidebar state and keeps it.
export function updateSide(workspaceId: string, f: (s: SideState) => SideState) {
  const next = f(all[workspaceId] ?? EMPTY_SIDE);
  all = { ...all, [workspaceId]: next };
  writeLocalStorage(KEY, all);
  for (const l of listeners) l();
}

export function useSide(workspaceId: string | null): SideState {
  const a = useSyncExternalStore(subscribe, () => all);
  return (workspaceId && a[workspaceId]) || EMPTY_SIDE;
}
