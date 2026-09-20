import { describe, expect, it } from "vitest";

import { contextParts } from "@/lib/context";
import type { AgentEvent, AgentEventPayload } from "@/types/events";

/// One event of the shape the transcript holds. Every field the rule does not
/// read is a constant, so a case reads as the payload it is about.
function event(seq: number, payload: AgentEventPayload): AgentEvent {
  return {
    id: `e${seq}`,
    sessionId: "s",
    harness: "mcode",
    seq,
    ts: "2026-09-19T12:00:00.000Z",
    turnId: null,
    subagent: null,
    payload,
    raw: null,
  };
}

const text = (chars: number) => "x".repeat(chars);

describe("contextParts", () => {
  it("counts each part of the conversation, largest first", () => {
    const parts = contextParts(
      [
        event(1, { type: "user_message", text: text(400), images: [], issues: [], baseline: null, queued: false, from: null, cwd: null }),
        event(2, { type: "assistant_text", block: null, text: text(40) }),
        event(3, { type: "reasoning", block: null, text: text(120), encrypted: false }),
        event(4, { type: "tool_call_completed", callId: "c", result: { text: text(800), isError: false, structured: null, exitCode: null, durationMs: null, images: [] } }),
      ],
      10_000,
    );

    expect(parts.map((p) => p.label)).toEqual(["Tool output", "Messages", "Reasoning"]);
    expect(parts.map((p) => p.tokens)).toEqual([200, 110, 30]);
    expect(parts[0].share).toBeCloseTo(0.02);
  });

  /// The answer and the prompt are one thing to a reader asking what is in the
  /// window, and a tool's two halves are one row for the same reason.
  it("folds what reads as one thing into one row", () => {
    const parts = contextParts(
      [
        event(1, { type: "user_message", text: text(40), images: [], issues: [], baseline: null, queued: false, from: null, cwd: null }),
        event(2, { type: "assistant_text", block: null, text: text(40) }),
        event(3, {
          type: "tool_call_started",
          callId: "c",
          name: "Read",
          toolType: "file_read",
          input: { path: "/x" },
          rawInput: null,
          title: null,
        }),
        event(4, { type: "tool_call_completed", callId: "c", result: { text: text(40), isError: false, structured: null, exitCode: null, durationMs: null, images: [] } }),
      ],
      1_000,
    );

    expect(parts).toHaveLength(2);
    // 80 characters of prose, and the call's own arguments plus its output —
    // `{"path":"/x"}` is 14 of the 54 — both rounded up over four.
    expect(parts.find((p) => p.key === "messages")?.tokens).toBe(20);
    expect(parts.find((p) => p.key === "toolOutput")?.tokens).toBe(14);
  });

  /// A window of nothing draws no share rather than a division by nothing, and a
  /// part holding nothing is not a row.
  it("drops what holds nothing and never divides by nothing", () => {
    const empty = contextParts(
      [event(1, { type: "assistant_text", block: null, text: "" })],
      0,
    );

    expect(empty).toEqual([]);
  });

  /// The estimate is over-counted rather than under — see the note on
  /// `CHARS_PER_TOKEN` — so a part of one character still reads as one token.
  it("rounds a part that holds anything up to one token", () => {
    const parts = contextParts(
      [event(1, { type: "assistant_text", block: null, text: "x" })],
      100,
    );

    expect(parts[0].tokens).toBe(1);
  });
});
