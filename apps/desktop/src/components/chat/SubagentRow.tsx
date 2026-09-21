import { memo } from "react";
import { ChevronRight } from "lucide-react";
import BloubAvatar from "@/components/BloubAvatar";

import type { SubagentRun } from "@/lib/transcript";
import { cn } from "@/lib/utils";

/// The subagent's place in the main conversation: one compact row. It never
/// expands inline — clicking opens the run's own conversation, which takes the
/// column the way a selected session does.
///
/// The row says what the agent is doing and nothing else. Its tool name is
/// harness vocabulary ("Task", "local_bash") that names the mechanism rather
/// than the work, and a step count says something happened without saying what.
///
/// Memoised on identity. The `run` comes out of the walk's own map, so it holds
/// still across the deltas of an unrelated turn and this row is skipped; it
/// changes exactly when the run reports something, which is when the row must
/// redraw. A comparator would be comparing a run's whole event list to answer
/// what identity answers.
function SubagentRow({
  run,
  onOpen,
}: {
  run: SubagentRun;
  onOpen: (id: string) => void;
}) {
  // While running, `status` is rewritten per progress event, so it reads as a
  // live status line without opening anything. The label is the floor — a run
  // that reported no description still needs something clickable.
  const detail =
    (run.done ? run.description : run.status ?? run.description) ??
    run.label ??
    "Subagent";

  // A run in the background is not work the reader is waiting on: the tasks
  // indicator already says it is up, and a dev server would shimmer forever.
  const running = !run.done && !run.background;

  return (
    <button
      type="button"
      onClick={() => onOpen(run.id)}
      className="group flex w-full cursor-pointer items-center gap-2 text-left text-chat"
    >
      {/* **The run's own face.** The bot is derived from the agent the spawning
          call named, so a row says *which* subagent this is rather than only that
          one exists — and it animates while the run does, which is the one place
          the reader can see a child working without opening the panel.

          It stays after the run ends, unlike the orb this replaced: a still bot
          next to a finished run reads as the agent that ran, where a still orb
          read as something that stalled. */}
      <BloubAvatar
        name={run.label ?? detail}
        size={18}
        live={running}
        mood={running ? "working" : run.done ? "done" : "idle"}
      />

      <span
        className={cn(
          "min-w-0 max-w-fit truncate",
          running ? "shimmer-text" : "text-muted-foreground",
        )}
      >
        {detail}
      </span>

      <ChevronRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

export default memo(SubagentRow);
