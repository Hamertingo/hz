import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import ShortcutKeys from "@/components/ShortcutKeys";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { kindLabel, matchItems, type PaletteItem } from "@/lib/palette";
import { cn } from "@/lib/utils";

/// One box over the window: jump to a session, switch project or space, run
/// something the shell can do.
///
/// **A dialog, and the keys are the input's.** There is no `cmdk` in this app and
/// none is needed: the list is never focused, so every key — arrows, Enter,
/// Escape (Radix's own) — is read by the field the reader is typing in. That is
/// also why the list cannot steal the caret, which is the whole reason the
/// composer's picker is built this way too.
///
/// Rows carry a real `ShortcutKeys`, read from the registry, so a rebinding
/// moves the caps without this knowing: the palette can never name a chord the
/// key no longer fires.
export default function CommandPalette({
  open,
  onOpenChange,
  items,
  onQueryChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
  /// Every keystroke, for a caller that has to go and look something up. The
  /// rows above cannot answer a question about the *contents* of a session —
  /// that is a read over every log the app has kept, and it belongs to whoever
  /// can debounce it.
  onQueryChange?: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => matchItems(items, query), [items, query]);

  // Reset on open rather than on close: the box is a fresh question every time,
  // and clearing it on the way out would flicker the list back to everything
  // while the dialog is still fading.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  // A query narrows the list under the cursor, so the highlight has to come back
  // with it or it points at whatever row happens to hold that index now.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // The highlight has to be on screen: ↓ past the fold otherwise moves a cursor
  // nobody can see. `nearest` rather than centring, so stepping through a list
  // that already fits does not scroll it.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (item: PaletteItem) => {
    onOpenChange(false);
    // After the close, so an action that opens a dialog of its own is not
    // fighting this one for focus — and so a session jump lands on a pane that
    // is no longer behind an overlay.
    queueMicrotask(() => item.run());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The settings surface's bargain: a fade is the app showing through a
        // surface that covers it. This one covers less, but it still has to be
        // there the moment ⌘K lands rather than a moment after.
        animated={false}
        showClose={false}
        className="top-[12vh]! max-w-xl! translate-y-0! gap-0! overflow-hidden! p-0!"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              onQueryChange?.(e.currentTarget.value);
            }}
            placeholder="Search sessions, messages, projects and actions — or type > for actions"
            aria-label="Command palette"
            className="min-w-0 flex-1 bg-transparent text-chat outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
              }
              if (e.key === "Enter" && rows[active]) {
                e.preventDefault();
                run(rows[active]);
              }
            }}
          />
        </div>

        {rows.length === 0 ? (
          <p className="px-3 py-6 text-ui text-muted-foreground">Nothing matches that.</p>
        ) : (
          // Capped and scrolled: a palette that grows to the window edge is a
          // list the reader has to look around the box to read.
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
            {rows.map((item, i) => (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                // The pointer is the other way in, and it moves the highlight
                // rather than running: a menu that fires on hover is one you
                // cannot read.
                onMouseMove={() => setActive(i)}
                onClick={() => run(item)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui",
                  i === active ? "bg-surface-selected" : "hover:bg-surface-selected/50",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.detail && (
                  <span className="min-w-0 max-w-[40%] truncate text-muted-foreground">
                    {item.detail}
                  </span>
                )}
                {/* The kind, not a heading. A heading over a run of one row is a
                    heading for a single row, and a session list is nearly all
                    sessions — so the word belongs on the row that needs it. */}
                <span className="shrink-0 text-[10px] tracking-wide text-muted-foreground/60 uppercase">
                  {kindLabel(item.kind)}
                </span>
                {item.shortcut && <ShortcutKeys ids={[item.shortcut]} />}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
