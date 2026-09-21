import { Children, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/// Dot-separated metadata that owns its own separator.
///
/// It draws a dot only *between* the segments that survive, so a caller can
/// render `{condition && <span/>}` without leaving a stray separator behind.
/// `Children.toArray` drops the nullish entries and keys what remains, which a
/// plain array walk would not do for a single child or a fragment — and
/// `{multiRepo && …}` is exactly the false case it has to swallow.
///
/// Its own module because the pull-requests page and the inbox — the latter a
/// lazy chunk — draw the same line, and a shared import must not put either
/// page on the other's load path.
export function MetaLine({ children, className }: { children: ReactNode; className?: string }) {
  const segments = Children.toArray(children);
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {segments.flatMap((segment, index) =>
        index === 0
          ? segment
          : [
              <span key={`sep-${index}`} aria-hidden className="shrink-0 text-muted-foreground/40">
                ·
              </span>,
              segment,
            ],
      )}
    </span>
  );
}
