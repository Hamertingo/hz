import { describe, expect, it } from "vitest";

import {
  askPrompt,
  filterMentions,
  handoffPrompt,
  hzSlashCommands,
  parseHz,
  splitTeammate,
} from "./composerCommands";
import type { RosterAgent } from "./roster";

const agent = (id: string, name: string): RosterAgent => ({
  id,
  name,
  kind: "sun",
  color: "#fff",
  harness: "claude-acp",
  projectPath: null,
  modelId: null,
  effort: null,
  permission: null,
  workspaceId: null,
  instructions: "",
  role: "",
  sessionId: null,
});

const team = [agent("a", "Atlas"), agent("h", "Hugo"), agent("m", "Mila"), agent("at", "Athena")];

describe("hz commands", () => {
  it("lists the five the composer offers", () => {
    expect(hzSlashCommands().map((c) => c.name)).toEqual([
      "remember",
      "ask",
      "routine",
      "handoff",
      "clear",
    ]);
  });

  it("parses a command with its arguments", () => {
    expect(parseHz("/remember the board meets on Fridays")).toEqual({
      name: "remember",
      args: "the board meets on Fridays",
    });
    expect(parseHz("/clear")).toEqual({ name: "clear", args: "" });
    expect(parseHz("  /ASK Hugo what do they charge?  ")?.args).toBe("Hugo what do they charge?");
  });

  it("leaves the CLI's own commands and plain prose alone", () => {
    expect(parseHz("/model opus")).toBeNull();
    expect(parseHz("/remembering")).toBeNull();
    expect(parseHz("please /clear this")).toBeNull();
  });
});

describe("teammate arguments", () => {
  it("finds the teammate with or without the @", () => {
    const withAt = splitTeammate("@hugo what is the price?", team);
    const without = splitTeammate("Hugo what is the price?", team);
    for (const r of [withAt, without]) {
      expect("agent" in r && r.agent.id).toBe("h");
      expect("rest" in r && r.rest).toBe("what is the price?");
    }
  });

  it("refuses a name it does not know and the agent itself", () => {
    expect(splitTeammate("Zed hi", team)).toEqual({ error: "No teammate called Zed." });
    expect("error" in splitTeammate("Atlas hi", team, "a")).toBe(true);
    expect("error" in splitTeammate("", team)).toBe(true);
  });

  it("words the ask and the handoff so the agent reaches for its team tools", () => {
    expect(askPrompt(team[1], "what do they charge?")).toContain("team_ask");
    expect(handoffPrompt(team[2], "")).toContain("team_message");
    expect(handoffPrompt(team[2], "keep the table")).toContain("keep the table");
  });
});

describe("mention filtering", () => {
  it("puts names that start with the query before names that contain it", () => {
    expect(filterMentions(team, "at").map((a) => a.name)).toEqual(["Athena", "Atlas"]);
  });

  it("offers everyone for a bare @, minus the agent itself", () => {
    expect(filterMentions(team, "", { selfId: "a" }).map((a) => a.name)).toEqual([
      "Athena",
      "Hugo",
      "Mila",
    ]);
  });

  it("lifts a channel's members to the top", () => {
    expect(filterMentions(team, "", { memberIds: ["m"] })[0].name).toBe("Mila");
  });
});
