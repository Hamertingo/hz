import { describe, expect, it } from "vitest";

import {
  callsThisWeek,
  catalogGroups,
  clockOf,
  durationOf,
  grantToast,
  matches,
  matrixCount,
  recentCalls,
  spark,
  withPolicy,
} from "@/lib/pluginsView";
import type { CallRecord, CatalogEntry, Plugin } from "@/types/events";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const DAY = 86_400_000;
const call = (plugin: string, ago: number, extra: Partial<CallRecord> = {}): CallRecord => ({
  t: NOW - ago,
  plugin,
  agent: "ada",
  tool: "list",
  ms: 400,
  ok: true,
  outcome: "allowed",
  ...extra,
});

describe("calls", () => {
  const calls = [call("gh", 1000), call("gh", 2 * DAY), call("gh", 9 * DAY), call("linear", 1000)];

  it("counts this week's calls to one plugin", () => {
    expect(callsThisWeek(calls, "gh", NOW)).toBe(2);
    expect(callsThisWeek(calls, "none", NOW)).toBe(0);
  });

  it("draws fourteen bars, the busiest day tallest and an empty plugin flat", () => {
    const bars = spark([...calls, call("gh", 1500)], "gh", NOW);
    expect(bars).toHaveLength(14);
    expect(bars[13]).toBe(14);
    expect(bars[11]).toBe(2 + Math.round((1 / 2) * 12));
    expect(spark([], "gh", NOW).every((h) => h === 2)).toBe(true);
  });

  it("lists the newest calls first", () => {
    const got = recentCalls(calls, "gh", 2);
    expect(got.map((c) => c.t)).toEqual([NOW - 1000, NOW - 2 * DAY]);
  });

  it("writes times the way the log does", () => {
    expect(clockOf(new Date(2026, 9, 23, 9, 2).getTime())).toBe("09:02");
    expect(durationOf(400)).toBe("0.4s");
    expect(durationOf(12_400)).toBe("12s");
    expect(durationOf(0)).toBe("-");
  });
});

describe("the page", () => {
  const plugin = (id: string, grants: string[]): Plugin =>
    ({ id, grants, tools: [], name: id }) as unknown as Plugin;

  it("counts the squares of the matrix", () => {
    const got = matrixCount([plugin("a", ["x", "y"]), plugin("b", ["x"])], [{ id: "x" }, { id: "y" }, { id: "z" }]);
    expect(got).toEqual({ on: 3, all: 6 });
  });

  it("searches by name without case", () => {
    expect(matches("GitHub", "git")).toBe(true);
    expect(matches("GitHub", "  ")).toBe(true);
    expect(matches("GitHub", "linear")).toBe(false);
  });

  it("groups what is left in the catalog and keeps Slack for its own band", () => {
    const entry = (id: string, category: string): CatalogEntry => ({ id, name: id, category }) as CatalogEntry;
    const catalog = [entry("slack", "Talk"), entry("gmail", "Talk"), entry("figma", "Work"), entry("linear", "Work")];
    const groups = catalogGroups(catalog, new Set(["linear"]), "");
    expect(groups.map((g) => [g.category, g.items.map((i) => i.id)])).toEqual([
      ["Talk", ["gmail"]],
      ["Work", ["figma"]],
    ]);
    expect(catalogGroups(catalog, new Set(), "zzz")).toEqual([]);
  });

  it("changes one tool's policy and leaves the others", () => {
    const tools = [
      { name: "a", description: null, policy: "allow" as const },
      { name: "b", description: null, policy: "ask" as const },
    ];
    expect(withPolicy(tools, "b", "off").map((t) => t.policy)).toEqual(["allow", "off"]);
  });

  it("says when a grant lands", () => {
    expect(grantToast("Ada", "GitHub", true)).toContain("next session");
    expect(grantToast("Ada", "GitHub", false)).toContain("no longer");
  });
});
