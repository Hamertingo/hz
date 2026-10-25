import { describe, expect, it } from "vitest";

import { sidebarTime } from "@/lib/clock";

describe("sidebarTime", () => {
  const now = new Date(2026, 9, 23, 21, 30).getTime();

  it("says now inside a minute and nothing for no time", () => {
    expect(sidebarTime(now - 20_000, now)).toBe("now");
    expect(sidebarTime(null, now)).toBe("");
  });

  it("gives the clock time today and the weekday inside a week", () => {
    expect(sidebarTime(new Date(2026, 9, 23, 18, 5).getTime(), now)).toBe("18:05");
    expect(sidebarTime(new Date(2026, 9, 21, 12, 0).getTime(), now)).toBe("Wed");
  });

  it("gives a date after a week", () => {
    expect(sidebarTime(new Date(2026, 8, 1, 12, 0).getTime(), now)).toBe("Sep 1");
  });
});
