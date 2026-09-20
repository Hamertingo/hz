import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { dismissSlow, useSlowRequest } from "@/lib/slow";

/// One line while a read runs long.
///
/// Bottom-left, the way `NoticeStack` is top-left: both are app-level lines that
/// nothing in the layout has a slot for, and the two corners keep them from
/// landing on each other. It sits over the sidebar column, which is the cheapest
/// thing on screen to cover for the few seconds this is ever true — the reads it
/// speaks for are the ones that leave an empty *pane*, and that pane is never the
/// sidebar.
///
/// A pulsing dot rather than a spinner: the arc has a centre of its own that is
/// not the box's (see `Spinner`'s own note), and this is a two-word sentence, not
/// a control.
export default function SlowRequestToast() {
  const slow = useSlowRequest();
  if (!slow) return null;

  return (
    <div
      role="status"
      className="fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-ui text-muted-foreground shadow-sm"
    >
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/60" aria-hidden />
      <span>{slow.label}…</span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Dismiss"
        onClick={dismissSlow}
        className="cursor-pointer text-muted-foreground hover:text-foreground"
      >
        <X />
      </Button>
    </div>
  );
}
