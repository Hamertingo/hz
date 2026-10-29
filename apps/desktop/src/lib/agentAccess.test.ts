import { describe, expect, it } from "vitest";

import { addFolder, readFolders, readRules, readTalk, toolOn, withTool } from "./agentAccess";

describe("access settings", () => {
  it("reads whatever the roster file holds without throwing", () => {
    expect(readTalk(undefined)).toEqual({ mode: "everyone", ids: [] });
    expect(readTalk({ mode: "list", ids: ["a", 3] })).toEqual({ mode: "list", ids: ["a"] });
    expect(readTalk({ mode: "nonsense" }).mode).toBe("everyone");
    expect(readRules([{ text: "Deleting files" }, 4, { on: true }])).toEqual([{ text: "Deleting files", on: true }]);
    expect(readFolders([{ path: "/x", write: true }, { path: "/y" }, "z"])).toEqual([
      { path: "/x", write: true },
      { path: "/y", write: false },
    ]);
  });

  it("adds a folder once, read only", () => {
    const one = addFolder([], "/notes");
    expect(one).toEqual([{ path: "/notes", write: false }]);
    expect(addFolder(one, "/notes")).toHaveLength(1);
  });

  it("switches a tool server off and on", () => {
    const off = withTool([], "memory", false);
    expect(toolOn({ toolsOff: off }, "memory")).toBe(false);
    expect(toolOn({ toolsOff: off }, "team")).toBe(true);
    expect(withTool(off, "memory", true)).toEqual([]);
    expect(toolOn({}, "team")).toBe(true);
  });
});
