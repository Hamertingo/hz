import { useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { channel } from "@/lib/channel";
import { isAfter } from "@/lib/order";
import { cn } from "@/lib/utils";

export type DragKind = "agent" | "channel" | "member" | "section";

/// What a drag was released on. `over` is the row under the pointer (and whether
/// the pointer was in its lower half); `outside` is true when the pointer left
/// every `data-drag-zone` the drag was started in, which is how a member is
/// dragged *out* of a list.
export type DropResult = { over: { kind: DragKind; id: string; after: boolean } | null; outside: boolean };

type Live = {
  kind: DragKind;
  id: string;
  ghost: ReactNode;
  /// Where the grab was inside the row, so the ghost stays under the finger it
  /// was lifted by.
  offX: number;
  offY: number;
  width: number;
  x: number;
  y: number;
  accepts: readonly DragKind[];
  zone: string | null;
  over: DropResult["over"];
  outside: boolean;
};

/// Pointer-based like `dragSession.ts`, for the same reason: Tauri takes native
/// drag events before the webview sees them, so HTML5 drag never fires.
let live: Live | null = null;
const changed = channel<void>();

function set(next: Live | null) {
  live = next;
  changed.emit();
}

/// Held this long, or moved this far, and a press becomes a drag; a quick click
/// stays a click.
const HOLD_MS = 150;
const MOVE_PX = 6;
const EDGE_PX = 28;

type Options = {
  kind: DragKind;
  id: string;
  /// The lifted row drawn under the pointer.
  ghost: ReactNode;
  /// Which row kinds this drag can land on.
  accepts: readonly DragKind[];
  /// For a drag that can leave: the `data-drag-zone` it starts in.
  zone?: string;
  onDrop: (result: DropResult) => void;
};

function hit(x: number, y: number, d: Live): Pick<Live, "over" | "outside"> {
  const el = document.elementFromPoint(x, y);
  const row = el?.closest<HTMLElement>("[data-drag-id]");
  const kind = row?.dataset.dragKind as DragKind | undefined;
  const outside = d.zone ? !el?.closest(`[data-drag-zone="${d.zone}"]`) : false;
  if (!row || !kind || !d.accepts.includes(kind) || (kind === d.kind && row.dataset.dragId === d.id)) {
    return { over: null, outside };
  }
  const r = row.getBoundingClientRect();
  return { over: { kind, id: row.dataset.dragId ?? "", after: isAfter(y, r.top, r.height) }, outside };
}

function press(e: ReactPointerEvent<HTMLElement>, o: Options) {
  if (e.button !== 0 || live) return;
  const row = e.currentTarget;
  const rect = row.getBoundingClientRect();
  const scroller = row.closest<HTMLElement>(".scrollbar-overlay");
  const startX = e.clientX;
  const startY = e.clientY;
  let x = startX;
  let y = startY;
  let active = false;

  const begin = () => {
    active = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    const d: Live = {
      kind: o.kind,
      id: o.id,
      ghost: o.ghost,
      offX: startX - rect.left,
      offY: startY - rect.top,
      width: rect.width,
      x,
      y,
      accepts: o.accepts,
      zone: o.zone ?? null,
      over: null,
      outside: false,
    };
    set({ ...d, ...hit(x, y, d) });
  };
  const timer = window.setTimeout(begin, HOLD_MS);

  const end = (drop: boolean) => {
    window.clearTimeout(timer);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    if (!active) return;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    const d = live;
    set(null);
    // The click that follows a release is not the reader's; swallow it.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, true), 60);
    if (drop && d) o.onDrop({ over: d.over, outside: d.outside });
  };
  const move = (ev: PointerEvent) => {
    x = ev.clientX;
    y = ev.clientY;
    if (!active) {
      if (Math.hypot(x - startX, y - startY) < MOVE_PX) return;
      window.clearTimeout(timer);
      begin();
    }
    if (scroller) {
      const s = scroller.getBoundingClientRect();
      if (y < s.top + EDGE_PX) scroller.scrollTop -= 12;
      else if (y > s.bottom - EDGE_PX) scroller.scrollTop += 12;
    }
    if (live) set({ ...live, x, y, ...hit(x, y, live) });
  };
  const up = () => end(true);
  const cancel = () => end(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !active) return;
    ev.stopPropagation();
    ev.preventDefault();
    end(false);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}

/// Dependency-free press-and-hold drag for a list of rows. Spread `bind(...)`
/// on the row, read `stateOf` for its look, and mount one `<DragGhost />`.
export function useDragReorder() {
  const drag = useSyncExternalStore(changed.subscribe, () => live);
  return {
    drag,
    bind: (o: Options) => ({
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => press(e, o),
      "data-drag-kind": o.kind,
      "data-drag-id": o.id,
    }),
    /// How a row should look right now: lifted away from its place, or the
    /// target of a drop (a line before or after it, or the whole row for "on").
    stateOf: (kind: DragKind, id: string): { dragging: boolean; drop: "before" | "after" | "on" | null } => {
      if (!drag) return { dragging: false, drop: null };
      const dragging = drag.kind === kind && drag.id === id;
      const o = drag.over;
      if (!o || o.kind !== kind || o.id !== id) return { dragging, drop: null };
      return { dragging, drop: drag.kind === kind ? (o.after ? "after" : "before") : "on" };
    },
  };
}

/// Class for a row that can show a drop line, with `data-drop` set from `stateOf`.
export const DROP_LINE =
  "relative before:pointer-events-none before:absolute before:inset-x-1 before:z-10 before:h-0.5 before:rounded-full before:bg-blue before:opacity-0 data-[drop=before]:before:top-[-2px] data-[drop=before]:before:opacity-100 data-[drop=after]:before:bottom-[-2px] data-[drop=after]:before:opacity-100 data-[dragging]:opacity-40 data-[drop=on]:bg-active data-[drop=on]:ring-2 data-[drop=on]:ring-blue/60";

/// The lifted copy of the row under the pointer, portaled so no ancestor's
/// transform or backdrop filter can re-anchor `fixed`.
export function DragGhost({ kinds }: { kinds: readonly DragKind[] }) {
  const d = useSyncExternalStore(changed.subscribe, () => live);
  if (!d || !kinds.includes(d.kind)) return null;
  return createPortal(
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed z-[200] rounded-(--r2) border border-line bg-popover px-2 py-1.5 text-ink opacity-95 shadow-lg",
        d.outside && d.zone && "opacity-60",
      )}
      // Nudged down and right so the row it hovers stays readable under it.
      style={{ left: d.x - d.offX + 10, top: d.y - d.offY + 16, width: d.width, transform: "scale(1.02)" }}
    >
      {d.ghost}
    </div>,
    document.body,
  );
}
