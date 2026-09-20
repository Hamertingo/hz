import { cn } from "@/lib/utils";

/// A label's own colour, as a dot.
///
/// GitHub gives a label six hex digits without the `#`, and a label that has
/// none set falls back to the muted dot rather than to a colour this app
/// invented — the same reason the empty avatar is a letter rather than a
/// generated pattern.
export function LabelDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full bg-muted-foreground/50", className)}
      {...(color ? { style: { backgroundColor: `#${color}` } } : {})}
    />
  );
}

/// One label, as a chip.
///
/// **Shared by the list and the panel**, which show the same labels at the same
/// size: the page's rows wear them under the title and the pane wears them under
/// its own, and two copies of a pill would drift on the part that is looked at
/// — the dot's colour and the `em`-measured height that keeps a row of them
/// level.
export function LabelChip({ name, color }: { name: string; color: string | null }) {
  return (
    <span className="flex max-w-32 min-w-0 items-center gap-1 rounded-full border border-border/60 py-px pr-1.5 pl-1 text-[10px] leading-4 text-muted-foreground">
      <LabelDot color={color} className="size-2" />
      <span className="truncate">{name}</span>
    </span>
  );
}
