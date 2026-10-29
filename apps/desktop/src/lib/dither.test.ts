import { describe, expect, it } from "vitest";

import { ditherGrid, rng } from "@/lib/dither";

describe("dither", () => {
  it("is the same grid for the same seed and a different one for another", () => {
    const a = ditherGrid("atlas", { cols: 24, rows: 12 });
    expect(Array.from(ditherGrid("atlas", { cols: 24, rows: 12 }))).toEqual(Array.from(a));
    expect(Array.from(ditherGrid("ada", { cols: 24, rows: 12 }))).not.toEqual(Array.from(a));
  });

  it("only picks tones that exist", () => {
    const g = ditherGrid("x", { cols: 40, rows: 20, tones: 4 });
    expect(Math.max(...g)).toBeLessThanOrEqual(3);
  });

  it("rng stays in [0, 1)", () => {
    const r = rng("seed");
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
