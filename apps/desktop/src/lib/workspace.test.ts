import { describe, expect, it } from "vitest";

import {
  activeWorkspace,
  confirmsDelete,
  DEFAULT_WORKSPACE_DEFAULTS,
  nextColor,
  workspaceLine,
  workspaceMark,
} from "@/lib/workspace";
import { MASCOT_COLORS } from "@/lib/mascots";
import type { Workspace } from "@/types/events";

const ws = (id: string, name = id): Workspace => ({
  id,
  name,
  mark: name[0].toUpperCase(),
  color: MASCOT_COLORS[0],
  logo: null,
  context: "",
  members: [],
  defaults: DEFAULT_WORKSPACE_DEFAULTS,
  agentOrder: [],
  channelOrder: [],
  sectionOrder: ["channels", "agents"],
});

describe("activeWorkspace", () => {
  it("takes the stored pick while it exists", () => {
    expect(activeWorkspace([ws("a"), ws("b")], "b")?.id).toBe("b");
  });

  it("falls back to the first when the pick is gone or unset", () => {
    expect(activeWorkspace([ws("a"), ws("b")], "deleted")?.id).toBe("a");
    expect(activeWorkspace([ws("a")], null)?.id).toBe("a");
    expect(activeWorkspace([], null)).toBeNull();
  });
});

describe("logo helpers", () => {
  it("spells the first letter, upper-cased", () => {
    expect(workspaceMark("  hyze cloud")).toBe("H");
    expect(workspaceMark("")).toBe("W");
  });

  it("walks the palette and wraps", () => {
    expect(nextColor(MASCOT_COLORS[0])).toBe(MASCOT_COLORS[1]);
    expect(nextColor(MASCOT_COLORS[MASCOT_COLORS.length - 1])).toBe(MASCOT_COLORS[0]);
    expect(nextColor("#000000")).toBe(MASCOT_COLORS[0]);
  });
});

describe("workspaceLine", () => {
  it("counts agents and says who is working", () => {
    expect(workspaceLine(0, 0)).toBe("No agents yet");
    expect(workspaceLine(1, 0)).toBe("1 agent");
    expect(workspaceLine(5, 2)).toBe("5 agents · 2 working");
  });
});

describe("confirmsDelete", () => {
  it("wants the name exactly", () => {
    expect(confirmsDelete("Hyze Cloud", "Hyze Cloud")).toBe(true);
    expect(confirmsDelete("hyze cloud", "Hyze Cloud")).toBe(false);
    expect(confirmsDelete("", "Hyze Cloud")).toBe(false);
  });
});
