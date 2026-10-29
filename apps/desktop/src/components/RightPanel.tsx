import { Maximize2, Minimize2, RefreshCw } from "lucide-react";

import PanelRightIcon from "@/components/icons/PanelRightIcon";
import { Button } from "@/components/ui/button";
import ShortcutKeys from "@/components/ShortcutKeys";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useResizable } from "@/components/ResizeHandle";
import { cn } from "@/lib/utils";

/// The header button that opens and closes the pane. Lives here rather than in
/// `App` so the toggle and the thing it toggles stay in one file, and outside
/// [RightPanel] itself because the pane does not exist until something is open
/// in it — the button has to outlive it.
export function PanelToggle({ onToggle, open }: { onToggle: () => void; open: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label="Toggle panel"
          className={cn("shrink-0 transition-opacity", open ? "opacity-100" : "opacity-80 hover:opacity-100")}
        >
          <PanelRightIcon className="size-4.5" dim={!open} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        Toggle Panel
      </TooltipContent>
    </Tooltip>
  );
}

/// One body kept mounted while another is showing, so switching does not refetch.
export function TabBody({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div className={cn("min-h-0 flex-1 flex-col", active ? "flex" : "hidden")}>{children}</div>;
}

type RightPanelProps = {
  /// Closed hides the pane rather than unmounting it, so its state and its
  /// rendered reads survive a trip out and back.
  open: boolean;
  /// Re-reads what the pane is showing, drawn at the far end of the top strip.
  refresh?: { onRefresh: () => void; loading: boolean } | null;
  /// Drawn at the far end of the top strip, ahead of Refresh.
  actions?: React.ReactNode;
  /// A word in the top strip in place of the tab row, for a pane with one thing
  /// in it and nothing to switch to.
  heading?: string;
  /// Drawn ahead of the tab row, at the window's left edge. Only set while wide,
  /// so the traffic-light clearance is not drawn twice.
  lead?: React.ReactNode;
  /// The pane has taken the main column, so there is no width to drag.
  wide?: boolean;
  /// Swaps between the pane's two sizes.
  onToggleWide?: () => void;
  /// The caller's own strip of tabs, in place of the heading. The frame owns the
  /// row; the caller brings what goes in it.
  tabs?: React.ReactNode;
  children: React.ReactNode;
};

/// The frame the pull-requests page draws its detail in: one border, one top
/// strip, and the bodies inside it.
export default function RightPanel({
  open,
  refresh,
  actions,
  heading,
  lead,
  wide = false,
  onToggleWide,
  tabs,
  children,
}: RightPanelProps) {
  // 32rem, the width this pane opened at before it could be dragged.
  const { style, handle } = useResizable({
    storageKey: "hz.rightPanelWidth",
    initial: 512,
    min: 320,
    edge: "left",
    label: "Resize the panel",
    // Dropped while closed and while wide, for the sidebar's reason: a hidden
    // pane must not hold width the sidebar could not bid for, and a wide pane's
    // width is the column's rather than the reader's.
    pane: open && !wide ? "panel" : undefined,
  });

  return (
    <aside
      style={wide ? undefined : style}
      className={cn(
        "relative min-w-0 flex-col bg-sidebar",
        open ? "flex" : "hidden",
        wide ? "flex-1" : "shrink-0 border-l border-line",
      )}
    >
      {!wide && handle}
      <div
        className={cn(
          "flex h-(--titlebar-h) shrink-0 items-center gap-0.5 overflow-hidden px-2",
          !heading && "border-b border-line",
        )}
        data-tauri-drag-region="deep"
      >
        {lead}

        {tabs ? (
          <div className="scrollbar-none flex h-full min-w-0 items-center gap-1 overflow-x-auto">{tabs}</div>
        ) : heading ? (
          <span className="px-2 py-1 text-ui font-medium text-ink">{heading}</span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {onToggleWide && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-ink4 hover:text-ink2"
                  onClick={onToggleWide}
                  aria-label={wide ? "Restore the panel" : "Expand the panel"}
                >
                  {wide ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {wide ? "Restore the panel" : "Expand the panel"}
              </TooltipContent>
            </Tooltip>
          )}

          {actions}

          {refresh && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-mr-0.5 text-ink4 hover:text-ink2"
                  onClick={refresh.onRefresh}
                  aria-label="Refresh"
                >
                  <RefreshCw className={cn("size-3", refresh.loading && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                Refresh
                <ShortcutKeys ids={["panel.refresh"]} />
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {children}
    </aside>
  );
}
