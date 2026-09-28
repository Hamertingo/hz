import { describe, expect, it } from "vitest";

import { elapsedSeconds, goalBaseline } from "./goalClock";

describe("goalBaseline", () => {
  it("keeps the anchor it holds when the pushed figure has not moved", () => {
    // The case a remount walks into: the hook re-runs carrying the last figure
    // the runtime ever pushed, and the seconds counted since then have to survive
    // it. Restamping here is the bug — it reads as a goal losing time.
    const held = { seconds: 120, at: 1_000 };
    expect(goalBaseline(held, 120, 9_000)).toBe(held);
  });

  it("re-anchors when the runtime's own count moves", () => {
    expect(goalBaseline({ seconds: 120, at: 1_000 }, 180, 9_000)).toEqual({
      seconds: 180,
      at: 9_000,
    });
  });

  it("re-anchors on a figure that went backwards, which is still the runtime's", () => {
    expect(goalBaseline({ seconds: 180, at: 1_000 }, 120, 9_000)).toEqual({
      seconds: 120,
      at: 9_000,
    });
  });

  it("anchors a goal it has never seen", () => {
    expect(goalBaseline(undefined, 30, 5_000)).toEqual({ seconds: 30, at: 5_000 });
  });
});

describe("elapsedSeconds", () => {
  it("adds whole seconds since the anchor", () => {
    expect(elapsedSeconds({ seconds: 120, at: 1_000 }, 4_400)).toBe(123);
  });

  it("counts nothing before the anchor has aged a second", () => {
    // A push lands mid-second, and the band must not round up onto a figure the
    // runtime has not reported yet.
    expect(elapsedSeconds({ seconds: 120, at: 1_000 }, 1_999)).toBe(120);
  });

  it("never reads below the runtime's own figure", () => {
    // A local clock that stepped backwards between the push and the draw.
    expect(elapsedSeconds({ seconds: 120, at: 9_000 }, 1_000)).toBe(120);
  });
});
