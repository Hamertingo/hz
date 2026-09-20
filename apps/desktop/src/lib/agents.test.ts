import { describe, expect, it } from "vitest";

import {
  draftProblem,
  emptyAgent,
  filterAgents,
  groupAgents,
  isPicture,
  portraitMarker,
  portraitVariant,
} from "./agents";
import type { PluginAgent } from "@/types/events";

function agent(over: Partial<PluginAgent> = {}): PluginAgent {
  return {
    name: "custom",
    displayName: "Custom",
    description: null,
    avatar: null,
    agentRole: "worker",
    creationSource: "manual",
    builtin: false,
    ...over,
  };
}

describe("groupAgents", () => {
  it("draws the shipped roles first, then the reader's own", () => {
    const groups = groupAgents([
      agent({ name: "mine" }),
      agent({ name: "explore", builtin: true, creationSource: "builtin" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["builtin", "yours"]);
    expect(groups[0].agents.map((a) => a.name)).toEqual(["explore"]);
    expect(groups[1].agents.map((a) => a.name)).toEqual(["mine"]);
  });

  it("drops a group with nothing in it rather than drawing an empty heading", () => {
    expect(groupAgents([agent()]).map((group) => group.key)).toEqual(["yours"]);
    expect(groupAgents([])).toEqual([]);
  });
});

describe("filterAgents", () => {
  const roster = [
    agent({ name: "explore", displayName: "Explore", builtin: true }),
    agent({ name: "notes", displayName: "Notes", description: "Writes the changelog" }),
  ];

  it("matches the name, the label and the description", () => {
    expect(filterAgents(roster, "expl").map((a) => a.name)).toEqual(["explore"]);
    expect(filterAgents(roster, "Notes").map((a) => a.name)).toEqual(["notes"]);
    expect(filterAgents(roster, "changelog").map((a) => a.name)).toEqual(["notes"]);
  });

  it("keeps nothing back for an empty query", () => {
    expect(filterAgents(roster, "   ")).toHaveLength(2);
  });
});

describe("draftProblem", () => {
  it("refuses a blank name", () => {
    expect(draftProblem("  ")).toMatch(/name/i);
  });

  it("refuses a name the store would not take", () => {
    expect(draftProblem("my agent")).toMatch(/letters/i);
    expect(draftProblem("a/b")).toMatch(/letters/i);
  });

  it("refuses one of the agent's own role names", () => {
    expect(draftProblem("Explore")).toMatch(/role/i);
  });

  it("takes an ordinary name", () => {
    expect(draftProblem("notes-writer")).toBeNull();
    expect(draftProblem("v2.draft_1")).toBeNull();
  });
});

describe("emptyAgent", () => {
  it("has every field absent", () => {
    expect(Object.values(emptyAgent()).every((value) => value === null)).toBe(true);
  });
});

describe("portraits", () => {
  it("round-trips a variant through the store's own marker", () => {
    for (let variant = 0; variant < 10; variant += 1) {
      expect(portraitVariant(portraitMarker(variant))).toBe(variant);
    }
  });

  it("reads a picture as a picture, not as variant zero", () => {
    expect(portraitVariant("data:image/png;base64,AAAA")).toBeNull();
    expect(isPicture("data:image/png;base64,AAAA")).toBe(true);
    expect(isPicture(portraitMarker(3))).toBe(false);
    expect(isPicture(null)).toBe(false);
  });

  it("does not read a marker-shaped string with a variant out of range", () => {
    expect(portraitVariant("mavis-agent-avatar://default/v1/19")).toBeNull();
    expect(portraitVariant("mavis-agent-avatar://default/v2/3")).toBeNull();
  });
});
