import { describe, expect, it } from "vitest";

import { EMPTY_VISITS, prune, step, visit } from "@/lib/tabVisitHistory";

const all = (...ids: string[]) => new Set(ids);

describe("visit", () => {
  it("pushes the session arrived at and leaves the cursor on it", () => {
    const h = visit(visit(EMPTY_VISITS, "a"), "b");
    expect(h.trail).toEqual(["a", "b"]);
    expect(h.at).toBe(1);
  });

  // A re-render, a rollback, an effect that runs twice — none of them are the
  // reader going somewhere, and a duplicate in the trail is a ⌘[ that appears to
  // do nothing.
  it("ignores an arrival at the session already at the cursor", () => {
    const h = visit(EMPTY_VISITS, "a");
    expect(visit(h, "a")).toBe(h);
  });

  it("truncates the forward tail when the reader opens somewhere new", () => {
    const back = visit(visit(visit(EMPTY_VISITS, "a"), "b"), "c");
    const stepped = step(back, -1, all("a", "b", "c"));
    expect(stepped?.to).toBe("b");

    const fresh = visit(stepped!.history, "d");
    expect(fresh.trail).toEqual(["a", "b", "d"]);
    // "c" was the way forward and is gone: the branch was left.
    expect(step(fresh, 1, all("a", "b", "c", "d"))).toBeNull();
  });
});

describe("step", () => {
  const trail = visit(visit(visit(EMPTY_VISITS, "a"), "b"), "c");

  it("moves one entry each way", () => {
    expect(step(trail, -1, all("a", "b", "c"))?.to).toBe("b");
    expect(step(trail, 1, all("a", "b", "c"))).toBeNull();
  });

  it("stops at the start rather than wrapping", () => {
    const atStart = step(step(trail, -1, all("a", "b", "c"))!.history, -1, all("a", "b", "c"));
    expect(atStart?.to).toBe("a");
    expect(step(atStart!.history, -1, all("a", "b", "c"))).toBeNull();
  });

  // A trail outlives the sessions in it. Landing on a deleted one would put the
  // reader through the "Session not found" rollback on a key they pressed to go
  // somewhere.
  it("steps over a session that is gone", () => {
    const h = step(trail, -1, all("a", "c"));
    expect(h?.to).toBe("a");
    expect(h?.history.at).toBe(0);
  });

  it("answers null when every way on is dead", () => {
    expect(step(trail, -1, all("c"))).toBeNull();
  });
});

describe("prune", () => {
  it("returns the same object when nothing is dead", () => {
    const h = visit(EMPTY_VISITS, "a");
    expect(prune(h, all("a"))).toBe(h);
  });

  it("drops the dead and keeps the cursor on the same session", () => {
    const h = visit(visit(visit(EMPTY_VISITS, "a"), "b"), "c");
    const kept = prune(h, all("a", "c"));
    expect(kept.trail).toEqual(["a", "c"]);
    expect(kept.trail[kept.at]).toBe("c");
  });

  it("lands on the newest survivor when the cursor's own session is gone", () => {
    const h = visit(visit(EMPTY_VISITS, "a"), "b");
    const kept = prune(h, all("a"));
    expect(kept.trail).toEqual(["a"]);
    expect(kept.at).toBe(0);
  });
});
