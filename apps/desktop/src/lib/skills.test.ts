import { describe, expect, it } from "vitest";

import {
  countDisabled,
  filterSkills,
  groupSkills,
  withSkillEnabled,
} from "@/lib/skills";
import type { PluginSkill, SkillRoster } from "@/types/events";

function skill(over: Partial<PluginSkill> & { name: string }): PluginSkill {
  return {
    displayName: over.name,
    description: "",
    enabled: true,
    sourceKind: "user",
    locationUri: null,
    ...over,
  };
}

describe("groupSkills", () => {
  it("draws the kinds this build knows first, in their own order", () => {
    const groups = groupSkills([
      skill({ name: "b", sourceKind: "builtin-global" }),
      skill({ name: "u", sourceKind: "user" }),
      skill({ name: "a", sourceKind: "builtin-agent" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["user", "builtin-agent", "builtin-global"]);
  });

  it("keeps a kind it has never heard of, after the ones it has", () => {
    const groups = groupSkills([
      skill({ name: "x", sourceKind: "some-new-kind" }),
      skill({ name: "u", sourceKind: "user" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["user", "some-new-kind"]);
    // Spelled as a heading rather than as the slug the agent sent.
    expect(groups[1]?.label).toBe("Some new kind");
  });

  it("keeps the order two unknown kinds arrived in", () => {
    const groups = groupSkills([
      skill({ name: "x", sourceKind: "zeta" }),
      skill({ name: "y", sourceKind: "alpha" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["zeta", "alpha"]);
  });

  it("files a row with no kind at all rather than dropping it", () => {
    const groups = groupSkills([skill({ name: "x", sourceKind: null })]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.skills).toHaveLength(1);
  });
});

describe("filterSkills", () => {
  const roster = [
    skill({ name: "pdf", displayName: "PDF", description: "Fill and read PDFs." }),
    skill({ name: "code-review", displayName: "Code review", description: "Review changes." }),
  ];

  it("asks for nothing and keeps everything", () => {
    expect(filterSkills(roster, "   ")).toHaveLength(2);
  });

  it("matches the name, the label and the description alike", () => {
    expect(filterSkills(roster, "pdf").map((s) => s.name)).toEqual(["pdf"]);
    expect(filterSkills(roster, "CODE").map((s) => s.name)).toEqual(["code-review"]);
    // The description is the half a reader who does not know the name has to go
    // on, which is why matching the name alone is not enough.
    expect(filterSkills(roster, "fill and read").map((s) => s.name)).toEqual(["pdf"]);
  });
});

describe("countDisabled", () => {
  it("counts the rows that are off", () => {
    expect(
      countDisabled([skill({ name: "a" }), skill({ name: "b", enabled: false })]),
    ).toBe(1);
  });
});

describe("withSkillEnabled", () => {
  const roster: SkillRoster = {
    skills: [skill({ name: "a" }), skill({ name: "b" })],
    hasMore: false,
  };

  it("moves the row it names and leaves the rest where they were", () => {
    const moved = withSkillEnabled(roster, "a", false);

    expect(moved.skills[0]?.enabled).toBe(false);
    expect(moved.skills[1]?.enabled).toBe(true);
    // A new object, so React sees the change — the row it was handed is the one
    // the list is already drawing.
    expect(moved).not.toBe(roster);
  });

  it("does nothing at all for a row the roster no longer holds", () => {
    const moved = withSkillEnabled(roster, "gone", false);

    expect(moved.skills.map((s) => s.enabled)).toEqual([true, true]);
  });
});
