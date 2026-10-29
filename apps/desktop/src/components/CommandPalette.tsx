import { Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import ShortcutKeys from "@/components/ShortcutKeys";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { arrange, groupOf, highlight, matchItems, suggestedName, type PaletteGroup, type PaletteItem } from "@/lib/palette";
import { cn } from "@/lib/utils";

/// The pill tabs above the list, and the groups each one shows. "All" shows everything.
const TABS: readonly { key: string; label: string; groups: readonly PaletteGroup[] | null }[] = [
  { key: "all", label: "All", groups: null },
  { key: "agents", label: "Agents", groups: ["Agents"] },
  { key: "channels", label: "Channels", groups: ["Channels"] },
  { key: "messages", label: "Messages", groups: ["Messages"] },
  { key: "files", label: "Files", groups: ["Code"] },
  { key: "routines", label: "Routines", groups: ["Routines"] },
];

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
  onCreateAgent,
  loading = false,
}: {
  open: boolean;
  /// Routines, plugins and notes are still being read; their rows are coming.
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
  /// A search that found nothing offers to make an agent with that name.
  onCreateAgent: (name: string) => void;
  /// Every keystroke, for a caller that has to go and look something up. The
  /// rows above cannot answer a question about the *contents* of a session —
  /// that is a read over every log the app has kept, and it belongs to whoever
  /// can debounce it.
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const tabGroups = TABS.find((t) => t.key === tab)?.groups ?? null;
  const idle = query.trim() === "";
  const rows = useMemo(() => {
    const pool = tabGroups ? items.filter((item) => tabGroups.includes(groupOf(item))) : items;
    // Nothing typed on All is the short list of things to do; a tab with nothing typed is its whole group.
    if (idle && !tabGroups) return pool.filter((item) => item.kind === "action").slice(0, 8);
    if (idle) return matchItems(pool, "");
    return arrange(pool, query);
    // `tabGroups` is a constant per tab, so the tab key stands in for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, tab]);
  const heading = (item: PaletteItem) => (idle && !tabGroups ? "Suggested" : groupOf(item));
  // Where the reader was last: the faces the list already ranks first, with nothing typed.
  const faces = (kind: PaletteItem["kind"]) => items.filter((item) => item.kind === kind && item.icon && item.detail !== "archived");
  const recent = idle && tab === "all" ? [...faces("agent").slice(0, 3), ...faces("channel").slice(0, 2)] : [];
  const suggestion = suggestedName(query);

  // Reset on open rather than on close: the box is a fresh question every time,
  // and clearing it on the way out would flicker the list back to everything
  // while the dialog is still fading.
  useEffect(() => {
    if (open) {
      setQuery("");
      setTab("all");
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
        overlayClassName="bg-black/[.42]"
        className="top-[70px]! flex! flex-col! w-[600px]! max-w-[calc(100vw-80px)]! max-h-[520px] translate-y-0! gap-0! overflow-hidden! rounded-(--r4)! border-0! bg-(--pop)! p-0! shadow-(--sh-pop)! backdrop-blur-none!"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div className="flex shrink-0 items-center gap-2.5 px-4 py-3.5 text-ink3">
          <Search className="size-[18px] shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search or jump to…"
            aria-label="Command palette"
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink3"
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
          <Cap>esc</Cap>
        </div>

        <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line px-2.5 py-2" role="tablist" aria-label="Show">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setActive(0);
              }}
              className={cn(
                "inline-flex h-[26px] shrink-0 cursor-pointer items-center rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                tab === t.key ? "bg-s3 text-ink" : "text-ink2 hover:bg-s3 hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto p-1.5 pt-1 [scrollbar-gutter:auto]!">
          {recent.length > 0 && (
            <>
              <div className="px-2.5 pt-[9px] pb-1 text-[11.5px] font-medium text-ink4">Jump back in</div>
              <div className="grid grid-cols-5 gap-0.5 pt-0.5 pb-1">
                {recent.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => run(item)}
                    className="flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-(--r2) px-1 pt-2.5 pb-2 outline-none transition-colors hover:bg-s2 focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="grid place-items-center [zoom:1.5455]">{item.icon}</span>
                    <b className="max-w-full truncate text-[11.5px] font-medium text-ink2">{item.label.replace(/^#/, "")}</b>
                  </button>
                ))}
              </div>
            </>
          )}

          {rows.length === 0 && loading ? (
            <PaletteSkeleton rows={4} />
          ) : rows.length === 0 ? (
            <p className="px-6 py-6 text-center text-[13px] text-ink3">
              {suggestion ? (
                <>
                  Nothing matches {"\u201C"}
                  {suggestion}
                  {"\u201D"}.{" "}
                  <button
                    type="button"
                    className="cursor-pointer rounded-md bg-s3 px-2.5 py-[3px] text-xs font-medium text-ink hover:bg-s3"
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
            <div ref={listRef}>
              {rows.map((item, i) => {
                // The match is drawn in the label and, lighter, in the line under it: a row found by its detail still shows why.
                const marked = highlight(item.label, query);
                const sub = item.detail ? highlight(item.detail, query) : null;
                const group = heading(item);
                const head = i === 0 || heading(rows[i - 1]) !== group;
                const face = item.kind === "agent" || item.kind === "channel" || item.kind === "inbox";

                return (
                  <Fragment key={`${item.kind}:${item.id}`}>
                    {head && <div className="px-2.5 pt-[9px] pb-1 text-[11.5px] font-medium text-ink4">{group}</div>}
                    <button
                      type="button"
                      data-row
                      // The pointer moves the highlight rather than running: a menu that fires on hover is one you cannot read.
                      onMouseMove={() => setActive(i)}
                      onClick={() => run(item)}
                      className={cn("group/row flex w-full cursor-pointer items-center gap-[11px] rounded-(--r2) px-2.5 py-[7px] text-left", i === active && "bg-s3")}
                    >
                      <span className={cn("grid size-7 shrink-0 place-items-center", face ? "[zoom:1.2727]" : "text-ink2 [&_svg]:size-[17px]!")}>{item.icon}</span>
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[13.5px] font-medium text-ink">
                          {marked ? (
                            <>
                              {marked.before}
                              <mark className="bg-transparent font-semibold text-ink">{marked.match}</mark>
                              {marked.after}
                            </>
                          ) : (
                            item.label
                          )}
                        </b>
                        {item.detail && (
                          <span className="block truncate text-xs text-ink3">
                            {sub ? (
                              <>
                                {sub.before}
                                <mark className="bg-transparent font-semibold text-ink2">{sub.match}</mark>
                                {sub.after}
                              </>
                            ) : (
                              item.detail
                            )}
                          </span>
                        )}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-2 pl-3 text-[11.5px] text-ink3">
                        {item.shortcut && <ShortcutKeys ids={[item.shortcut]} />}
                        <span className={cn("transition-opacity duration-100", i === active ? "opacity-100" : "opacity-0")}>
                          <Cap>{"\u21B5"}</Cap>
                        </span>
                      </span>
                    </button>
                  </Fragment>
                );
              })}
              {loading && <PaletteSkeleton rows={2} />}
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-3.5 border-t border-line px-4 py-[9px] text-[11.5px] text-ink3">
          <span className="flex items-center">
            <Cap>{"\u2191"}</Cap>
            <Cap>{"\u2193"}</Cap>to move
          </span>
          <span className="flex items-center">
            <Cap>{"\u21B5"}</Cap>to open
          </span>
          <span className="ml-auto flex items-center">
            <Cap>{"\u2318"}</Cap>
            <Cap>K</Cap>anywhere
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/// A keycap as the palette draws it, which is smaller than the app's own.
function Cap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-1 inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] px-1 font-sans text-[10.5px] font-medium text-ink2 shadow-[inset_0_0_0_1px_var(--line2)]">
      {children}
    </kbd>
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
