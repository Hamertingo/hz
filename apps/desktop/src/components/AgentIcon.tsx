import { cn } from "@/lib/utils";
import type { Harness } from "@/types/events";

/// Every agent's own mark, drawn wherever a session's harness is named.
///
/// `currentColor` for [`LinearIcon`](./LinearIcon.tsx)'s reason: these sit in a
/// row of muted chrome, and a saturated logo would be the loudest thing on a
/// surface whose job is to be quiet. It also lets one selected icon go
/// `text-foreground` while the other stays muted, which is the whole of how the
/// picker shows which agent is on.
/// MiniMax Code's mark — a monogram, because the vendor's own art is not in
/// this repository and a brand glyph traced from memory is worse than none.
/// Drawn in `currentColor` like the marks this file used to hold, so it sits in
/// a row of muted chrome rather than shouting over it.
function MiniMaxIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      role="img"
      aria-label="MiniMax Code"
    >
      <path d="M4 17V8l4 5 4-5v9" />
      <path d="M16 17V8m0 5h4v4" />
    </svg>
  );
}

export default function AgentIcon({
  harness,
  className,
  brand = false,
}: {
  harness: Harness;
  className?: string;
  brand?: boolean;
}) {
  // One agent, so there is nothing to switch on: the other four marks went with
  // the harnesses that named them. `brand` is kept in the signature because
  // every caller passes it and a mark with no second colour treats it the same
  // as any other corner of muted chrome.
  void harness;
  void brand;
  return <MiniMaxIcon className={className} />;
}
