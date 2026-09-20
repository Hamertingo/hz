import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import ShortcutKeys from "@/components/ShortcutKeys";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/// One tab in a strip: a mark, a name, and the way off.
///
/// **Shared, because the rules inside it are not obvious and there are four of
/// them.** The file view's strip and the pull-requests pane's are different
/// lists with the same tab, and a second copy would drift on exactly the parts
/// that took thinking: the close cross showing on the active tab and on hover
/// elsewhere, middle-click closing, the chord named only where it applies, and
/// an active tab scrolled into view rather than the strip left as it was.
///
/// A `div` with `role="tab"` rather than a `button`, because the close control
/// sits inside it and a button inside a button is invalid markup whose click
/// lands on the wrong one — the same reading `FileLink` takes about the tool
/// row.
export default function Tab({
  icon,
  label,
  title,
  active,
  onSelect,
  onClose,
}: {
  /// Drawn before the label: a file's type mark, a pull request's number.
  icon: ReactNode;
  label: string;
  /// What the tab is *called* rather than what fits — the close cross names it
  /// in its tooltip, where a truncated label would read as a truncated tooltip.
  title: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // The strip scrolls, so a tab opened or stepped onto can be off the end of
  // it. `nearest` on both axes, or an already-visible tab would be dragged to
  // the middle and the column under it scrolled too.
  useEffect(() => {
    if (!active) return;
    ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
      // Middle-click closes, the way it does in every editor this row is copied
      // from. `auxClick` rather than `mouseDown`, or a click begun on one tab
      // and released on another closes the wrong one.
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        onClose();
      }}
      className={cn(
        "group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-ui transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      <span className="max-w-40 truncate">{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={(e) => {
              // Or closing a background tab would select it on the way out.
              e.stopPropagation();
              onClose();
            }}
            className={cn(
              "cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground",
              // Always on the active tab, on hover elsewhere: a row of crosses
              // is a row of things to press by accident, and the tab being read
              // is the one whose close is worth reaching for without hunting.
              active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        </TooltipTrigger>
        {/* The chord closes whichever tab is *active*, so a background tab's
            cross names no key — it would promise one that closes a different
            one. */}
        <TooltipContent>
          Close
          {active && <ShortcutKeys ids={["tab.close"]} />}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
