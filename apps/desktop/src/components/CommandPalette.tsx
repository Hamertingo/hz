import { Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import ShortcutKeys from "@/components/ShortcutKeys";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { arrange, groupOf, highlight, suggestedName, type PaletteItem } from "@/lib/palette";
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
  workspaceName,
  onCreateAgent,
  loading = false,
}: {
  open: boolean;
  /// Routines, plugins and notes are still being read; their rows are coming.
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
  /// Named in the footer, so the reader knows whose agents these are.
  workspaceName: string;
  /// A search that found nothing offers to make an agent with that name.
  onCreateAgent: (name: string) => void;
  /// Every keystroke, for a caller that has to go and look something up. The
  /// rows above cannot answer a question about the *contents* of a session —
  /// that is a read over every log the app has kept, and it belongs to whoever
  /// can debounce it.
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => arrange(items, query), [items, query]);
  const suggestion = suggestedName(query);

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
    listRef.current?.querySelectorAll("[data-row]")[active]?.scrollIntoView({ block: "nearest" });
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
        className="top-[12vh]! w-[620px]! max-w-[calc(100vw-32px)]! translate-y-0! gap-0! overflow-hidden! p-0!"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
          <Search className="size-[15px] shrink-0 text-ink3" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
                      }}
            placeholder="Jump to an agent, a channel, a note, an action…"
            aria-label="Command palette"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink3"
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
              if (e.key === "Enter" && rows.length === 0 && suggestion) {
                e.preventDefault();
                onOpenChange(false);
                queueMicrotask(() => onCreateAgent(suggestion));
              }
            }}
          />
          <kbd className="rounded-[5px] bg-s3 px-[5px] text-[11px] leading-4 text-ink3">ESC</kbd>
        </div>

        {rows.length === 0 && loading ? (
          <PaletteSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <p className="px-6 py-6 text-center text-ui text-ink3">
            {suggestion ? (
              <>
                Nothing called {"\u201C"}
                {suggestion}
                {"\u201D"}.{" "}
                <button
                  type="button"
                  className="cursor-pointer text-ink underline underline-offset-2"
                  onClick={() => {
                    onOpenChange(false);
                    queueMicrotask(() => onCreateAgent(suggestion));
                  }}
                >
                  Create an agent called {suggestion}
                </button>
              </>
            ) : (
              "Nothing matches that."
            )}
          </p>
        ) : (
          // Capped and scrolled: a palette that grows to the window edge is a
          // list the reader has to look around the box to read.
          <div ref={listRef} className="max-h-[430px] overflow-y-auto p-1.5">
            {rows.map((item, i) => {
              // **Where the row says what was typed.** A palette row is found by
              // its words, and the accent is what tells the reader *which* words
              // answered. `null` where the row matched on its detail instead.
              const marked = highlight(item.label, query);
              const group = groupOf(item);
              const heading = i === 0 || groupOf(rows[i - 1]) !== group;

              return (
                <Fragment key={`${item.kind}:${item.id}`}>
                  {heading && (
                    <div className="px-2.5 pt-2.5 pb-[5px] text-[11.5px] font-medium text-ink4">{group}</div>
                  )}
                  <button
                    type="button"
                    data-row
                    // The pointer is the other way in, and it moves the highlight
                    // rather than running: a menu that fires on hover is one you
                    // cannot read.
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(item)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-[11px] rounded-(--r2) px-2.5 py-[7px] text-left text-ui",
                      i === active && "bg-active",
                    )}
                  >
                    {item.icon && <span className="grid w-[22px] shrink-0 place-items-center text-ink3">{item.icon}</span>}
                    <span className="shrink-0">
                      {marked ? (
                        <>
                          {marked.before}
                          <span className="text-accent-mention">{marked.match}</span>
                          {marked.after}
                        </>
                      ) : (
                        item.label
                      )}
                    </span>
                    {item.detail && (
                      <span className="min-w-0 truncate text-xs text-ink3">{item.detail}</span>
                    )}
                    {item.shortcut && (
                      <span className="ml-auto shrink-0">
                        <ShortcutKeys ids={[item.shortcut]} />
                      </span>
                    )}
                  </button>
                </Fragment>
              );
            })}
            {loading && <PaletteSkeleton rows={2} />}
          </div>
        )}

        <div className="flex gap-3.5 border-t border-line px-3.5 py-[9px] text-[11.5px] text-ink4">
          <span>{"\u2191\u2193"} move</span>
          <span>{"\u21B5"} open</span>
          <span className="ml-auto">{workspaceName}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/// Rows for the groups still being read: a heading, then an icon, a label and a
/// detail, as the real rows draw them.
function PaletteSkeleton({ rows }: { rows: number }) {
  return (
    <SkeletonRegion label="Reading notes, routines and plugins" className="p-1.5">
      <Skeleton className="mx-2.5 mt-2.5 mb-2 h-2.5 w-14" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-[11px] px-2.5 py-[9px]">
          <Skeleton className="size-[15px] rounded-[4px]" />
          <Skeleton className={i % 2 ? "h-3 w-28" : "h-3 w-40"} />
          <Skeleton className="h-2.5 w-20" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
