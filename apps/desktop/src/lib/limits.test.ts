import { describe, expect, it } from "vitest";

import { csvFileName, isWarn, litCells, parseUsd, pctText, resetNote, untilReset } from "@/lib/limits";
import type { LimitWindow } from "@/types/events";

const win = (over: Partial<LimitWindow> = {}): LimitWindow => ({
  key: "fiveHour",
  label: "5-hour window",
  usedPct: 62,
  resetsAtMs: null,
  estimated: false,
  ...over,
});

describe("untilReset", () => {
  const now = 1_000_000_000_000;
  it("counts down in the largest sensible units", () => {
    expect(untilReset(now + 35 * 60_000, now)).toBe("35m");
    expect(untilReset(now + (2 * 60 + 41) * 60_000, now)).toBe("2h 41m");
    expect(untilReset(now + (52 * 60) * 60_000, now)).toBe("2d 4h");
  });
  it("is null once the moment has passed", () => {
    expect(untilReset(now - 1, now)).toBeNull();
    expect(untilReset(now + 20_000, now)).toBeNull();
  });
});

describe("resetNote", () => {
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);
  it("says the window resets in hours when it is soon", () => {
    expect(resetNote([win({ resetsAtMs: now + 3 * 3_600_000 })], now)).toBe("window resets in 3h 0m");
  });
  it("names the weekday when it is days away, using the soonest window", () => {
    const far = now + 3 * 86_400_000;
    const note = resetNote([win({ resetsAtMs: far + 86_400_000 }), win({ resetsAtMs: far })], now);
    expect(note).toBe(`resets ${new Date(far).toLocaleDateString("en-US", { weekday: "long" })}`);
  });
  it("is empty with no reset to name", () => {
    expect(resetNote([win()], now)).toBe("");
    expect(resetNote([], now)).toBe("");
  });
});

describe("a window's figure", () => {
  it("marks an estimate and never turns a missing number into zero", () => {
    expect(pctText(win())).toBe("62%");
    expect(pctText(win({ estimated: true, usedPct: 41.6 }))).toBe("~42%");
    expect(pctText(win({ usedPct: null }))).toBe("—");
    expect(litCells(null)).toBe(0);
  });
  it("warns from 80 percent", () => {
    expect(isWarn(win({ usedPct: 79 }))).toBe(false);
    expect(isWarn(win({ usedPct: 84 }))).toBe(true);
    expect(isWarn(win({ usedPct: null }))).toBe(false);
  });
  it("lights cells in proportion and clamps", () => {
    expect(litCells(62)).toBe(19);
    expect(litCells(150)).toBe(30);
    expect(litCells(-5)).toBe(0);
  });
});

describe("money and files", () => {
  it("reads a typed dollar amount", () => {
    expect(parseUsd("US$ 150")).toBe(150);
    expect(parseUsd("2.50")).toBe(2.5);
    expect(parseUsd("")).toBeNull();
    expect(parseUsd("0")).toBeNull();
  });
  it("names the export for its month", () => {
    expect(csvFileName(new Date(2026, 9, 5))).toBe("hz-usage-2026-10.csv");
  });
});
