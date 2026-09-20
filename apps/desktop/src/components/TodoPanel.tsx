import { useState } from "react";
import { ChevronRight, Link2 } from "lucide-react";

import { PlanRing, TodoGlyph } from "@/components/TodoRows";
import { activeLabel, type TodoPlan, type TodoTask } from "@/lib/todo";
import { cn } from "@/lib/utils";

/// The plan in full: a tab of [RightPanel](./RightPanel.tsx), which owns the
/// frame — this is the body only.
///
/// **The strip's rows, and everything the strip has no room for.** The ids the
/// agent speaks in, the descriptions it wrote for the work, what a task is
/// waiting on, and which of the plan's rows the strip had to fold away. That
/// split is the same one Changes and Subagents make: the band above the composer
/// answers "what is happening", and the panel answers "what is the whole of it".
export default function TodoPanel({ plan, live }: { plan: TodoPlan | null; live: boolean }) {
  if (!plan) {
    return <p className="px-3 py-6 text-ui text-muted-foreground">No plan in this session.</p>;
  }

  const blocked = plan.tasks.filter(
    (task) =>
      task.blockedBy.length > 0 &&
      task.blockedBy.some((id) => !plan.tasks.some((other) => other.id === id && other.status === "completed")),
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Not a heading over the list — a sentence about it. The tab already says
          "Plan", so naming it again here would be the frame's own word read
          back; what the reader cannot get anywhere else is how far along it is
          and what is being waited on. */}
      <div className="flex flex-col gap-0.5 px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-2 text-ui">
          <PlanRing
            done={plan.done}
            total={plan.total}
            className={plan.done === plan.total ? "text-accent-add" : "text-muted-foreground"}
          />
          <span className="tabular-nums text-muted-foreground">
            {plan.done}/{plan.total}
          </span>
          {plan.current && (
            <span className={cn("min-w-0 truncate", live && "shimmer-text")}>
              {activeLabel(plan.current)}
            </span>
          )}
        </div>

        {blocked.length > 0 && (
          <span className="text-ui text-muted-foreground/70">
            {blocked.length === 1 ? "1 task is" : `${blocked.length} tasks are`} waiting on
            another
          </span>
        )}
      </div>

      {plan.tasks.map((task) => (
        <TaskRow key={task.id ?? task.subject} task={task} waiting={blocked.includes(task)} live={live} />
      ))}
    </div>
  );
}

/// One task, expanding in place onto the description the agent wrote for it.
///
/// Only a task with a description is clickable, and that is the app's rule
/// everywhere a row has a caret: nothing behind the header means no chevron, and
/// a control that opens an empty box is one the reader learns to stop pressing.
function TaskRow({
  task,
  waiting,
  live,
}: {
  task: TodoTask;
  waiting: boolean;
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const description = task.description?.trim() ?? "";
  const expandable = description.length > 0;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-1 text-left text-ui",
          expandable && "transition-colors hover:bg-sidebar-accent/50",
        )}
      >
        <TodoGlyph task={task} className="mt-0.5" />

        {/* The id the agent uses to name this task, ahead of the words rather
            than after them: a reader skimming for "#4" looks at the left edge,
            and the numbers line up into a column there. */}
        {task.id !== null && (
          <span className="shrink-0 tabular-nums text-muted-foreground/60">#{task.id}</span>
        )}

        <span
          className={cn(
            "min-w-0 flex-1",
            open ? "wrap-anywhere" : "truncate",
            task.status === "completed" && "text-muted-foreground line-through",
            task.status === "in_progress" && live && "shimmer-text",
            // A task waiting on another is drawn back: it is on the list and
            // not on the agent's plate, and the mark beside it says why.
            waiting && "text-muted-foreground",
          )}
        >
          {task.subject}
          {/* The running one is named the way the agent names it, under itself
              — the strip's collapsed header has this and nothing else, and one
              plan read in two places should not describe the same step in two
              different words. */}
          {task.status === "in_progress" && task.activeForm && task.activeForm !== task.subject && (
            <span className="block text-muted-foreground/70">{task.activeForm}</span>
          )}
        </span>

        {task.blockedBy.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground/60">
            <Link2 className="size-3" />
            <span className="tabular-nums">
              {task.blockedBy.map((id) => `#${id}`).join(", ")}
            </span>
          </span>
        )}

        {task.owner && (
          <span className="shrink-0 truncate text-muted-foreground/60">{task.owner}</span>
        )}

        {expandable && (
          <ChevronRight
            className={cn(
              "mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>

      {open && (
        <p className="whitespace-pre-wrap wrap-anywhere px-3 pb-1.5 pl-[2.375rem] text-ui text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
