import { describe, expect, it } from "vitest";

import { canFanOut, fanOutPlan, isFanOut, toggleFanOut } from "@/lib/fanOut";
import type { ModelId } from "@/types/events";

const GLM = "m:glm-5.3" as ModelId;
const DEEPSEEK = "m:deepseek-v4.1-flash" as ModelId;

describe("toggleFanOut", () => {
  /// Shift-click adds, shift-click again takes it back — and the *order* is what
  /// the sessions are created in, so the sidebar reads back the way the reader
  /// built it.
  it("keeps the order they were picked in", () => {
    let set = toggleFanOut([], GLM);
    set = toggleFanOut(set, DEEPSEEK);
    expect(set).toEqual([GLM, DEEPSEEK]);

    expect(toggleFanOut(set, GLM)).toEqual([DEEPSEEK]);
    expect(isFanOut(set, GLM)).toBe(true);
    expect(isFanOut(set, DEEPSEEK)).toBe(true);
  });

  /// Adding the same model twice is one session, not two: the id is the
  /// identity, and a second press says "again" about something already on.
  it("holds a model once", () => {
    expect(toggleFanOut(toggleFanOut([], GLM), GLM)).toEqual([]);
  });
});

describe("canFanOut", () => {
  /// One is the ordinary send. It matters that this is a separate branch: a
  /// single-model send adopts the parked child and honours the composer's
  /// worktree toggle, and a loop running once would quietly stop doing both.
  it("needs two", () => {
    expect(canFanOut([])).toBe(false);
    expect(canFanOut([GLM])).toBe(false);
    expect(canFanOut([GLM, DEEPSEEK])).toBe(true);
  });
});

describe("fanOutPlan", () => {
  /// **Every session takes a worktree, always.** These run at once, so several
  /// agents in one checkout would overwrite each other — the same reason
  /// `hz new` always takes one. The composer's toggle is not consulted.
  it("gives every session a worktree", () => {
    const plan = fanOutPlan(
      [
        { modelId: GLM, effort: "high" },
        { modelId: DEEPSEEK, effort: null },
      ],
      ["a", "b"],
    );

    expect(plan).toEqual([
      { sessionId: "a", model: GLM, effort: "high", useWorktree: true },
      { sessionId: "b", model: DEEPSEEK, effort: null, useWorktree: true },
    ]);
  });

  /// Each session carries the effort resolved for its *own* model: two models
  /// have two ladders, and the running model's pick says nothing about the other.
  it("keeps each model's own effort", () => {
    const plan = fanOutPlan(
      [
        { modelId: GLM, effort: "low" },
        { modelId: DEEPSEEK, effort: "max" },
      ],
      ["a", "b"],
    );

    expect(plan.map((request) => request.effort)).toEqual(["low", "max"]);
  });
});
