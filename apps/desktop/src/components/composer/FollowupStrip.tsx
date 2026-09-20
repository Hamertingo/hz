import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { TraceIcon } from "@/components/chat/AgentTrace";
import TodoRows, { PlanHeaderLine } from "@/components/TodoRows";
import { planRows, type TodoPlan } from "@/lib/todo";
import { cn } from "@/lib/utils";
import type { SubagentRun } from "@/lib/transcript";

/// How many runs the strip names before it stops counting them out. Three is
/// where a session is still describable at a glance; past it the list stops
/// being a status line and starts being the panel, so the rest fold into one
/// row that opens it.
const RUN_LIMIT = 3;

/// How many plan rows fit before the same thing happens to them. Higher than
/// `RUN_LIMIT` because a plan's rows are one line each and read as a sequence —
/// this is the shape the reader is following — where runs are unrelated pieces
/// of work that only ever need naming.
const PLAN_LIMIT = 5;

/// Live work above the composer: the runs the agent is holding, and the plan it
/// is working through. Unmounted with nothing live, so the composer never moves
/// for it.
///
/// **One surface, and it has to be one.** These rows used to draw as bare text
/// floating in the band above the card, right where the handoff row's own hover
/// target reaches — so pointing at a running subagent opened Commit and Create
/// PR across it. A surface fixes the picture and the ordering fixes the
/// collision: this sits *below* the handoff peek, so that row's buttons open
/// into transcript space rather than over status.
export default function FollowupStrip({
  runs,
  plan,
  /// Whether the session is working now. Only the shimmer and the opening
  /// default follow it — see below for why the plan outlives the turn.
  live,
  onOpenRun,
  onOpenPanel,
  onOpenPlan,
}: {
  /// Open runs — done ones already have their rows. Backgrounded ones stay:
  /// the run's own `sleep 45` is the work the reader is waiting on, and the
  /// transcript's background indicator is below the fold while this sits
  /// against the composer. A dev server would sit here forever, but that is
  /// what it is doing — running — and the row says so without shimmering.
  runs: SubagentRun[];
  plan: TodoPlan | null;
  live: boolean;
  onOpenRun: (id: string) => void;
  /// Opens the subagent panel, for the runs the strip stopped naming.
  onOpenPanel: () => void;
  /// Opens the plan panel, for the rows this stopped naming.
  onOpenPlan: () => void;
}) {
  /// Follows the work until the reader says otherwise, and then it is theirs —
  /// the same tri-state every trace in the transcript uses. A plan opens itself
  /// while the turn is in flight, since the rows *are* what the agent is doing;
  /// it closes itself when the turn ends, because from there it is status, and
  /// status belongs on one line.
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? live;

  if (runs.length === 0 && plan === null) return null;

  const shown = runs.slice(0, RUN_LIMIT);
  const hidden = runs.length - shown.length;
  const rows = plan ? planRows(plan.tasks, PLAN_LIMIT) : null;

  return (
    // `bg-composer` and the blur are the pair every floating surface takes —
    // this one hovers over a transcript that scrolls under it, so a card's
    // flat veil would let the text behind it read through the rows.
    <div className="mx-auto mb-1.5 w-full max-w-3xl px-4">
      <div className="flex flex-col gap-0.5 rounded-xl border border-edge-surface bg-composer px-1.5 py-1.5 shadow-(--shadow-surface) backdrop-blur-xl">
        {shown.map((run) => {
          const detail = run.status ?? run.description ?? run.label ?? "Subagent";
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => onOpenRun(run.id)}
              className="group/run flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-ui transition-colors hover:bg-sidebar-accent/50"
            >
              {/* The trace's own glyph, dimmed for a run the reader is not
                  waiting on — a background run is work being done, not work
                  being waited for, and the same mark at the same opacity would
                  say the two were the same thing. */}
              <span
                className={cn(
                  "shrink-0",
                  run.background ? "text-muted-foreground/40" : "text-muted-foreground/70",
                )}
              >
                <TraceIcon className="size-3.5" />
              </span>

              <span
                className={cn(
                  "min-w-0 max-w-fit truncate",
                  run.background ? "text-muted-foreground" : "shimmer-text",
                )}
              >
                {detail}
              </span>

              <ChevronRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/run:opacity-100" />
            </button>
          );
        })}

        {hidden > 0 && (
          <button
            type="button"
            onClick={onOpenPanel}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-ui text-muted-foreground transition-colors hover:bg-sidebar-accent/50"
          >
            <span className="w-3.5 shrink-0" aria-hidden />
            <span>{hidden === 1 ? "1 more run" : `${hidden} more runs`}</span>
            <ChevronRight className="size-3 shrink-0" />
          </button>
        )}

        {plan !== null && (
          <>
            {/* The header is the control, the way it is on every trace in the
                transcript: what the reader clicks to see more is the line they
                were already reading. */}
            <button
              type="button"
              onClick={() => setManual(!open)}
              aria-expanded={open}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-ui transition-colors hover:bg-sidebar-accent/50"
            >
              <ChevronRight
                className={cn(
                  "size-3 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-90",
                )}
              />
              {/* The step is named here only while the rows are hidden: with
                  them on screen the running one is two lines down, already
                  shimmering. */}
              <PlanHeaderLine plan={plan} current={!open} />
            </button>

            {open && rows && (
              <>
                <TodoRows tasks={rows.shown} live={live} className="pl-5" />

                {rows.hidden > 0 && (
                  // Opening the rest is the panel's job, not this row's: the
                  // strip stays a status line however long the plan gets, and
                  // the one thing it may not do is grow a second scroll box.
                  <button
                    type="button"
                    onClick={onOpenPlan}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md py-0.5 pl-5 pr-1.5 text-left text-ui text-muted-foreground transition-colors hover:bg-sidebar-accent/50"
                  >
                    <span>{rows.hidden === 1 ? "1 more" : `${rows.hidden} more`}</span>
                    <ChevronRight className="ml-auto size-3 shrink-0" />
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
