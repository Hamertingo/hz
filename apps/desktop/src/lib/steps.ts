import { formatDuration } from "@/lib/format";
import { groupVerb, teamTool, toolLabel, toolSummary } from "@/lib/tools";
import { isToolGroup, type WorkItem } from "@/lib/transcript";
import type { AgentEvent, ToolResult } from "@/types/events";
import type { JsonValue } from "@/types/serde_json/JsonValue";

/// One line of "See what it did": a verb, what it acted on, how long it took.
export type TraceStep = {
  key: string;
  verb: string;
  target: string | null;
  /// Wall time of the call, or `null` where neither the result nor the two
  /// timestamps could say.
  ms: number | null;
  failed: boolean;
};

/// How long each tool call took, by call id.
///
/// The result's own `durationMs` wins where the harness measured it. The rest are
/// the gap between the call's event and its result's, which includes the time the
/// transport sat on the line — a little long, never short.
export function timingsOf(events: readonly AgentEvent[]): Map<string, number> {
  const started = new Map<string, number>();
  const out = new Map<string, number>();
  for (const e of events) {
    const p = e.payload;
    if (p.type === "tool_call_started") {
      const at = Date.parse(e.ts);
      if (!Number.isNaN(at)) started.set(p.callId, at);
    } else if (p.type === "tool_call_completed") {
      if (p.result.durationMs != null) {
        out.set(p.callId, p.result.durationMs);
        continue;
      }
      const from = started.get(p.callId);
      const to = Date.parse(e.ts);
      if (from !== undefined && !Number.isNaN(to) && to >= from) out.set(p.callId, to - from);
    }
  }
  return out;
}

function argOf(input: JsonValue, key: string): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const v = (input as Record<string, JsonValue>)[key];
  return typeof v === "string" ? v : null;
}

function stepFor(
  e: AgentEvent,
  resultByCallId: ReadonlyMap<string, ToolResult>,
  timings: ReadonlyMap<string, number>,
): TraceStep | null {
  const p = e.payload;
  if (p.type !== "tool_call_started") return null;
  const result = resultByCallId.get(p.callId);
  const base = { key: e.id, ms: timings.get(p.callId) ?? null, failed: result?.isError === true };

  const team = teamTool(p.name);
  if (team === "team_list") return { ...base, verb: "Looked up", target: "the team" };
  if (team) {
    const to = argOf(p.input, "to");
    return { ...base, verb: team === "team_ask" ? "Asked" : "Messaged", target: to };
  }

  const done = result !== undefined;
  const verb = p.toolType === "shell" ? groupVerb(p.name, !done) : toolLabel(p.name, !done);
  return { ...base, verb, target: toolSummary(p.name, p.toolType, p.input) ?? p.title };
}

/// The steps of a turn's work, one per tool call in the order they ran, groups
/// opened up. Reasoning and the agent's own words are not steps.
export function traceOf(
  work: readonly WorkItem[],
  resultByCallId: ReadonlyMap<string, ToolResult>,
  timings: ReadonlyMap<string, number>,
): TraceStep[] {
  const steps: TraceStep[] = [];
  for (const item of work) {
    const events = isToolGroup(item) ? item.calls : [item];
    for (const e of events) {
      const step = stepFor(e, resultByCallId, timings);
      if (step) steps.push(step);
    }
  }
  return steps;
}

/// "0.4s", "24.0s" — the column the step list ends in; empty without a reading.
export function stepTime(ms: number | null): string {
  return ms === null ? "" : formatDuration(ms);
}

/// When the turn now running began: the newest prompt the reader sent. `null` for
/// a log with none, which draws the working pill without a clock.
export function lastPromptAt(events: readonly AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const p = events[i].payload;
    if (p.type === "user_message" && !p.queued && p.from === null) return events[i].ts;
  }
  return null;
}
