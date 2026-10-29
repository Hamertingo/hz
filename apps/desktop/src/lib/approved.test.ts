import { describe, expect, it } from "vitest";

import { approvedOf } from "@/lib/approved";
import type { AgentEvent, AgentEventPayload } from "@/types/events";

function event(seq: number, payload: AgentEventPayload): AgentEvent {
  return { id: `e-${seq}`, sessionId: "s", harness: "claude-acp", seq, ts: "2026-10-26T10:00:00Z", turnId: null, subagent: null, payload, raw: null } as AgentEvent;
}

const decided = (seq: number, callId: string, automatic: boolean) =>
  event(seq, { type: "permission_decided", requestId: String(seq), toolUseId: callId, behavior: "allow", label: "Read-only command", automatic } as AgentEventPayload);

const call = (seq: number, callId: string, command: string) =>
  event(seq, { type: "tool_call_started", callId, name: "Bash", toolType: "shell", input: { command }, rawInput: null, title: null } as AgentEventPayload);

describe("approved lines", () => {
  it("draws each automatic approval with its command, whichever arrived first", () => {
    const lines = approvedOf([call(1, "c1", "ls -la"), decided(2, "c1", true), decided(3, "c2", true), call(4, "c2", "git status")]);
    expect(lines.map((l) => [l.what, l.command])).toEqual([
      ["Read-only command", "ls -la"],
      ["Read-only command", "git status"],
    ]);
  });

  it("leaves out what the reader decided on a card", () => {
    expect(approvedOf([call(1, "c1", "rm x"), decided(2, "c1", false)])).toEqual([]);
  });
});
