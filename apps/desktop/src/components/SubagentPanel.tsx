import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import BloubAvatar from "@/components/BloubAvatar";
import EventRow from "@/components/chat/EventRow";
import TurnBlock from "@/components/chat/TurnBlock";
import { Button } from "@/components/ui/button";
import { compactTokens } from "@/lib/format";
import { activeCount, isActive, memberFor, memberIdOf, statusWord } from "@/lib/subagent";
import { subagentBrief } from "@/lib/tools";
import { buildTranscript, type SubagentRun } from "@/lib/transcript";
import { useSubagentWork } from "@/hooks/useSubagentWork";
import { cn } from "@/lib/utils";
import type { AgentEvent, DelegatedMember, ToolResult } from "@/types/events";

/// A child's own nested subagents are not this panel's business: the roster
/// already lists every descendant of the root, so they arrive as rows here in
/// their own right rather than nested inside this one.
///
/// A module constant rather than a fresh literal, because `TurnBlock` is memoised
/// on prop identity — an empty map rebuilt every render would defeat that for
/// every row on screen at once.
const NO_SUBAGENTS = new Map<string, SubagentRun>();
const NOOP = () => {};

type SubagentPanelProps = {
  /// The session whose agent owns these runs. Empty for a composer that has not
  /// started one yet, which is why the reads below are gated on it.
  sessionId: string | null;
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

/// Every subagent in the session, one row each, expanding onto its own
/// conversation.
///
/// **A run opens onto that child's actual transcript — the same rows, drawn by the
/// same components.** A child is a session of its own, so what it did is a
/// conversation: prompts, reasoning, tool calls with their diffs, an answer. This
/// panel used to render a shape built for it, which could say no more than "a tool
/// ran" and was, in the reader's words, impossible to follow. Now the child's
/// session is read back in the app's own event vocabulary and handed to
/// [`TurnBlock`](TurnBlock) — so a subagent is legible for the same reason the
/// parent is.
///
/// **Three accounts of one run meet here.** The transcript supplies the spawning
/// call — the brief, the result, the row itself. The roster supplies liveness:
/// whether a child is *still* going, and the one control that stops them. And the
/// child's own session supplies the work, read while it runs.
export default function SubagentPanel({
  sessionId,
  runs,
  selectedId,
  resultByCallId,
  onSelect,
  members,
  onStopAll,
}: SubagentPanelProps) {
  const running = activeCount(members);

  // **The roster is what is read, not the runs.** A child is in the roster from
  // before its spawning call lands in the log, and that is precisely the window a
  // reader wants to watch it in.
  const memberIds = useMemo(() => members.map((member) => member.sessionId), [members]);
  const { messagesFor } = useSubagentWork(sessionId, memberIds, running > 0);

  // Whichever runs the roster accounted for, so the ones it did not are the only
  // rows the second list has to draw.
  const claimed = new Set(
    runs
      .map((run) => memberIdOf(run, members, resultByCallId.get(run.id)))
      .filter((id): id is string => id !== null),
  );
  const loose = members.filter((member) => !claimed.has(member.sessionId));

  if (runs.length === 0 && loose.length === 0) {
    return (
      <p className="px-3 py-6 text-ui text-muted-foreground">No subagents in this session.</p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {running > 0 && onStopAll && <StopAll count={running} onStopAll={onStopAll} />}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {runs.map((run) => {
          const memberId = memberIdOf(run, members, resultByCallId.get(run.id));
          return (
            <RunRow
              key={run.id}
              run={run}
              open={run.id === selectedId}
              member={memberFor(run, members)}
              // The run's own face, when the roster has no row for it yet — a
              // foreground child's call answers only at the end, so the roster's
              // label is the fallback and the run's is the floor.
              agentName={members.find((m) => m.sessionId === memberId)?.agentName ?? run.label}
              events={messagesFor(memberId)}
              resultByCallId={resultByCallId}
              onOpenSubagent={onSelect}
              onToggle={() => onSelect(run.id === selectedId ? null : run.id)}
            />
          );
        })}

        {loose.map((member) => (
          <LooseRow
            key={member.sessionId}
            member={member}
            events={messagesFor(member.sessionId)}
          />
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
/// Drawn flat with the three facts it has, plus one line of what the child is
/// saying: the row exists because the reader is watching it work, so making them
/// open something to see that would defeat it.
function LooseRow({ member, events }: { member: DelegatedMember; events: readonly AgentEvent[] }) {
  const title = member.task?.trim() || member.agentName?.trim() || "Subagent";
  const live = isActive(member);
  const said = lastSaid(events);

  return (
    <div className="flex flex-col gap-0.5 border-b border-border px-3 py-2.5 text-ui">
      <div className="flex items-center gap-2">
        <BloubAvatar
          name={member.agentName ?? title}
          size={18}
          live={live}
          mood={live ? "working" : member.status === "failed" ? "failed" : "idle"}
        />
        <span className={cn("min-w-0 flex-1 truncate", live && "shimmer-text")}>{title}</span>
        <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-xs text-muted-foreground">
          {statusWord(member.status)}
        </span>
      </div>
      {said && <p className="min-w-0 truncate pl-6 text-xs text-muted-foreground/70">{said}</p>}
    </div>
  );
}

/// The last thing the child said, as one line.
///
/// Read off the events rather than off a transcript, because a row wants this
/// without building one. The child's own first message is the brief the parent
/// wrote, so user rows are skipped: quoting the parent back under a row that
/// already draws the brief is the same sentence twice.
function lastSaid(events: readonly AgentEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]?.payload;
    if (payload?.type !== "assistant_text") continue;
    const text = payload.text.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return null;
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
  agentName,
  events,
  resultByCallId,
  onOpenSubagent,
  onToggle,
}: {
  run: SubagentRun;
  open: boolean;
  /// The roster row this run is, where one could be matched to it.
  member: DelegatedMember | null;
  /// The agent the spawning call named, for the row's own face.
  agentName: string | null;
  /// The child's own session, as events — empty until the first read lands.
  events: AgentEvent[];
  resultByCallId: Map<string, ToolResult>;
  onOpenSubagent: (id: string) => void;
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
  const hasContent =
    events.length > 0 || run.events.length > 0 || (run.spawn != null && hasBrief(run.spawn));

  // The roster's word beats the call's, where there is one: a background child's
  // call has already answered, so `run.done` is true while the work runs on.
  const live = member !== null && isActive(member);
  const said = live ? lastSaid(events) : null;

  return (
    <div ref={ref} className="border-b border-border">
      <div className="flex items-center transition-colors hover:bg-sidebar-accent/50">
        <button
          type="button"
          onClick={onToggle}
          disabled={!hasContent}
          className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left text-ui"
        >
          <span className="flex min-w-0 items-center gap-2">
            {hasContent && (
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-90",
                )}
              />
            )}

            {/* The bot *is* the run's face: its own agent, derived from the name
                the spawning call named. Live while the child is, so a list of
                running subagents is a row of things visibly working rather than
                a row of shimmers. */}
            <BloubAvatar
              name={agentName ?? detail}
              size={18}
              live={live}
              mood={live ? "working" : run.done ? "done" : "idle"}
            />

            {/* The shimmer stands in for the orb the chat row carries: at this text
                size the orb is taller than the row it sits in, and a list of them
                animating at once is the panel's loudest element.

                A run in the background is not work the reader is waiting on, so it
                settles — except where the roster says it is still going, which is
                the one account that outlives the call's own end. */}
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                live || (!run.done && !run.background)
                  ? "shimmer-text"
                  : "text-sidebar-foreground",
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
          </span>

          {/* What the child is saying, on the row, without opening anything. The
              whole point of watching a subagent is not having to go and look. */}
          {said && <span className="min-w-0 truncate pl-5 text-muted-foreground/70">{said}</span>}
        </button>
      </div>

      {open && hasContent && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-2.5">
          {/* **Only where there is no transcript to open onto.** A child's own
              session now arrives with its prompt as a bubble — the brief its
              parent wrote — so drawing it here as well put the same paragraph on
              screen twice, one above the other. This is what a run still has when
              nothing has been read: a harness whose child is not readable at all,
              or the first moment before the read lands. */}
          {events.length === 0 &&
            (brief ? (
              <p className="whitespace-pre-wrap text-ui text-sidebar-foreground">{brief}</p>
            ) : (
              run.spawn &&
              hasBrief(run.spawn) && (
                <EventRow event={run.spawn} resultByCallId={resultByCallId} openTool />
              )
            ))}

          {run.events.map((event) => (
            <EventRow key={event.id} event={event} resultByCallId={resultByCallId} />
          ))}

          {/* **The child's own conversation**, drawn by the transcript's own
              components — the same rows the parent's turn is drawn with, a ruler
              down the left to say whose work it is. */}
          <ChildTranscript events={events} live={live} onOpenSubagent={onOpenSubagent} />
        </div>
      )}
    </div>
  );
}

/// A delegated child's session, as a conversation.
///
/// **Nothing here is bespoke.** `buildTranscript` is the walk the chat runs over
/// its own events, and `TurnBlock` is the block the chat draws each turn with —
/// so a child's reasoning collapses, its tool calls group, its edits render as
/// diffs and its answer renders as markdown, because it is the same code looking
/// at the same vocabulary. The one thing this adds is the rule down the left,
/// which is what tells the reader they are looking at somebody else's work.
function ChildTranscript({
  events,
  live,
  onOpenSubagent,
}: {
  events: AgentEvent[];
  live: boolean;
  onOpenSubagent: (id: string) => void;
}) {
  // Keyed on the array, which the poll replaces rather than mutates — so this
  // walks once per read and not once per render.
  const transcript = useMemo(() => buildTranscript(events, live), [events, live]);

  if (events.length === 0) {
    return live ? (
      <p className="text-ui text-muted-foreground/70">Reading what it is working on…</p>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-3 border-l-2 border-border pl-3">
      {transcript.turns.map((turn) => (
        <TurnBlock
          key={turn.key}
          turn={turn}
          subagentById={NO_SUBAGENTS}
          resultByCallId={transcript.resultByCallId}
          editsByCallId={transcript.editsByCallId}
          todosByCallId={transcript.todosByCallId}
          onOpenSubagent={onOpenSubagent}
          onOpenSession={NOOP}
        />
      ))}
    </div>
  );
}
