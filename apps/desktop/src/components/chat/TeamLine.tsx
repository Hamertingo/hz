import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/// The one line a message between agents is drawn as, from either end: a
/// sentence, the other agent's face and name, and a chevron when it opens the
/// thread. Plain centred text, no box — a record that something passed between
/// two agents, not a bubble — and the words sit one click away so a long brief
/// never fills the transcript.
export default function TeamLine({
  lead,
  face,
  name,
  body,
  reply,
  busy = false,
  error = null,
  onOpen,
}: {
  /// Opens the thread instead of unfolding the words in place.
  onOpen?: () => void;
  /// What happened, as the start of the sentence: "Sent a message to".
  lead: string;
  face: ReactNode;
  name: string;
  /// The message text, unfolded on click where nothing opens.
  body?: string;
  /// The answer that came back to an old ask, shown under the question.
  reply?: string;
  /// Still in flight: dots after the name.
  busy?: boolean;
  /// Why it did not go. Always shown, since it is the reason to look at all.
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const shown = open || error !== null;
  const clickable = Boolean(body || onOpen);

  return (
    <div className="team-line my-3 flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => (onOpen ? onOpen() : setOpen((v) => !v))}
        disabled={!clickable}
        aria-expanded={body && !onOpen ? shown : undefined}
        className={cn(
          "group/tl inline-flex max-w-[90%] items-center gap-1.5 text-[13.5px] text-ink3 disabled:cursor-default",
          clickable && "cursor-pointer",
          error !== null && "text-red",
        )}
      >
        <span className="shrink-0">{lead}</span>
        {face}
        <span className={cn("truncate font-semibold", error === null && "text-ink transition-colors group-hover/tl:text-ink2")}>{name}</span>
        {busy && (
          <span className="team-wait inline-flex gap-[2px]" aria-label="waiting">
            <i />
            <i />
            <i />
          </span>
        )}
        {clickable && error === null && (
          <ChevronRight className="-ml-0.5 size-3.5 shrink-0 text-ink4 transition-transform group-hover/tl:translate-x-0.5" strokeWidth={2.2} />
        )}
      </button>

      {error !== null && <p className="max-w-[80%] text-center text-[12px] text-red/90">{error}</p>}

      {shown && body && !onOpen && (
        <p className="max-w-[80%] rounded-[12px] bg-s1 px-3 py-2 text-[13px] whitespace-pre-wrap wrap-anywhere text-ink2">{body}</p>
      )}

      {shown && reply && !onOpen && (
        <p className="max-w-[80%] rounded-[12px] bg-s2 px-3 py-2 text-[13px] whitespace-pre-wrap wrap-anywhere text-ink">{reply}</p>
      )}
    </div>
  );
}
