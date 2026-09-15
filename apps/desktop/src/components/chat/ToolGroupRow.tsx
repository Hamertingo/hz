import { useMemo } from "react";
import { Globe } from "lucide-react";

import AgentTrace from "@/components/chat/AgentTrace";
import EventRow from "@/components/chat/EventRow";
import { countChanges, editSides } from "@/lib/diff";
import { groupLabel, groupVerb } from "@/lib/tools";
import type { ToolGroup } from "@/lib/transcript";
import type { FileEdit, ToolResult } from "@/types/events";

/// A run of consecutive same-tool calls behind one trace header. Expanding
/// reveals the individual calls, each still its own expandable `ToolCall`.
export default function ToolGroupRow({
  group,
  resultByCallId,
  editsByCallId,
}: {
  group: ToolGroup;
  resultByCallId: Map<string, ToolResult>;
  editsByCallId?: Map<string, FileEdit[]>;
}) {
  // Any call still awaiting its result keeps the group live, so a run that
  // settles mid-flight still shimmers.
  const pending = group.calls.some(
    (event) =>
      event.payload.type === "tool_call_started" &&
      !resultByCallId.has(event.payload.callId),
  );

  // A run of web lookups is a search, and reads as one: "Searched the web"
  // over the queries it ran. Every other run is work on the repository, which
  // is what the coding trace is for. Decided off the harness's own `tool_type`
  // rather than off tool names, since only the mapper knows what a name means.
  const searching = group.calls.every((event) =>
    event.payload.type === "tool_call_started"
      ? event.payload.toolType === "web"
      : true,
  );

  // The run's total `+N -M`, summed from the same per-call counts the rows
  // underneath show, so the header can never disagree with what expanding it
  // reveals. Without this a run of edits collapses to "Edited 1 file · 4 calls"
  // — the count says something happened four times and nothing says how much
  // changed, which is the one number the reader wanted from a collapsed diff.
  //
  // Summing per-call fragment diffs is deliberate. An `Edit` diffs its replaced
  // region rather than the file, so these are region counts and adding them
  // gives the run's total churn — not what `git --stat` would report against the
  // file's original, which no call in the group carries.
  //
  // Keyed on the call count rather than on `calls`: a committed call's input is
  // immutable, so a run can only ever grow, and re-parsing every diff in the
  // group on each of a streaming turn's renders is the cost this avoids.
  const changes = useMemo(() => {
    let added = 0;
    let removed = 0;
    let any = false;

    for (const event of group.calls) {
      const { payload } = event;
      // `rawInput` means the call never parsed as JSON, so there is nothing to
      // diff — it is dropped from the sum rather than counted as zero.
      if (payload.type !== "tool_call_started") continue;
      if (payload.toolType !== "file_edit" || payload.rawInput) continue;

      const sides = editSides(payload.input);
      if (!sides) continue;

      const count = countChanges(sides);
      added += count.added;
      removed += count.removed;
      any = true;
    }

    return any ? { added, removed } : null;
  }, [group.key, group.calls.length]);

  // One target names it instead of counting to one, so the header reads like the
  // rows underneath — same mono, same truncation. Both tenses are built here
  // rather than conjugated after the fact: `groupVerb` is the only thing that
  // knows how a tool conjugates.
  const active = group.target
    ? `${groupVerb(group.name, true)} ${group.target}`
    : groupLabel(group.name, group.targets, true);

  // The churn rides the header text rather than a separate slot, because the
  // trace header is one sentence and a second column beside it would be read as
  // a second fact about something else.
  const done = `${
    group.target
      ? `${groupVerb(group.name, false)} ${group.target}`
      : groupLabel(group.name, group.targets, false)
  }${changes && (changes.added > 0 || changes.removed > 0) ? ` · +${changes.added} -${changes.removed}` : ""}`;

  return (
    <AgentTrace
      // A run of searches is the one trace that is not the agent's own work on
      // the repository, so it gets the globe.
      icon={searching ? <Globe className="size-3.5" /> : undefined}
      active={active}
      done={done}
      working={pending}
      rows={group.calls.map((event) => (
        <EventRow
          key={event.id}
          event={event}
          resultByCallId={resultByCallId}
          editsByCallId={editsByCallId}
          hideToolLabel
        />
      ))}
    />
  );
}
