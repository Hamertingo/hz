import { describe, expect, it } from "vitest";

import { MASCOT_KINDS, mascotSvg, mixHex } from "./mascots";
import { adoptOrphans, inWorkspace, pinnedFirst, readAgents, withAgent, withClaim, withoutAgent, withoutWorkspace, type Roster, type RosterAgent } from "./roster";

const agent = (id: string, sessionId: string | null = null): RosterAgent => ({
  id,
  name: id,
  kind: "cat",
  color: "#6a8cf0",
  harness: "claude-acp",
  projectPath: null,
  modelId: null,
  effort: null,
  permission: null,
  workspaceId: null,
  instructions: "",
  role: "",
  sessionId,
});

describe("roster", () => {
  it("binds the pending agent to the session that was just created", () => {
    const roster: Roster = { agents: [agent("a"), agent("b")], pendingId: "b" };
    const next = withClaim(roster, "s1");

    expect(next.agents.find((a) => a.id === "b")?.sessionId).toBe("s1");
    expect(next.agents.find((a) => a.id === "a")?.sessionId).toBeNull();
    expect(next.pendingId).toBeNull();
  });

  it("never gives a second session to an agent that already has one", () => {
    const roster: Roster = { agents: [agent("a", "old")], pendingId: "a" };

    expect(withClaim(roster, "new").agents[0].sessionId).toBe("old");
  });

  it("claims nothing when no agent is pending", () => {
    const roster: Roster = { agents: [agent("a")], pendingId: null };

    expect(withClaim(roster, "s1").agents[0].sessionId).toBeNull();
  });

  it("replaces an agent with the same id instead of duplicating it", () => {
    const roster = withAgent({ agents: [agent("a")], pendingId: null }, { ...agent("a"), name: "Renamed" });

    expect(roster.agents).toHaveLength(1);
    expect(roster.agents[0].name).toBe("Renamed");
  });

  it("clears the pending mark when its agent is removed", () => {
    const next = withoutAgent({ agents: [agent("a")], pendingId: "a" }, "a");

    expect(next.agents).toEqual([]);
    expect(next.pendingId).toBeNull();
  });

  it("drops entries that are not agents and repairs the ones that nearly are", () => {
    const read = readAgents([null, 3, { id: "x" }, { id: "y", name: "Y", kind: "nope", sessionId: 5 }]);

    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ id: "y", kind: "sun", harness: "claude-acp", sessionId: null });
  });

  it("keeps the harness an agent was made on and repairs one it does not know", () => {
    const read = readAgents([
      { id: "a", name: "A", harness: "opencode" },
      { id: "b", name: "B", harness: "mcode" },
    ]);

    expect(read.map((a) => a.harness)).toEqual(["opencode", "claude-acp"]);
  });
});

describe("agent target", () => {
  it("keeps the folder and model an agent was made with, and reads a missing one as unset", () => {
    const read = readAgents([
      { id: "a", name: "A", projectPath: "/work/a", modelId: "sonnet" },
      { id: "b", name: "B" },
    ]);

    expect(read[0]).toMatchObject({ projectPath: "/work/a", modelId: "sonnet" });
    expect(read[1]).toMatchObject({ projectPath: null, modelId: null });
  });
});

describe("agent permission", () => {
  it("keeps a known stance and reads anything else as the composer's own", () => {
    const read = readAgents([
      { id: "a", name: "A", permission: "manual" },
      { id: "b", name: "B", permission: "yolo" },
      { id: "c", name: "C" },
    ]);

    expect(read.map((a) => a.permission)).toEqual(["manual", null, null]);
  });
});

describe("workspaces", () => {
  it("shows an agent in its own workspace only, and an unfiled one nowhere", () => {
    const filed = { ...agent("a"), workspaceId: "w1" };

    expect(inWorkspace(filed, "w1")).toBe(true);
    expect(inWorkspace(filed, "w2")).toBe(false);
    expect(inWorkspace(filed, null)).toBe(false);
    expect(inWorkspace(agent("b"), "w1")).toBe(false);
    expect(readAgents([{ id: "c", name: "C", workspaceId: "w2", space: "old" }])[0].workspaceId).toBe("w2");
    expect(readAgents([{ id: "c", name: "C", space: "old" }])[0].workspaceId).toBeNull();
  });

  it("files agents from before workspaces into the fallback, once", () => {
    const filed = { ...agent("a"), workspaceId: "w1" };
    const list = [filed, agent("b")];

    const adopted = adoptOrphans(list, "w9");
    expect(adopted.map((a) => a.workspaceId)).toEqual(["w1", "w9"]);
    expect(adoptOrphans(adopted, "w5")).toBe(adopted);
  });

  it("drops a deleted workspace's agents and nobody else's", () => {
    const roster: Roster = {
      agents: [
        { ...agent("a"), workspaceId: "w1" },
        { ...agent("b"), workspaceId: "w2" },
      ],
      pendingId: "a",
    };

    const next = withoutWorkspace(roster, "w1");
    expect(next.agents.map((a) => a.id)).toEqual(["b"]);
    expect(next.pendingId).toBeNull();
  });
});

describe("mascots", () => {
  it("draws every character, mirrored, with blinking eyes in their own group", () => {
    for (const kind of MASCOT_KINDS) {
      const svg = mascotSvg(kind, "#6a8cf0");

      expect(svg).toContain('class="mascot-eyes"');
      expect(svg).toContain("<rect");
    }
  });

  it("mixes colours toward a target", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#123456", "#123456", 0.7)).toBe("#123456");
  });
});

describe("pinning and muting", () => {
  it("keeps the pinned agents first and each group in its own order", () => {
    const list = [agent("a"), { ...agent("b"), pinned: true }, agent("c"), { ...agent("d"), pinned: true }];
    expect(pinnedFirst(list).map((a) => a.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("reads the two flags back and defaults them off", () => {
    const [on, off] = readAgents([
      { id: "x", name: "X", pinned: true, muted: true },
      { id: "y", name: "Y" },
    ]);
    expect([on.pinned, on.muted]).toEqual([true, true]);
    expect([off.pinned, off.muted]).toEqual([false, false]);
  });
});
