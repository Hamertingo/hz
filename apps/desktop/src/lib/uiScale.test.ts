import { describe, expect, it } from "vitest";

import { coerceUiScale, nextUiScale, UI_SCALE_MAX, UI_SCALE_MIN } from "@/lib/uiScale";

describe("coerceUiScale", () => {
  it("falls back to actual size for anything that is not a number", () => {
    expect(coerceUiScale(null)).toBe(1);
    expect(coerceUiScale("1.5")).toBe(1);
    expect(coerceUiScale(Number.NaN)).toBe(1);
    expect(coerceUiScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("clamps rather than wrapping", () => {
    expect(coerceUiScale(0.1)).toBe(UI_SCALE_MIN);
    expect(coerceUiScale(9)).toBe(UI_SCALE_MAX);
  });

  // Every write goes through this, including the chords' arithmetic, because
  // 1.1 + 0.1 is 1.2000000000000002 in binary floating point — and a value off
  // the ladder shows as 120% in one place and 120.00000000000001% in another.
  it("keeps the value on the tenths ladder", () => {
    expect(coerceUiScale(1.2000000000000002)).toBe(1.2);
    expect(coerceUiScale(1.3000000000000003)).toBe(1.3);
    expect(coerceUiScale(0.7000000000000001)).toBe(0.7);
  });
});

describe("nextUiScale", () => {
  it("steps by a tenth and lands exactly on it", () => {
    expect(nextUiScale(1, 0.1)).toBe(1.1);
    expect(nextUiScale(1.1, 0.1)).toBe(1.2);
    expect(nextUiScale(1.2, 0.1)).toBe(1.3);
    expect(nextUiScale(1, -0.1)).toBe(0.9);
  });

  it("stops at the ends instead of wrapping round", () => {
    expect(nextUiScale(UI_SCALE_MAX, 0.1)).toBe(UI_SCALE_MAX);
    expect(nextUiScale(UI_SCALE_MIN, -0.1)).toBe(UI_SCALE_MIN);
  });
});
