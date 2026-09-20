import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { ChevronUp, RefreshCw } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { contextParts } from "@/lib/context";
import { clockTime, compactTokens, isToday, relativeTime } from "@/lib/format";
import { tracked } from "@/lib/slow";
import { cn } from "@/lib/utils";
import type { AgentEvent, ContextReading, ContextSnapshot } from "@/types/events";

/// Where the ring stops being informational and starts being a warning. A
/// context this full is minutes from compacting, and a compaction costs a turn
/// and drops detail the user may still want — so it is worth reading before it
/// happens, not after.
const TIGHT = 0.8;

/// How full the model's context is, as a ring in the composer's control row, and
/// — on a press — the breakdown of what is filling it.
///
/// **The breakdown is the agent's own, fetched by asking it.** `/context` is the
/// agent's command, answered inside the agent (no model call, no tokens), and its
/// six categories — System prompt, Memory, Tools, Skills, Messages, Other — are
/// computed from state ACP never sends. So the panel asks for a reading when it
/// opens and draws those rows; while there is none it says why and falls back to
/// what hz can count itself, which is the conversation's own text and *estimated*.
/// Keep the two visibly distinct: one is a measurement, the other is arithmetic
/// over a transcript.
///
/// **A reading outlives the child that gave it, and the index holds the last
/// one.** Only a live agent can be asked, so a session reopened after a restart
/// used to fall straight back to the estimate — the reader's own rows replaced by
/// worse ones, for the ordinary act of quitting the app. So the newest reading
/// rides the session's index entry, the panel draws it immediately, and the
/// footer says *when* rather than claiming it is current; a live ask replaces it.
export default function ContextMeter({
  sessionId,
  used,
  max,
  costUsd,
  events,
  stored,
}: {
  /// The session whose child is asked, or `null` before one exists — a new task
  /// has no agent to ask, and the estimate is all there is.
  sessionId: string | null;
  used: number;
  max: number;
  /// What the agent says the newest turn cost, in dollars. `null` where it has
  /// said nothing, or said it in another currency.
  costUsd: number | null;
  /// The session's events, read **only while the panel is open** — the walk
  /// counts characters across the whole transcript, which is the one thing here
  /// too expensive to do on every event of a streaming turn.
  events: readonly AgentEvent[];
  /// The last reading the agent gave this session, off its index entry — what a
  /// session with no live child has to show. `null` where none was ever taken.
  stored: ContextReading | null;
}) {
  const [open, setOpen] = useState(false);
  /// The reading this run of the app fetched, which wins over [`stored`] — it is
  /// the same question asked of a live agent.
  const [live, setLive] = useState<ContextSnapshot | null>(null);
  /// Which of the two is on screen, since the footer has to say whether it is
  /// looking at a measurement taken now or one kept from before.
  const reading = live ?? stored?.snapshot ?? null;
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  /// Whether the agent has counted anything yet.
  ///
  /// **A window of zero is not a full window.** It is a conversation nothing has
  /// run in, and every figure below would otherwise be drawn as a measurement —
  /// `0 / 0 tokens`, a confident `0%` — of something nobody has measured. The
  /// meter is drawn from the first frame regardless, so this is the state it
  /// opens in rather than a reason not to draw it.
  const counted = max > 0;

  // A window can be exceeded on paper — the count includes the reply, which is
  // written after the prompt was admitted — and an arc past 100% wraps back to
  // looking empty.
  const fraction = counted ? Math.min(used / max, 1) : 0;
  const percent = Math.round(fraction * 100);
  const tight = fraction >= TIGHT;

  /// Why there is no number, in the words of what the reader is waiting for.
  /// The two reasons are different states and each gets its own sentence: no
  /// session to ask, or a session whose turn has not run yet.
  const uncounted = sessionId
    ? "The agent counts this session's context as its turns run."
    : "The agent counts the context once this session has started.";

  /// When a kept reading was taken: a clock time for today, a date beyond it —
  /// the two never collide in shape, and neither claims a precision the other
  /// has.
  const readAt = (ts: string) => (isToday(ts) ? (clockTime(ts) ?? "") : relativeTime(ts));

  /// Asks the child for its own reading. One at a time: the agent refuses a
  /// second prompt while one is in flight, and a press already out is not a press
  /// worth repeating.
  const ask = useCallback(async () => {
    if (!sessionId || asking) return;
    setAsking(true);
    try {
      const answer = await tracked(
        "Asking the agent to count this session's context",
        invoke<ContextSnapshot | null>("context_snapshot", { sessionId }),
      );
      setLive(answer);
      // `null` is two ordinary states and each gets its own sentence: the agent
      // has not counted a run yet, or it answered something that is not a report.
      // Silence would read as a broken control.
      setNote(answer ? null : "The agent has nothing to count for this session yet.");
    } catch (e) {
      // **The reading already on screen stays.** A failed ask — mid-turn, or a
      // child that is not running — is a refresh that did nothing, and replacing
      // a real measurement with the estimate below it would be trading a stale
      // answer for a worse one. The sentence says why nothing moved.
      setNote(typeof e === "string" ? e : "The agent could not be asked just now.");
    } finally {
      setAsking(false);
    }
  }, [sessionId, asking]);

  // Asked on the frame the panel opens, never on a timer: a reading is a
  // question somebody asked, and polling a command that costs a turn on the
  // child — however cheap — would be a background tax for a panel that is
  // usually shut.
  useEffect(() => {
    if (open) void ask();
  }, [open]);

  // **Recomputed per press, not per event.** `events` is a new array on every
  // event of a turn, so keying this on it would walk a ten-megabyte transcript at
  // the speed an agent types. Keyed on `open` alone, these are what the
  // transcript held when the reader opened it — which is what they asked for.
  const estimated = contextParts(events, max);

  // The agent's rows, heaviest first, with what is left at the end: the window
  // minus what it counted is free space, and it is the one number here the agent
  // does not state.
  const rows = reading
    ? [
        // Heaviest first, which is how a reader scans a bill of materials — and
        // it is also the order the bar draws its segments in.
        ...reading.components
          .map((component) => ({
            key: component.label,
            label: component.label,
            tokens: component.tokens,
          }))
          .sort((a, b) => b.tokens - a.tokens),
        // **Last, and deliberately not sorted with the rest**: free space is not
        // a category, it is what the categories leave, and a reader looking for
        // "how much room is there" wants it in the same place every time rather
        // than wherever its size puts it. It is the one figure the agent does not
        // state, so hz does the subtraction.
        ...(reading.max !== null && reading.used !== null && reading.max > reading.used
          ? [{ key: "free", label: "Free space", tokens: reading.max - reading.used }]
          : []),
      ]
    : [];

  // Geometry is in a 24-unit box scaled down by the SVG's own size, so the
  // stroke stays crisp at any display size and the numbers stay readable.
  const r = 9;
  const circumference = 2 * Math.PI * r;

  // One hue, faded by weight, rather than a colour per category: this app has one
  // accent on purpose (see DESIGN.md), and six hues in a panel would be the
  // loudest thing on screen for a question asked rarely. The heaviest row is the
  // accent at full strength and the rest step back from it, which is also what
  // makes the bar's segments read in the order the rows are listed.
  const heaviest = Math.max(...(reading ? rows : estimated).map((row) => row.tokens), 0);
  const strength = (tokens: number) => (heaviest > 0 ? 0.3 + 0.7 * (tokens / heaviest) : 0);
  /// A row's share of the window.
  ///
  /// **The reading's own window where there is one**, not the live count: the
  /// rows and their percentages are one snapshot the agent took, and dividing
  /// them by a window measured at another moment is how a row ends up reading
  /// over a hundred percent. The header above keeps the live figure, which is
  /// the one the ring outside is drawing — if a model changed in between, each
  /// number is still true of its own moment.
  const window = reading?.max ?? max;
  const share = (tokens: number) => (window > 0 ? tokens / window : 0);

  // What the bar draws, which is **the fill and nothing else**: the agent's
  // categories where there is a reading, hz's estimate where there is not. Free
  // space is deliberately not a segment — the bar's track already is free space,
  // and a segment for it would draw the empty part of the window as though it
  // were full of something.
  const barRows = reading ? rows.filter((row) => row.key !== "free") : estimated;

  // The segments as widths of the window, in the order they are drawn, **clipped
  // at the fill**: the estimate can over-count (four characters to a token is
  // nearer prose than JSON), and a segment drawn past the end of the bar would be
  // claiming the window holds more than the agent says it does.
  let cursor = 0;
  const widths = barRows.map((row) => {
    const width = Math.min(share(row.tokens), Math.max(0, fraction - cursor));
    cursor += width;
    return width;
  });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={counted ? `Context ${percent}% full` : "Context not counted yet"}
              className="flex shrink-0 items-center gap-1 px-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                className={cn("size-3.5", tight && "text-destructive")}
                aria-hidden
              >
                <circle
                  cx="12"
                  cy="12"
                  r={r}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  opacity="0.25"
                />
                {/* Rotated so the arc starts at twelve o'clock; SVG's own zero
                    angle is three o'clock, which reads as a gauge that begins a
                    quarter turn in. */}
                <circle
                  cx="12"
                  cy="12"
                  r={r}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - fraction)}
                  transform="rotate(-90 12 12)"
                />
              </svg>
              <ChevronUp
                className={cn("size-2.5 transition-transform duration-150", !open && "rotate-180")}
                aria-hidden
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>

        <TooltipContent>
          {counted
            ? `${compactTokens(used)} / ${compactTokens(max)} · ${percent}% used`
            : "Context not counted yet"}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-80 p-0">
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ui text-muted-foreground">Context window</span>
            <span className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-lg leading-none font-medium tabular-nums",
                  tight && "text-destructive",
                )}
              >
                {counted ? (
                  <>
                    {percent}
                    <span className="pl-0.5 text-ui font-normal text-muted-foreground/70">%</span>
                  </>
                ) : (
                  // An em dash, not a zero: this is "nothing measured", and a
                  // digit here is a measurement of something.
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
              {/* A plain button, not a menu item: Radix closes the menu on a
                  selected item, and a refresh that shut the panel would be a
                  press with nothing to show for it. */}
              <button
                type="button"
                onClick={() => void ask()}
                disabled={asking || !sessionId}
                aria-label="Ask the agent again"
                className="text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground disabled:opacity-40"
              >
                <RefreshCw className={cn("size-3", asking && "animate-spin")} />
              </button>
            </span>
          </div>

          {/* The bar is the window: the segments are the rows below, and the
              empty track is what is left of it. `gap-px` rather than a border, so
              a segment worth a fraction of a percent stays visible without
              claiming width it does not have. */}
          <div className="mt-3 flex h-2 gap-px overflow-hidden rounded-full bg-muted">
            {barRows.map((row, i) => (
              <span
                key={row.key}
                className="h-full"
                style={{
                  width: `${widths[i] * 100}%`,
                  backgroundColor: tight ? "var(--destructive)" : "var(--primary)",
                  opacity: strength(row.tokens),
                }}
              />
            ))}
          </div>

          <p className="mt-2 text-ui text-muted-foreground tabular-nums">
            {counted
              ? `${compactTokens(used)} / ${compactTokens(max)} tokens`
              : "No reading yet"}
          </p>
        </div>

        {reading ? (
          <ul className="border-t border-border px-4 py-3">
            {rows.map((row, i) => (
              <li
                key={row.key}
                className={cn("flex items-center gap-2.5 py-1 text-ui", i === rows.length - 1 && "pt-2")}
              >
                {/* The chip is the legend for the bar above: same hue, same
                    strength, so a row and its segment are one thing seen twice. */}
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{
                    backgroundColor: tight ? "var(--destructive)" : "var(--primary)",
                    opacity: strength(row.tokens),
                  }}
                />
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                  {compactTokens(row.tokens)}
                </span>
                <span className="w-14 shrink-0 text-right tabular-nums">
                  {(share(row.tokens) * 100).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="border-t border-border px-4 py-3">
            <p className="text-ui text-muted-foreground">
              {!counted && !note ? uncounted : (note ?? "Asking the agent…")}
            </p>
            {estimated.length > 0 && (
              <>
                <p className="pt-2 pb-1 text-ui text-muted-foreground/70">
                  This conversation, estimated from its own text
                </p>
                <ul>
                  {estimated.map((part) => (
                    <li key={part.key} className="flex items-center gap-2.5 py-1 text-ui">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-[3px]"
                        style={{
                          backgroundColor: tight ? "var(--destructive)" : "var(--primary)",
                          opacity: strength(part.tokens),
                        }}
                      />
                      <span className="min-w-0 truncate">{part.label}</span>
                      <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                        {compactTokens(part.tokens)}
                      </span>
                      <span className="w-14 shrink-0 text-right tabular-nums">
                        {(part.share * 100).toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {reading && (
          <div className="border-t border-border px-4 py-2.5">
            <p className="text-ui text-muted-foreground/80">
                {/* **Whether this is current is the app's fact, not the
                    snapshot's.** `live` inside the snapshot is the agent's word
                    about its own runtime — a reading kept from a session that
                    ran an hour ago still says `true` in it, because it was live
                    when it was taken. The stamp is what tells the reader which
                    moment they are looking at. */}
                {live
                  ? reading.live
                    ? "Live now"
                    : "Last completed run"
                  : `Last read ${readAt(stored?.ts ?? "")}`}
              {reading.compaction ? ` · compaction ${reading.compaction}` : ""}
            </p>
            {/* **Only beside a reading.** Where there is none, the body above
                already says why and draws the estimate instead; the sentence
                here is for the other case — a refresh that changed nothing under
                rows the reader is looking at, which is the one thing a button
                that redraws the same panel owes them. */}
            {note && <p className="pt-1 text-ui text-muted-foreground/70">{note}</p>}
          </div>
        )}

        {costUsd !== null && costUsd > 0 && (
          <div className="flex items-baseline justify-between border-t border-border px-4 py-2.5 text-ui">
            <span className="text-muted-foreground">Cost · this turn</span>
            <span className="tabular-nums">${costUsd.toFixed(4)}</span>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
