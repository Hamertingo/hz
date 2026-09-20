import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import EventRow from "@/components/chat/EventRow";
import { Button } from "@/components/ui/button";
import { compactTokens } from "@/lib/format";
import { activeCount, isActive, memberFor, statusWord } from "@/lib/subagent";
import { subagentBrief } from "@/lib/tools";
import type { SubagentRun } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import type { AgentEvent, DelegatedMember, ToolResult } from "@/types/events";

type SubagentPanelProps = {
  runs: SubagentRun[];
  /// The expanded run, or null with everything collapsed. Owned by `App`
  /// because a click in the chat opens a run from outside this component.
  selectedId: string | null;
  resultByCallId: Map<string, ToolResult>;
  onSelect: (id: string | null) => void;
  /// The agent's live roster of what it delegated, for the status a run's own
  /// call cannot carry — a child's lifecycle never reaches this stream.
  members: DelegatedMember[];
  /// Stops every delegated run together, and answers the agent's refusal. The
  /// only stop there is: mcode publishes no per-task handle over ACP.
  onStopAll?: () => Promise<string | null>;
};

/// Every subagent in the session, one row each, expanding in place. A tab of
/// [RightPanel](./RightPanel.tsx), which owns the frame — this is the body only.
///
/// Shaped like [ChangesPanel](./ChangesPanel.tsx) rather than as a list above a
/// detail pane: a fixed-height list gave the runs a few rows to live in however
/// long the session was.
///
/// **Two accounts of the same runs, drawn as one list.** The transcript supplies
/// a run per spawning call — the brief, the result, the whole story. The agent's
/// roster supplies what that cannot: whether a child is *still going*, and the
/// one control that stops them. A member with no call behind it is still a thing
/// the agent is running, so it gets a row of its own rather than being dropped
/// for having no transcript to sit in.
export default function SubagentPanel({
  runs,
  selectedId,
  resultByCallId,
  onSelect,
  members,
  onStopAll,
}: SubagentPanelProps) {
  // Whichever runs the roster accounted for, so the ones it did not are the only
  // rows the second list has to draw.
  const claimed = new Set(
    runs
      .map((run) => memberFor(run, members)?.sessionId ?? null)
      .filter((id): id is string => id !== null),
  );
  const loose = members.filter((member) => !claimed.has(member.sessionId));
  const live = activeCount(members);

  if (runs.length === 0 && loose.length === 0) {
    return (
      <p className="px-3 py-6 text-ui text-muted-foreground">No subagents in this session.</p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {live > 0 && onStopAll && <StopAll count={live} onStopAll={onStopAll} />}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            open={run.id === selectedId}
            member={memberFor(run, members)}
            resultByCallId={resultByCallId}
            onToggle={() => onSelect(run.id === selectedId ? null : run.id)}
          />
        ))}

        {loose.map((member) => (
          <LooseRow key={member.sessionId} member={member} />
        ))}
      </div>
    </div>
  );
}

/// The one stop there is, stated as what it does rather than as what it is.
///
/// **A count, not a bare "Stop all".** The number is the whole of what the button
/// is about to end, and it is the only place the reader can see it before they
/// press — the rows below say what is running but not how much of it is.
function StopAll({
  count,
  onStopAll,
}: {
  count: number;
  onStopAll: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui text-muted-foreground">
          {count} {count === 1 ? "subagent is" : "subagents are"} still running
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          className="shrink-0 cursor-pointer"
          onClick={async () => {
            setBusy(true);
            setError(null);
            // The sentence goes here rather than to the composer: this panel may
            // belong to a split pane, and an error about one session written into
            // another's composer is worse than none.
            setError(await onStopAll());
            setBusy(false);
          }}
        >
          Stop all
        </Button>
      </div>

      {error && <p className="text-balance text-ui text-destructive">{error}</p>}
    </div>
  );
}

/// One run under the roster and no spawning call — a child whose `task` call has
/// not landed in the log yet, or one this build never saw announced.
///
/// Drawn flat: there is nothing to expand, because the whole of what is known
/// about it is the three facts on the row.
function LooseRow({ member }: { member: DelegatedMember }) {
  const title = member.task?.trim() || member.agentName?.trim() || "Subagent";

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border px-3 py-2.5 text-ui",
        isActive(member) && "shimmer-text",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-xs text-muted-foreground">
        {statusWord(member.status)}
      </span>
    </div>
  );
}

/// Whether the spawning call is worth a row of its own.
///
/// The row exists to show the brief the agent was given. Claude's `Task`
/// carries one; Codex's spawn carries the agent's name and nothing else, so
/// drawing it printed `spawn_agent read_footer` directly under a header
/// already reading `Read footer` — the same fact twice, in the one slot the
/// reader opened the run to read.
///
function hasBrief(spawn: AgentEvent): boolean {
  if (spawn.payload.type !== "tool_call_started") return false;
  const input = spawn.payload.input as Record<string, unknown> | null;
  const prompt = input?.prompt;
  if (typeof prompt === "string" && prompt.trim().length > 0) return true;
  // omp's `task` spawn briefs in `tasks[].task`, not `prompt` — Claude's word
  // for the same thing. Read either, so a spawn that briefed its agent draws
  // its brief whichever harness sent it.
  const tasks = input?.tasks;
  if (
    Array.isArray(tasks) &&
    tasks.some(
      (t) =>
        typeof (t as Record<string, unknown>)?.task === "string" &&
        ((t as Record<string, unknown>).task as string).trim().length > 0,
    )
  ) {
    return true;
  }
  // fx nests its brief a level down, and for an fx run this call is the whole
  // account there is — without it every delegated run here opens onto nothing.
  return subagentBrief(spawn.payload.input) !== null;
}

function RunRow({
  run,
  open,
  member,
  resultByCallId,
  onToggle,
}: {
  run: SubagentRun;
  open: boolean;
  /// The roster row this run is, where one could be matched to it.
  member: DelegatedMember | null;
  resultByCallId: Map<string, ToolResult>;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Opening a run from the chat scrolls it into view — the panel keeps its own
  // scroll position across sessions and tabs, so the row a click just opened is
  // routinely off-screen. `nearest` leaves an already-visible row where it is.
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const detail =
    (run.done ? run.description : run.status ?? run.description) ??
    run.label ??
    "Subagent";

  const tokens = run.usage?.totalTokens ?? null;

  // The brief a harness nests rather than streams. fx files it under `request`;
  // mcode's `task` puts it at the top level as `prompt`, beside the role the
  // child runs as. Either is the spec the child was handed — the whole of what
  // the reader opened the row to read — and `hasBrief` above already agrees with
  // both, so a brief it accepts is one this draws.
  const brief = (() => {
    if (run.spawn?.payload.type !== "tool_call_started") return null;
    const nested = subagentBrief(run.spawn.payload.input)?.task ?? null;
    if (nested) return nested;
    const input = run.spawn.payload.input as Record<string, unknown> | null;
    const prompt = input?.prompt;
    return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : null;
  })();

  // A run whose spawn carries no brief and which has filed no events of its own
  // expands onto an empty box. Events arrive as it works, so this flips back on
  // by itself.
  const hasContent = run.events.length > 0 || (run.spawn != null && hasBrief(run.spawn));

  // The roster's word beats the call's, where there is one: a background child's
  // call has already answered, so `run.done` is true while the work runs on.
  const live = member !== null && isActive(member);

  return (
    <div ref={ref} className="border-b border-border">
      <div className="flex items-center transition-colors hover:bg-sidebar-accent/50">
        <button
          type="button"
          onClick={onToggle}
          disabled={!hasContent}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-ui"
        >
          {hasContent && (
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
          )}

          {/* The shimmer stands in for the orb the chat row carries: at this text
              size the orb is taller than the row it sits in, and a list of them
              animating at once is the panel's loudest element.

              A run in the background is not work the reader is waiting on, so it
              settles — except where the roster says it is still going, which is
              the one account that outlives the call's own end. */}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              live || (!run.done && !run.background) ? "shimmer-text" : "text-sidebar-foreground",
            )}
          >
            {detail}
          </span>

          {live && member && (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-xs text-muted-foreground">
              {statusWord(member.status)}
            </span>
          )}

          {tokens != null && (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {compactTokens(tokens)}
            </span>
          )}
        </button>
      </div>

      {open && hasContent && (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5">
          {/* The spawning call first: its arguments are the prompt this run was
              given, and its result the report it came back with. For a
              background `Bash` it is the *only* content there is — such a task
              files no events of its own, so without this the row opened onto
              nothing. Expanded on arrival: it is what the reader opened the run
              for, and a second click to reach it reveals nothing they hadn't
              already asked for. */}
          {/* A run whose whole account is the brief it was given draws that
              brief, as text. The spawning call's own row would do it too, but
              it comes with a caret of its own — a second thing to open inside
              the pane the reader has just opened — and with a tool name and a
              report beside it, where the row above is already the one and the
              other is the agent's to relay. */}
          {brief ? (
            <p className="whitespace-pre-wrap text-ui text-sidebar-foreground">{brief}</p>
          ) : (
            run.spawn &&
            hasBrief(run.spawn) && (
              <EventRow event={run.spawn} resultByCallId={resultByCallId} openTool />
            )
          )}

          {run.events.map((event) => (
            <EventRow key={event.id} event={event} resultByCallId={resultByCallId} />
          ))}
        </div>
      )}
    </div>
  );
}
