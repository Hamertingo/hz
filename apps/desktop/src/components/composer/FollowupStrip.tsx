import { ChevronRight } from "lucide-react";

import { TraceIcon } from "@/components/chat/AgentTrace";
import { cn } from "@/lib/utils";
import type { SubagentRun } from "@/lib/transcript";

export type TodoItem = {
  content: string;
  status: string;
  activeForm?: string;
};

export type TodoPlan = {
  items: TodoItem[];
  done: number;
  total: number;
  current: string | null;
};

/// How many runs the strip names before it stops counting them out. Three is
/// where a session is still describable at a glance; past it the list stops
/// being a status line and starts being the panel, so the rest fold into one
/// row that opens it.
const RUN_LIMIT = 3;

/// One todo list out of the `todo` calls' inputs, oldest first. Shape-narrowed
/// here rather than in the mapper: the wire input is untyped JSON and a
/// plan-shaped guess drawn as fact is worse than no strip at all.
///
/// Two shapes ride this channel. An `init` carries the list — `items` (omp's
/// own) or `todos` (Claude's) — and an op call (`done`, …) carries one task
/// name without the list. The op folds over whatever the newest init said, so
/// the strip keeps counting past the first check-off instead of going blank.
export function todoPlan(inputs: unknown[]): TodoPlan | null {
  let items: TodoItem[] | null = null;
  for (const input of inputs) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) continue;
    const rec = input as Record<string, unknown>;
    const list = readTodoList(rec);
    if (list) {
      items = list;
      continue;
    }
    // An op without a list: the list stays whatever the newest init said.
    // `done` is the only one that moves the count, and it names its task.
    if (items && rec.op === "done" && typeof rec.task === "string") {
      const name = rec.task.trim();
      items = items.map((t) =>
        t.content.trim() === name ? { ...t, status: "completed" } : t,
      );
    }
  }
  if (!items || items.length === 0) return null;
  const done = items.filter((t) => t.status === "completed").length;
  const live = items.find((t) => t.status === "in_progress") ?? null;
  return {
    items,
    done,
    total: items.length,
    current: live ? (live.activeForm?.trim() ? live.activeForm : live.content) : null,
  };
}

/// The list inside one `init`-shaped input, or null where it carries none.
/// omp's `items` are bare strings — pending by construction, since the op
/// channel is what moves them — and Claude's `todos` carry their own status.
function readTodoList(rec: Record<string, unknown>): TodoItem[] | null {
  const todos = rec.todos;
  if (Array.isArray(todos) && todos.length > 0) {
    const items: TodoItem[] = [];
    for (const entry of todos) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      if (typeof item.content !== "string" || typeof item.status !== "string") return null;
      items.push({
        content: item.content,
        status: item.status,
        activeForm: typeof item.activeForm === "string" ? item.activeForm : undefined,
      });
    }
    return items;
  }
  const raw = rec.items;
  if (Array.isArray(raw) && raw.length > 0 && raw.every((t) => typeof t === "string")) {
    return (raw as string[]).map((content) => ({ content, status: "pending" }));
  }
  return null;
}

/// The plan's own ring: a share of the circle filled by how much is done.
///
/// A ring rather than a count alone because the count answers "how much is
/// left" only to somebody who remembers the total, and this line is read at a
/// glance or not at all. Green once it closes, muted while it is still moving —
/// the same pair the sidebar's rail uses for the same reason.
function PlanRing({ done, total, className }: { done: number; total: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-3.5 shrink-0 -rotate-90", className)} aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--border)" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        // Normalized so the arc is a share of the ring rather than a length
        // recomputed from the radius every time the size changes.
        pathLength={100}
        strokeDasharray={`${total === 0 ? 0 : (done / total) * 100} 100`}
      />
    </svg>
  );
}

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
  onOpenRun,
  onOpenPanel,
}: {
  /// Open runs — done ones already have their rows. Backgrounded ones stay:
  /// the run's own `sleep 45` is the work the reader is waiting on, and the
  /// transcript's background indicator is below the fold while this sits
  /// against the composer. A dev server would sit here forever, but that is
  /// what it is doing — running — and the row says so without shimmering.
  runs: SubagentRun[];
  plan: TodoPlan | null;
  onOpenRun: (id: string) => void;
  /// Opens the subagent panel, for the runs the strip stopped naming.
  onOpenPanel: () => void;
}) {
  if (runs.length === 0 && plan === null) return null;

  const shown = runs.slice(0, RUN_LIMIT);
  const hidden = runs.length - shown.length;

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
          // Not a button: there is nothing to open. The plan's rows live in the
          // transcript, and the strip already says which step is current.
          <div className="flex items-center gap-2 px-1.5 py-0.5 text-ui text-muted-foreground">
            <PlanRing
              done={plan.done}
              total={plan.total}
              className={plan.done === plan.total ? "text-accent-add" : "text-muted-foreground"}
            />

            <span className="min-w-0 flex-1 truncate">
              {plan.current ?? (plan.done === plan.total ? "Plan complete" : "Working through the plan")}
            </span>

            <span className="shrink-0 tabular-nums">
              {plan.done}/{plan.total}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
