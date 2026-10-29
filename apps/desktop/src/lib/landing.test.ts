import { describe, expect, it } from "vitest";

import { readLastView, resolveLanding, storedFor, withView } from "./landing";

const agents = [
  { id: "a1", modified: 100 },
  { id: "a2", modified: 300 },
  { id: "a3", modified: null },
];

describe("resolveLanding", () => {
  it("keeps a stored target that still exists", () => {
    expect(resolveLanding({ stored: { kind: "agent", id: "a1" }, agents, channelIds: ["c1"] })).toEqual({ kind: "agent", id: "a1" });
    expect(resolveLanding({ stored: { kind: "channel", id: "c1" }, agents, channelIds: ["c1"] })).toEqual({ kind: "channel", id: "c1" });
    expect(resolveLanding({ stored: { kind: "page", id: "inbox" }, agents: [], channelIds: [] })).toEqual({ kind: "page", id: "inbox" });
  });

  it("falls to the most recently active agent when the target is gone", () => {
    expect(resolveLanding({ stored: { kind: "agent", id: "gone" }, agents, channelIds: ["c1"] })).toEqual({ kind: "agent", id: "a2" });
    expect(resolveLanding({ stored: { kind: "channel", id: "gone" }, agents, channelIds: [] })).toEqual({ kind: "agent", id: "a2" });
    expect(resolveLanding({ stored: { kind: "page", id: "search" }, agents, channelIds: [] })).toEqual({ kind: "agent", id: "a2" });
    expect(resolveLanding({ stored: null, agents, channelIds: [] })).toEqual({ kind: "agent", id: "a2" });
  });

  it("takes the first agent when none has spoken", () => {
    const quiet = [{ id: "x", modified: null }, { id: "y", modified: null }];
    expect(resolveLanding({ stored: null, agents: quiet, channelIds: [] })).toEqual({ kind: "agent", id: "x" });
  });

  it("takes the first channel when there are no agents", () => {
    expect(resolveLanding({ stored: null, agents: [], channelIds: ["c1", "c2"] })).toEqual({ kind: "channel", id: "c1" });
  });

  it("answers null for a workspace with nothing in it", () => {
    expect(resolveLanding({ stored: { kind: "agent", id: "a1" }, agents: [], channelIds: [] })).toBeNull();
  });
});

describe("last view storage", () => {
  it("records the target per workspace and reads it back", () => {
    const one = withView(null, "w1", { kind: "agent", id: "a1" });
    const two = withView(one, "w2", { kind: "channel", id: "c1" });
    expect(storedFor(two, "w1")).toEqual({ kind: "agent", id: "a1" });
    expect(storedFor(two, "w2")).toEqual({ kind: "channel", id: "c1" });
    expect(two.workspaceId).toBe("w2");
    expect(readLastView(JSON.parse(JSON.stringify(two)))).toEqual(two);
  });

  it("returns the same object when nothing changed", () => {
    const one = withView(null, "w1", { kind: "agent", id: "a1" });
    expect(withView(one, "w1", { kind: "agent", id: "a1" })).toBe(one);
  });

  it("reads junk as nothing stored", () => {
    expect(readLastView(null)).toBeNull();
    expect(readLastView({ kind: "nope", id: "x" })).toBeNull();
    expect(readLastView({ kind: "agent", id: "a", byWorkspace: { w: 3 } })?.byWorkspace).toEqual({});
  });
});
