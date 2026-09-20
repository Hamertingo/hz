import { describe, expect, it } from "vitest";

import { isActionMode, kindLabel, matchItems, type PaletteItem } from "@/lib/palette";

function item(kind: PaletteItem["kind"], label: string, detail?: string): PaletteItem {
  return { kind, id: `${kind}:${label}`, label, detail, run: () => undefined };
}

const ITEMS: PaletteItem[] = [
  item("session", "Fix the fan-out", "hz"),
  item("session", "Read the transcript twice", "t3code"),
  item("project", "hz", "/Users/you/code/hz"),
  item("space", "work"),
  item("action", "New task"),
  item("action", "Toggle the panel"),
];

describe("matchItems", () => {
  it("draws everything for an empty query, in the order it was given", () => {
    expect(matchItems(ITEMS, "")).toEqual(ITEMS);
  });

  /// The convention every palette shares, and the only thing a reader arriving
  /// from another app will try before reading anything.
  it("narrows to actions behind a `>`", () => {
    const rows = matchItems(ITEMS, ">");
    expect(rows.map((row) => row.label)).toEqual(["New task", "Toggle the panel"]);
    expect(matchItems(ITEMS, "> panel").map((row) => row.label)).toEqual(["Toggle the panel"]);
    expect(isActionMode("> x")).toBe(true);
    expect(isActionMode("x > y")).toBe(false);
  });

  /// What the label *starts* with first: a session whose title begins with the
  /// query is nearly always the one somebody meant, whatever else contains it.
  it("puts prefix matches above the rest", () => {
    const rows = matchItems(ITEMS, "read");
    expect(rows[0].label).toBe("Read the transcript twice");
  });

  /// A session is found by its project too — the title is what the reader half
  /// remembers, and the project is the other half.
  it("matches on the second line as well", () => {
    expect(matchItems(ITEMS, "t3code").map((row) => row.label)).toEqual([
      "Read the transcript twice",
    ]);
    expect(matchItems(ITEMS, "code/hz").map((row) => row.label)).toEqual(["hz"]);
  });

  it("leaves nothing behind for a query that hits nothing", () => {
    expect(matchItems(ITEMS, "zzzz")).toEqual([]);
  });
});

describe("kindLabel", () => {
  /// The marker is read, not echoed: `action` on a row that says "New task" is
  /// the word that tells a reader this one *does* something rather than opening
  /// something.
  it("names each kind", () => {
    expect(kindLabel("action")).toBe("action");
    expect(kindLabel("session")).toBe("session");
  });
});
