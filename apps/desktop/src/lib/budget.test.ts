import { describe, expect, it } from "vitest";

import { budgetState, litSegments, parseBudget, spendShare, usd } from "./budget";

describe("budget math", () => {
  it("warns at 80% and pauses at 100%", () => {
    expect(budgetState(12.4, 50)).toBe("ok");
    expect(budgetState(40, 50)).toBe("warn");
    expect(budgetState(49.99, 50)).toBe("warn");
    expect(budgetState(50, 50)).toBe("paused");
    expect(budgetState(75, 50)).toBe("paused");
  });

  it("never pauses with no budget", () => {
    expect(budgetState(9999, null)).toBe("ok");
    expect(budgetState(9999, 0)).toBe("ok");
  });

  it("lights segments by the share spent, capped at the whole track", () => {
    expect(spendShare(12.4, 50)).toBeCloseTo(0.248);
    expect(litSegments(spendShare(12.4, 50))).toBe(10);
    expect(spendShare(80, 50)).toBe(1);
    expect(spendShare(5, null)).toBe(0);
  });

  it("reads what the field accepts", () => {
    expect(parseBudget("50")).toBe(50);
    expect(parseBudget(" 12,5 ")).toBe(12.5);
    expect(parseBudget("0")).toBeNull();
    expect(parseBudget("-3")).toBeNull();
    expect(parseBudget("abc")).toBeNull();
    expect(parseBudget("")).toBeNull();
  });

  it("writes whole dollars without cents", () => {
    expect(usd(50)).toBe("50");
    expect(usd(12.4)).toBe("12.40");
  });
});
