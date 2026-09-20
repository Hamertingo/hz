import { describe, expect, it } from "vitest";

import { lastTurn, secondOpinionPrompt } from "@/lib/secondOpinion";
import type { AgentEvent } from "@/types/events";

describe("lastTurn", () => {
  /// Payloads only: `lastTurn` reads nothing else, and building a whole
  /// `AgentEvent` to reach one field would be nine fields of noise per row.
  const event = (payload: object) => ({ payload }) as unknown as AgentEvent;
  const prompt = (text: string) => event({ type: "user_message", text });
  const answer = (text: string) => event({ type: "assistant_text", text });
  const other = () => event({ type: "model_request_started" });

  it("takes the newest prompt and the answer after it", () => {
    const turn = lastTurn([prompt("first"), answer("a"), prompt("second"), answer("b")]);
    expect(turn).toEqual({ request: "second", report: "b" });
  });

  // The trap this walk exists for: a turn with no answer yet must not borrow the
  // previous turn's, which reads as a coherent brief about the wrong work.
  it("does not reach back past the newest prompt for a report", () => {
    const turn = lastTurn([prompt("first"), answer("about the first one"), prompt("second")]);
    expect(turn).toEqual({ request: "second", report: "" });
  });

  it("takes the last thing said when a turn had several blocks", () => {
    const turn = lastTurn([prompt("only"), answer("one"), other(), answer("two")]);
    expect(turn.report).toBe("two");
  });

  it("answers nothing at all before a first prompt", () => {
    expect(lastTurn([other(), other()])).toEqual({ request: "", report: "" });
    expect(lastTurn([])).toEqual({ request: "", report: "" });
  });
});

describe("secondOpinionPrompt", () => {
  const base = { request: "add a retry to the uploader", report: "Added a retry." };

  it("carries both halves of the turn", () => {
    const prompt = secondOpinionPrompt(base);
    expect(prompt).toContain("add a retry to the uploader");
    expect(prompt).toContain("Added a retry.");
  });

  // The agent's own account is the thing worth a second look, so the prompt has
  // to say out loud that it is a claim rather than evidence.
  it("tells the reviewer not to trust the summary", () => {
    const prompt = secondOpinionPrompt(base);
    expect(prompt).toMatch(/not evidence/i);
  });

  it("says which of the two is missing rather than quoting an empty block", () => {
    const prompt = secondOpinionPrompt({ request: "  ", report: "" });
    expect(prompt).toContain("(not recorded)");
    expect(prompt).toContain("(it gave no summary");
    expect(prompt).not.toMatch(/\n\n\n\n/);
  });

  it("trims the sections it is given", () => {
    const prompt = secondOpinionPrompt({ request: "\n\nhello\n\n", report: "\n world \n" });
    expect(prompt).toContain("\nhello\n");
    expect(prompt).toContain("\nworld\n");
  });

  // A long turn dumps its whole answer into the summary. Cutting it is the cap's
  // job; **marking** it is the part that matters, since a reviewer reading a
  // sentence that stops mid-way will assume the agent stopped there.
  it("marks a section it had to cut", () => {
    const prompt = secondOpinionPrompt({ request: "x".repeat(10_000), report: "done" });
    expect(prompt).toContain("…(truncated)");
    expect(prompt.length).toBeLessThan(10_000);
  });
});
