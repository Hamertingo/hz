import { X } from "lucide-react";

import { usePaneWidth } from "@/components/ResizeHandle";
import { Button } from "@/components/ui/button";
import { dismissSlow, useSlowRequest } from "@/lib/slow";

/// One line while a read runs long.
///
/// Top of the conversation column, centred, and the two insets are the side
/// panes' own published widths — so the line is centred on the *column*, not on
/// the window. The reads it speaks for are the ones that leave a pane empty,
/// and that pane is the conversation; a fixed `left` would drift onto the panel
/// as soon as it opened.
///
/// It used to sit bottom-left, on the reasoning that the sidebar is the cheapest
/// thing on screen to cover. It is not: a row of session titles read through a
/// 5.5% veil is not "covered", it is two texts on top of each other — and the
/// line is never about the sidebar anyway.
///
/// **`--popover` and not `--card`, which is [Alert](ui/alert.tsx)'s own
/// record.** The two are the same colour until vibrancy is on, where `--card`
/// becomes a 5.5% white veil — right for a surface sitting *in* the page, and a
/// transcript read straight through here. The blur is half the fix: `--veil-float`
/// on its own still lets ~8% of what is behind through, and it is only legible
/// because every floating frame in the app carries `backdrop-blur-xl` with it.
///
/// A pulsing dot rather than a spinner: the arc has a centre of its own that is
/// not the box's (see `Spinner`'s own note), and this is a two-word sentence,
/// not a control.
export default function SlowRequestToast() {
  const slow = useSlowRequest();
  // Both before the early return, and both are what centre the line on the
  // column rather than on the window.
  const sidebar = usePaneWidth("sidebar");
  const panel = usePaneWidth("panel");
  if (!slow) return null;

  return (
    // The strip spans the column, so it must not take clicks: `pointer-events`
    // is off here and back on for the card, or the top of the transcript would
    // stop being selectable while a read is slow.
    <div
      role="status"
      style={{ left: sidebar, right: panel, top: "calc(var(--titlebar-h) + 0.5rem)" }}
      className="pointer-events-none fixed z-50 flex justify-center"
    >
      <div className="pointer-events-auto flex w-fit max-w-[min(26rem,100%)] items-center gap-2 rounded-lg bg-popover py-1.5 pr-1.5 pl-3 text-ui text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur-xl animate-in fade-in slide-in-from-top-2">
        <span
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/60"
          aria-hidden
        />
        <span className="truncate">{slow.label}…</span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Dismiss"
          onClick={dismissSlow}
          className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
