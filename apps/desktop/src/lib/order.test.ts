import { describe, expect, it } from "vitest";

import { applyOrder, isAfter, moveBy, moveRelative, readSections, toFront } from "@/lib/order";

const items = ["a", "b", "c", "d"].map((id) => ({ id }));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("applyOrder", () => {
  it("puts named ids first and keeps the rest where they were", () => {
    expect(ids(applyOrder(items, ["c", "a"]))).toEqual(["c", "a", "b", "d"]);
  });
  it("skips ids that are gone and leaves an empty order alone", () => {
    expect(ids(applyOrder(items, ["x", "d"]))).toEqual(["d", "a", "b", "c"]);
    expect(ids(applyOrder(items, []))).toEqual(["a", "b", "c", "d"]);
  });
  it("lists a repeated id once", () => {
    expect(ids(applyOrder(items, ["b", "b"]))).toEqual(["b", "a", "c", "d"]);
  });
});

describe("moveRelative", () => {
  const list = ["a", "b", "c", "d"];
  it("moves before and after a target, either direction", () => {
    expect(moveRelative(list, "a", "c", false)).toEqual(["b", "a", "c", "d"]);
    expect(moveRelative(list, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
    expect(moveRelative(list, "d", "a", false)).toEqual(["d", "a", "b", "c"]);
    expect(moveRelative(list, "b", "d", true)).toEqual(["a", "c", "d", "b"]);
  });
  it("ignores itself and strangers", () => {
    expect(moveRelative(list, "a", "a", true)).toEqual(list);
    expect(moveRelative(list, "a", "z", true)).toEqual(list);
  });
});

describe("moveBy and toFront", () => {
  it("steps one place and stops at the ends", () => {
    expect(moveBy(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveBy(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveBy(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });
  it("puts an id first, adding it when absent", () => {
    expect(toFront(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(toFront(["a"], "z")).toEqual(["z", "a"]);
  });
});

describe("isAfter", () => {
  it("is the lower half of a row", () => {
    expect(isAfter(110, 100, 30)).toBe(false);
    expect(isAfter(120, 100, 30)).toBe(true);
  });
});

describe("readSections", () => {
  it("keeps a valid order and falls back to channels first", () => {
    expect(readSections(["agents", "channels"])).toEqual(["agents", "channels"]);
    expect(readSections([])).toEqual(["channels", "agents"]);
    expect(readSections(["agents", "agents"])).toEqual(["channels", "agents"]);
  });
  it("moves a section with the same row math", () => {
    expect(moveRelative(readSections([]), "agents", "channels", false)).toEqual(["agents", "channels"]);
    expect(moveBy(["channels", "agents"], "channels", 1)).toEqual(["agents", "channels"]);
  });
});
