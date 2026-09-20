import { describe, expect, it } from "vitest";

import { recallMove, recalledPrompts, recallText, type Recall } from "@/lib/recall";
import type { AgentEvent } from "@/types/events";

const HISTORY = ["first", "second", "third"];

function prompt(text: string, from: { sessionId: string; title: string } | null = null): AgentEvent {
  return {
    id: `e${text}`,
    sessionId: "s",
    seq: 0,
    ts: "2026-09-19T00:00:00.000Z",
    payload: { type: "user_message", text, from },
  } as unknown as AgentEvent;
}

describe("recalledPrompts", () => {
  /// The transcript is the history, so the order it is walked in is the order it
  /// was written in — a resume starts with yesterday's prompts already in it,
  /// which is the case this feature exists for.
  it("collects what the reader sent, oldest first", () => {
    const events = [
      prompt("one"),
      prompt("", null),
      prompt("  "),
      prompt("two"),
      { ...prompt("not a prompt"), payload: { type: "turn_completed" } } as AgentEvent,
    ];
    // The blank prompt is dropped and the non-message event ignored rather than
    // walking into an empty box with a live caret.
    expect(recalledPrompts([events[0], events[2], prompt("two"), prompt("three")])).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("leaves a relayed prompt out", () => {
    const relayed = prompt("from a child", { sessionId: "other", title: "Reviewer" });
    expect(recalledPrompts([prompt("mine"), relayed])).toEqual(["mine"]);
  });
});

describe("recallMove", () => {
  /// An empty box is the only way in: with something typed, the arrows are the
  /// reader moving around their own sentence.
  it("walks back from an empty box", () => {
    expect(recallMove(HISTORY, null, "", "down")).toBeNull();
    expect(recallMove(HISTORY, null, "typed", "up")).toBeNull();

    const first = recallMove(HISTORY, null, "", "up");
    expect(first).toEqual({ state: 2, text: "third" });

    const second = recallMove(HISTORY, first!.state, first!.text, "up");
    expect(second).toEqual({ state: 1, text: "second" });
  });

  /// The bottom of the walk. Wrapping round would be a loop with no end, and the
  /// key has a second job — moving the caret — that it can fall back to.
  it("stops at the oldest prompt", () => {
    expect(recallMove(HISTORY, 0, "first", "up")).toBeNull();
  });

  it("walks forward again and clears past the newest", () => {
    const forward = recallMove(HISTORY, 0, "first", "down");
    expect(forward).toEqual({ state: 1, text: "second" });

    const past = recallMove(HISTORY, 2, "third", "down");
    expect(past).toEqual({ state: 3, text: "" });
    expect(recallText(HISTORY, past!.state)).toBe("");

    // And it stops there rather than cycling back into the history.
    expect(recallMove(HISTORY, past!.state, past!.text, "down")).toBeNull();
  });

  /// Editing a recalled prompt makes it a draft, and the walk lets go of it —
  /// otherwise the next arrow would silently replace what the reader just wrote.
  it("lets go of a prompt that has been edited", () => {
    expect(recallMove(HISTORY, 2, "third and a bit", "up")).toBeNull();
    expect(recallMove(HISTORY, 1, "something else", "down")).toBeNull();
  });

  it("does nothing with no history", () => {
    const state: Recall = null;
    expect(recallMove([], state, "", "up")).toBeNull();
  });
});
