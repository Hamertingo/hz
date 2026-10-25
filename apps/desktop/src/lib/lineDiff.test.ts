import { describe, expect, it } from "vitest";

import { lineDiff, withContext } from "./lineDiff";

describe("instruction diff", () => {
  it("marks what was added and what was dropped", () => {
    const rows = lineDiff("a\nb\nc", "a\nx\nc\nd");
    expect(rows).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "x" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  it("is all same for equal texts", () => {
    expect(lineDiff("a\nb", "a\nb").every((r) => r.kind === "same")).toBe(true);
  });

  it("folds long unchanged runs", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l10", "changed");
    const rows = withContext(lineDiff(before, after), 1);
    expect(rows.some((r) => r.kind === "gap")).toBe(true);
    expect(rows.filter((r) => r.kind === "add")).toHaveLength(1);
    expect(rows.length).toBeLessThan(10);
  });
});
