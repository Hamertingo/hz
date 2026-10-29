import { describe, expect, it } from "vitest";

import {
  isFolded,
  lastBoundary,
  messageKey,
  withBoundary,
  withHidden,
  withoutHidden,
} from "./chatMarks";

describe("tombstones", () => {
  it("hides once however many times it is asked", () => {
    expect(withHidden(withHidden([], "s:a"), "s:a")).toEqual(["s:a"]);
  });

  it("restores exactly the one that was hidden", () => {
    expect(withoutHidden(["s:a", "s:b"], "s:a")).toEqual(["s:b"]);
    expect(withoutHidden(["s:b"], "s:a")).toEqual(["s:b"]);
  });

  it("keys a message by its session and event", () => {
    expect(messageKey("s1", "e9")).toBe("s1:e9");
  });
});

describe("pages", () => {
  const at = (seq: number) => ({ seq, ts: "2026-10-23T10:00:00Z" });

  it("keeps boundaries in order, one per seq", () => {
    const list = withBoundary(withBoundary(withBoundary([], at(40)), at(10)), at(40));
    expect(list.map((b) => b.seq)).toEqual([10, 40]);
    expect(lastBoundary(list)?.seq).toBe(40);
  });

  it("folds what is above the newest boundary and nothing else", () => {
    const list = [at(10), at(40)];
    expect(isFolded(39, list, false)).toBe(true);
    expect(isFolded(40, list, false)).toBe(false);
    expect(isFolded(41, list, false)).toBe(false);
  });

  it("shows everything when earlier pages are asked for, or none was cleared", () => {
    expect(isFolded(1, [at(40)], true)).toBe(false);
    expect(isFolded(1, [], false)).toBe(false);
  });
});
