import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/// A block standing where content will land, with a soft highlight sweeping
/// across it (`.skeleton` in App.css; still under `prefers-reduced-motion`).
///
/// **Mirror the final layout, not a generic bar.** A skeleton that has the card's
/// outline, the row's avatar and its two lines means the page does not jump when
/// the data arrives, and says what is coming rather than only that something is.
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn("skeleton block rounded-[5px]", className)} style={style} />;
}

/// A wrapper that tells a screen reader the region is being read, once.
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

const WIDTHS = ["w-40", "w-52", "w-32", "w-44", "w-36", "w-48"];

/// List rows: an avatar circle (or tile) and two lines. The widths vary down the
/// list so it reads as names and sentences rather than as a table.
export function SkeletonRows({
  count = 4,
  avatar = "circle",
  size = 30,
  className,
  trailing = false,
}: {
  count?: number;
  avatar?: "circle" | "tile" | "none";
  size?: number;
  className?: string;
  /// A short block at the right edge, for a time or a count.
  trailing?: boolean;
}) {
  return (
    <div aria-hidden className={cn("flex flex-col", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-2">
          {avatar !== "none" && (
            <Skeleton
              className={avatar === "circle" ? "rounded-full" : "rounded-[9px]"}
              style={{ width: size, height: size }}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3", WIDTHS[i % WIDTHS.length])} />
            <Skeleton className={cn("h-2.5 max-w-[80%]", WIDTHS[(i + 3) % WIDTHS.length])} />
          </div>
          {trailing && <Skeleton className="h-2.5 w-8" />}
        </div>
      ))}
    </div>
  );
}

/// A few lines of prose.
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}
