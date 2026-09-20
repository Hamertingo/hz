import { cn } from "@/lib/utils";
import type { Harness } from "@/types/events";

/// The agent's own mark, drawn wherever a session's harness is named.
///
/// **A monogram of its name, and that is not a placeholder.** The agent is this
/// app's own build, so there is no vendor mark to carry and no second one to
/// tell it apart from; a glyph traced from somebody's brand would be claiming an
/// identity that is not that brand's to give. `Hz` is what it is called.
///
/// `currentColor`, so it sits in a row of muted chrome rather than shouting over
/// it — the same reason [`LinearIcon`](./LinearIcon.tsx) does.
function HzAgentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Hz Agent"
    >
      <path d="M4 8v9M4 12.5h5M9 8v9" />
      <path d="M15 8h5l-5 9h5" />
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
  return <HzAgentIcon className={className} />;
}
