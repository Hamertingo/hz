import { CircleCheck } from "lucide-react";

import { compactTokens, formatElapsed } from "@/lib/format";

/// The line a finished goal leaves in the conversation.
///
/// **Written for a turn nobody watched.** A goal's autonomous turns put no
/// message, thought or tool content on the wire at all — measured against
/// 0.4.12: one wrote a file and reached `complete` while sending only
/// `goal_update`, `usage_update` and `session_info_update` — so this line is the
/// only trace the work leaves here, and the vendor's own TUI writes the same one
/// into its transcript for the same reason.
///
/// It names the objective, because a count with nothing beside it says a goal
/// happened without saying which: a session can run several in a row, and the
/// reader's question at this line is *what* finished.
export default function GoalReceipt({
  objective,
  tokensUsed,
  turnsUsed,
  timeUsedSeconds,
}: {
  objective: string;
  tokensUsed: number;
  turnsUsed: number;
  timeUsedSeconds: number;
}) {
  return (
    <div className="flex items-center gap-2 text-ui text-muted-foreground">
      <CircleCheck className="size-3.5 shrink-0 text-accent-add" />
      <span className="shrink-0">
        Goal complete · {formatElapsed(timeUsedSeconds * 1_000)} ·{" "}
        {compactTokens(tokensUsed)} tokens · {turnsUsed === 1 ? "1 turn" : `${turnsUsed} turns`}
      </span>
      {/* The objective truncates rather than wraps: this is a rule between two
          turns, and a two-line rule reads as the next turn's heading. */}
      {objective && <span className="truncate opacity-70">{objective}</span>}
    </div>
  );
}
