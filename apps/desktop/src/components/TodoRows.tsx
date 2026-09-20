import IssueStateIcon from "@/components/IssueStateIcon";
import { cn } from "@/lib/utils";
import { activeLabel, type TodoPlan, type TodoTask } from "@/lib/todo";

/// The three pieces every plan surface is built from: the mark a task carries,
/// the ring the plan as a whole carries, and the rows themselves.
///
/// **The marks are [IssueStateIcon]'s, not a second set of glyphs.** A todo is a
/// work item with a state, and the app already draws those — hollow ring for not
/// started, half wedge for in progress, a disc with a check punched out for
/// done — for the tracked work in the panel next door. A reader who has learned
/// one has learned the other, and a lucide stand-in would be a second vocabulary
/// for the same three words.
///
/// Colour is the caller's, and that is the whole of the difference between the
/// surfaces: the plan's own greens and greys, not Linear's state palette.
export function TodoGlyph({ task, className }: { task: TodoTask; className?: string }) {
  const kind =
    task.status === "completed"
      ? "completed"
      : task.status === "in_progress"
        ? "started"
        : "unstarted";
  const color =
    task.status === "completed"
      ? "var(--accent-add)"
      : // The live one is the only row allowed to be the brightest thing in the
        // list: it is the answer to "what is it doing", and the rows around it
        // are the plan.
        task.status === "in_progress"
        ? "var(--foreground)"
        : "var(--muted-foreground)";

  return <IssueStateIcon kind={kind} color={color} className={className} />;
}

/// The plan's own ring: a share of the circle filled by how much is done.
///
/// A ring rather than a count alone because the count answers "how much is
/// left" only to somebody who remembers the total, and this line is read at a
/// glance or not at all. Green once it closes, muted while it is still moving —
/// the same pair the sidebar's rail uses for the same reason.
export function PlanRing({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
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

/// The plan's header line: the ring, the word for what this is, and the step
/// being worked on.
///
/// Shared by the strip and the panel so the two cannot drift — the strip's is
/// the same line, one noun and one step shorter, because its rows are on screen
/// saying the same thing a moment below it.
export function PlanHeaderLine({
  plan,
  label = "Plan",
  current = true,
  className,
}: {
  plan: TodoPlan;
  label?: string;
  /// Whether the running step is named here. Off where the rows underneath name
  /// it themselves.
  current?: boolean;
  className?: string;
}) {
  const task = plan.current;
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
      <PlanRing
        done={plan.done}
        total={plan.total}
        className={plan.done === plan.total ? "text-accent-add" : "text-muted-foreground"}
      />
      <span className="shrink-0">{label}</span>
      {current && task && (
        <span className="min-w-0 truncate text-muted-foreground">{activeLabel(task)}</span>
      )}
      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
        {plan.done}/{plan.total}
      </span>
    </div>
  );
}

/// The plan's rows, one line each.
///
/// **The subject, never the continuous label.** Both describe the same task in
/// different tenses — "Wire the reader" against "wiring the reader" — and the
/// label is already the answer a collapsed header gives (see `planLine`), so
/// drawing it here too puts the same sentence on screen twice with the plan
/// underneath it saying nothing about the work.
export default function TodoRows({
  tasks,
  /// Whether the session is working *now*. Drives the shimmer, and only the
  /// shimmer: a plan whose agent has stopped still has a task `in_progress`, and
  /// a shimmer there would claim motion that is not happening.
  live = false,
  /// The id, where the harness has one. Off in the strip, where the row is a
  /// status line and the number is the least of what is on it; on in the panel,
  /// where it is how the reader names a task back to the agent.
  showId = false,
  className,
}: {
  tasks: TodoTask[];
  live?: boolean;
  showId?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {tasks.map((task, index) => (
        <div
          key={task.id ?? index}
          className="flex items-start gap-2 rounded-md px-1.5 py-0.5 text-ui"
        >
          <TodoGlyph task={task} className="mt-px" />

          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              task.status === "completed" && "text-muted-foreground line-through",
              task.status === "in_progress" && live && "shimmer-text",
            )}
          >
            {task.subject}
          </span>

          {showId && task.id !== null && (
            <span className="shrink-0 tabular-nums text-muted-foreground/60">#{task.id}</span>
          )}
        </div>
      ))}
    </div>
  );
}
