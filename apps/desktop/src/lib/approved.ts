import type { AgentEvent } from "@/types/events";
import { toolArgument } from "@/lib/tools";
import { isToolGroup, type WorkItem } from "@/lib/transcript";

/// A call hz approved on the reader's behalf (the command reviewer, or a standing "always allow"), as the quiet
/// line under the turn draws it.
export type ApprovedLine = { key: string; what: string; command?: string; ts: string };

/// The turn's automatic approvals, oldest first, each with the command it let through. A decision the reader made
/// themselves draws nothing here: the card they pressed was the record of that one.
export function approvedOf(work: readonly WorkItem[]): ApprovedLine[] {
  const events: AgentEvent[] = work.flatMap((item) => (isToolGroup(item) ? item.calls : [item]));
  // The call's row can land after the decision that let it run, so every call is read first.
  const commandByCall = new Map<string, string>();
  for (const e of events) {
    if (e.payload.type !== "tool_call_started") continue;
    const arg = toolArgument(e.payload.input);
    if (arg) commandByCall.set(e.payload.callId, arg);
  }
  return events.flatMap((e) =>
    e.payload.type === "permission_decided" && e.payload.automatic
      ? [{ key: e.id, what: e.payload.label, command: commandByCall.get(e.payload.toolUseId), ts: e.ts }]
      : [],
  );
}
