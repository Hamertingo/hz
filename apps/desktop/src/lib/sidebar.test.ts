import { describe, expect, it } from "vitest";

import { EMPTY_SIDE, arrangeRows, poseFor, readSide, withFolderMove, withNewFolder, withPin, withRead, withoutRow } from "@/lib/sidebar";

describe("sidebar state", () => {
  it("holds four pins and refuses a fifth", () => {
    let s = EMPTY_SIDE;
    for (const id of ["a", "b", "c", "d"]) s = withPin(s, id, true);
    expect(withPin(s, "e", true)).toBe(s);
    expect(withPin(s, "b", false).pins).toEqual(["a", "c", "d"]);
  });

  it("moves a row between folders and out", () => {
    let s = withNewFolder(withNewFolder(EMPTY_SIDE, "f1", "One"), "f2", "Two");
    s = withFolderMove(s, "x", "f1");
    s = withFolderMove(s, "x", "f2");
    expect(s.folders.map((f) => f.ids)).toEqual([[], ["x"]]);
    expect(withFolderMove(s, "x", null).folders.every((f) => f.ids.length === 0)).toBe(true);
  });

  it("marks read by remembering where the row had got", () => {
    const s = withRead(withRead(EMPTY_SIDE, "a", false, ""), "a", true, "42");
    expect(s.unread).toEqual([]);
    expect(s.seen.a).toBe("42");
  });

  it("forgets a deleted row everywhere", () => {
    const s = withoutRow(withFolderMove(withPin(withNewFolder(EMPTY_SIDE, "f", "F"), "a", true), "a", "f"), "a");
    expect(s.pins).toEqual([]);
    expect(s.folders[0].ids).toEqual([]);
  });

  it("reads a damaged save as empty fields", () => {
    expect(readSide({ pins: "x", folders: [{ id: 1 }, { id: "f", name: "F", ids: ["a", 2] }] })).toMatchObject({ pins: [], folders: [{ id: "f", ids: ["a"] }] });
  });

  it("sleeps after a long quiet and works while a turn runs", () => {
    expect(poseFor(true, null, 0)).toBe("work");
    expect(poseFor(false, null, 0)).toBe("sleep");
    expect(poseFor(false, 1000, 2000)).toBe("idle");
    expect(poseFor(false, 0, 3 * 3_600_000)).toBe("sleep");
  });

  it("puts the reader's order first and the rest newest first", () => {
    const rows = [{ id: "a", at: 1 }, { id: "b", at: 3 }, { id: "c", at: 2 }];
    expect(arrangeRows(rows, [])).toEqual(["b", "c", "a"]);
    expect(arrangeRows(rows, ["a"])).toEqual(["a", "b", "c"]);
  });
});
