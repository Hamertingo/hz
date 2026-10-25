import { useState, type ReactNode } from "react";

import { formatClock } from "@/lib/clock";
import { cn } from "@/lib/utils";

/// "21 Oct 2026, 22:36" in the reader's own locale.
function stamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";

  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${day}, ${formatClock(date)}`;
}

/// The one line a message between agents is drawn as, from either end: a
/// sentence, the other agent's face and name, and when. Centred and quiet — it
/// is a record that something passed between two agents, not a chat bubble — and
/// the words themselves sit one click away so a long brief never fills the
/// transcript.
export default function TeamLine({
  lead,
  face,
  name,
  ts,
  body,
  reply,
  busy = false,
  error = null,
  self,
  meta,
  onOpen,
}: {
  /// Whose chat this is, drawn first: "Atlas asked Hugo". Absent where the
  /// sentence needs no subject.
  self?: ReactNode;
  /// A count after the name, such as "2 messages".
  meta?: string;
  /// Opens the exchange in a sheet instead of unfolding it in place.
  onOpen?: () => void;
  /// What happened, as the start of the sentence: "Message sent to".
  lead: string;
  face: ReactNode;
  name: string;
  ts: string;
  /// The message text, shown on click. Absent where there is nothing to open.
  body?: string;
  /// The answer that came back to an ask, shown under the question.
  reply?: string;
  /// Still in flight: a ring after the name.
  busy?: boolean;
  /// Why it did not go. Open by default, since it is the reason to look at all.
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const shown = open || error !== null;

  return (
    <div className="my-2 flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => (onOpen ? onOpen() : setOpen((v) => !v))}
        disabled={!body && !onOpen}
        aria-expanded={body && !onOpen ? shown : undefined}
        className={cn(
          "flex max-w-full items-center gap-2 text-ui text-muted-foreground transition-colors disabled:cursor-default",
          (body || onOpen) && "cursor-pointer hover:text-foreground",
          error !== null && "text-destructive hover:text-destructive",
        )}
      >
        {self}
        <span className="shrink-0">{lead}</span>
        {face}
        <span className={cn("truncate font-medium", error === null && "text-foreground")}>
          {name}
        </span>
        {busy && (
          <span
            aria-hidden
            className="size-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
          />
        )}
        {meta && <span className="shrink-0 text-muted-foreground/70">· {meta}</span>}
        <span className="shrink-0 text-muted-foreground/70">· {stamp(ts)}</span>
      </button>

      {error !== null && <p className="max-w-[85%] text-center text-ui text-destructive/90">{error}</p>}

      {shown && body && !onOpen && (
        <p className="max-w-[85%] text-center text-chat whitespace-pre-wrap wrap-anywhere text-muted-foreground">
          {body}
        </p>
      )}

      {shown && reply && !onOpen && (
        <p className="max-w-[85%] text-center text-chat whitespace-pre-wrap wrap-anywhere text-foreground/90">
          {reply}
        </p>
      )}
    </div>
  );
}
