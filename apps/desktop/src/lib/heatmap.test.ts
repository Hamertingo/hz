import { describe, expect, it } from "vitest";

import { buildHeatmap, countByDay, dayHeading, heroNumbers, lastDays, levelOf, monthLabels, workLabel } from "./heatmap";

// Noon local on a Friday, so no neighbouring midnight can move the day.
const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime();
const at = (m: number, d: number, h = 10) => new Date(2026, m, d, h).getTime();

describe("heatmap bucketing", () => {
  it("counts messages by the reader's own day", () => {
    const counts = countByDay([at(9, 23, 0), at(9, 23, 23), at(9, 22, 12)]);
    expect(counts.get("2026-10-23")).toBe(2);
    expect(counts.get("2026-10-22")).toBe(1);
  });

  it("keeps a bar for a day with nothing, oldest first, ending today", () => {
    const days = lastDays([at(9, 23), at(9, 23), at(9, 21)], 14, NOW);
    expect(days).toHaveLength(14);
    expect(days[13]).toBe(2);
    expect(days[11]).toBe(1);
    expect(days[12]).toBe(0);
  });

  it("makes 26 full columns, Monday first, with today in the last", () => {
    const weeks = buildHeatmap([at(9, 23)], 26, NOW);
    expect(weeks).toHaveLength(26);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 2026-10-23 is a Friday: row 4 of the last column.
    expect(weeks[25][4].key).toBe("2026-10-23");
    expect(weeks[25][4].count).toBe(1);
    expect(weeks[25][4].level).toBe(4);
    // The weekend has not happened yet.
    expect(weeks[25][5].level).toBe(-1);
    expect(weeks[25][6].level).toBe(-1);
    expect(new Date(weeks[0][0].ms).getDay()).toBe(1);
  });

  it("bands a day against the busiest one shown", () => {
    expect(levelOf(0, 10)).toBe(0);
    expect(levelOf(1, 10)).toBe(1);
    expect(levelOf(3, 10)).toBe(2);
    expect(levelOf(6, 10)).toBe(3);
    expect(levelOf(10, 10)).toBe(4);
    expect(levelOf(5, 0)).toBe(0);
  });

  it("names a month where it begins", () => {
    const labels = monthLabels(buildHeatmap([], 26, NOW));
    expect(labels.at(-1)?.label).toBe("Oct");
    expect(new Set(labels.map((l) => l.label)).size).toBe(labels.length);
    // Never two names close enough to print over each other.
    for (let i = 1; i < labels.length; i++) expect(labels[i].col - labels[i - 1].col).toBeGreaterThanOrEqual(3);
  });

  it("reads the hero tiles off the stamps", () => {
    const n = heroNumbers(
      {
        messages: [at(9, 23), at(9, 22), at(7, 1)],
        tasks: [
          { endMs: at(9, 23), secs: 600, ok: true },
          { endMs: at(9, 2), secs: 1800, ok: true },
          { endMs: at(9, 3), secs: 60, ok: false },
          { endMs: at(8, 30), secs: 9999, ok: true },
        ],
      },
      NOW,
    );
    expect(n.messages14).toBe(2);
    expect(n.tasksThisMonth).toBe(2);
    expect(n.workSecsThisMonth).toBe(600 + 1800 + 60);
  });

  it("writes work time and day headings the way the page reads them", () => {
    expect(workLabel(18 * 3600 + 40 * 60)).toBe("18h 40m");
    expect(workLabel(3600)).toBe("1h");
    expect(workLabel(720)).toBe("12m");
    expect(workLabel(40)).toBe("40s");
    expect(dayHeading(at(9, 23), NOW)).toBe("Today");
    expect(dayHeading(at(9, 22), NOW)).toBe("Yesterday");
    expect(dayHeading(at(9, 1), NOW)).toBe("Oct 1");
  });
});
