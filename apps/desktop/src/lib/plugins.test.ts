import { describe, expect, it } from "vitest";

import { hasPick, mcpPickOf, pickedSkillOf, sectionTab } from "@/lib/plugins";
import type { PluginSkill } from "@/types/events";

const skill: PluginSkill = {
  name: "pdf",
  displayName: "PDF",
  description: "",
  enabled: true,
  sourceKind: "user",
  locationUri: null,
};

describe("sectionTab", () => {
  it("drops the pick when the section changes", () => {
    // The pane draws the thing its own section lists, so a pick carried across is
    // a pane describing something that is not on the page.
    expect(sectionTab("mcp")).toEqual({ section: "mcp", pick: null });
    expect(sectionTab("skills")).toEqual({ section: "skills", skill: null });
  });
});

describe("the questions asked of one tab", () => {
  it("answers for the section that is up, and not for the other", () => {
    const skillsUp = { section: "skills", skill } as const;
    const mcpUp = { section: "mcp", pick: { mode: "new" } } as const;

    expect(pickedSkillOf(skillsUp)).toBe(skill);
    expect(pickedSkillOf(mcpUp)).toBeNull();
    expect(mcpPickOf(mcpUp)).toEqual({ mode: "new" });
    expect(mcpPickOf(skillsUp)).toBeNull();
  });

  it("says whether the pane is showing anything at all", () => {
    expect(hasPick({ section: "skills", skill })).toBe(true);
    expect(hasPick({ section: "skills", skill: null })).toBe(false);
    expect(hasPick({ section: "mcp", pick: { mode: "server", name: "github" } })).toBe(true);
    expect(hasPick({ section: "mcp", pick: { mode: "new" } })).toBe(true);
    expect(hasPick({ section: "mcp", pick: null })).toBe(false);
  });
});
