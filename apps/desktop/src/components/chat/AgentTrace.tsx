import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/// The sparkle that heads every trace. Drawn rather than borrowed so its waist
/// matches the header's own 14–16px box — a four-point star scaled down from a
/// larger grid loses the thin arms that make it read as a sparkle at all.
export function TraceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
  );
}

/// One expandable agent trace: a header that shimmers while the work is live and
/// settles to a past-tense line, and a body revealed behind a left rule.
///
/// **Four surfaces wear this and that is the whole point.** Live thinking, a
/// committed reasoning block, a run of web searches and a run of tool calls all
/// read as the same kind of thing — work the agent did on the way to an answer
/// — so they fold, settle and re-open the same way. A reader who has learned one
/// has learned all four.
///
/// Two things make it a trace rather than a disclosure:
///
/// - **It opens itself while it is the live edge and closes when it lands.** A
///   running step is the only thing on screen saying what the agent is doing,
///   so making the reader click for it is asking them to know it is there. Once
///   it settles it is scrollback, and scrollback that unfolds itself pushes the
///   answer the reader is waiting for off the bottom.
/// - **The rows arrive staggered.** The delay is what makes a trace read as
///   work happening in order rather than as a block that appeared whole.
///
/// A reader's own click wins over both, permanently: `manual` is a tri-state,
/// so `null` means "following the work" and a boolean means they have decided.
export default function AgentTrace({
  active,
  done,
  working,
  rows,
  defaultOpen,
  icon,
  open: controlled,
  onToggle,
  className,
}: {
  /// Shown, shimmering, while the work is still going.
  active: string;
  /// The settled past-tense line — "Thought for 4 seconds", "Ran 3 tools".
  done: string;
  working: boolean;
  /// One element per row. Handed over one by one rather than as a fragment so
  /// the stagger delay can be applied here, which is the only place that knows
  /// the order.
  rows: ReactNode[];
  /// Start open, whatever the work is doing. For a trace whose rows are the
  /// point — the steps of a finished turn — where following the live rule would
  /// render them into a folded box.
  defaultOpen?: boolean;
  /// Heads the trace. The sparkle is right for the agent's own thinking and
  /// wrong for a run of web searches, which says so with a globe.
  icon?: ReactNode;
  /// Controlled folding, for a caller whose own bookkeeping depends on knowing
  /// whether the body is showing — the turn block, which has to suppress the
  /// message a revealed row would otherwise draw twice. Omit both and the trace
  /// follows the work by itself.
  open?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  // A trace that was told to start open starts open whatever it is doing —
  // `defaultOpen` is not a modifier on the live rule, it replaces it. That
  // matters for a trace with no work behind it yet, which would otherwise
  // render its rows into a folded box.
  const open = controlled ?? manual ?? (defaultOpen ?? working);

  // Nothing to reveal: the header is the whole row, and a chevron pointing at
  // an empty box is a control that answers nothing.
  if (rows.length === 0) {
    return (
      <div className={cn("flex items-center gap-2 text-chat text-muted-foreground", className)}>
        <span className="shrink-0 text-muted-foreground/70">
          {icon ?? <TraceIcon className="size-3.5" />}
        </span>
        <span className={cn(working && "shimmer-text")}>{working ? active : done}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => (onToggle ? onToggle() : setManual((prev) => !(prev ?? open)))}
        className="group/trace flex w-fit items-center gap-2 text-left text-chat text-muted-foreground"
      >
        <span className="shrink-0 text-muted-foreground/70">
          {icon ?? <TraceIcon className="size-3.5" />}
        </span>

        <span className={cn(working && "shimmer-text")}>{working ? active : done}</span>

        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
            "opacity-0 group-hover/trace:opacity-100",
            open && "rotate-90 opacity-100",
          )}
        />
      </button>

      {/* `grid-template-rows` 0fr → 1fr is what animates a height nobody had to
          measure, and the inner `overflow-hidden` is what clips the rows while
          it runs. `min-h-0` on the row container: a grid item's floor is its
          content, so without it the collapsed track still reports full height. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          {/* The rule runs the height of the rows, which is what makes them read
              as one trace rather than as an indented list. */}
          <div className="mt-1 ml-1.5 flex flex-col gap-1.5 border-l border-border pl-3">
            {rows.map((row, i) => (
              <div
                key={i}
                className="animate-trace-row"
                // Staggered, and capped: a twenty-row trace should not leave the
                // last row waiting a second and a half to appear.
                style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
              >
                {row}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
