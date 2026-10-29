import { describe, expect, it } from "vitest";

import {
  arrange,
  highlight,
  isActionMode,
  kindLabel,
  groupOf,
  matchItems,
  noteTitle,
  PER_GROUP,
  type PaletteItem,
  suggestedName,
} from "@/lib/palette";

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

describe("highlight", () => {
  /// Case-insensitively, because the search is: a row that matched `Needle` and
  /// drew none of it in the accent would look like it had matched some other way.
  it("finds the query whatever case it was typed in", () => {
    expect(highlight("const slug = publisherless(name)", "publisher")).toEqual({
      before: "const slug = ",
      match: "publisher",
      after: "less(name)",
    });
    expect(highlight("PublisherLess", "publisherless")).toEqual({
      before: "",
      match: "PublisherLess",
      after: "",
    });
  });

  /// Sliced out of the original, so what is drawn is the text as it is written.
  it("draws the text's own spelling, not the folded one", () => {
    expect(highlight("Über alles", "über")?.match).toBe("Über");
  });

  /// A row can match on its detail — a session's project, a file's path — and then
  /// there is nothing in the label to mark.
  it("marks nothing where the label does not hold the query", () => {
    expect(highlight("Read the transcript twice", "model")).toBeNull();
    expect(highlight("anything", "   ")).toBeNull();
  });
});

describe("arrange", () => {
  const many = (kind: PaletteItem["kind"], n: number) =>
    Array.from({ length: n }, (_, i) => item(kind, `${kind} ${i}`));

  it("gathers rows under their groups in the fixed order, whatever order they came in", () => {
    const rows = arrange([item("action", "Settings"), item("routine", "Nightly"), item("agent", "Ada")], "");
    expect(rows.map(groupOf)).toEqual(["Agents", "Routines", "Do"]);
  });

  it("opens on the first few of each group, and a query lifts the cap", () => {
    const all = [...many("agent", 9), ...many("action", 9)];
    expect(arrange(all, "")).toHaveLength(PER_GROUP * 2);
    expect(arrange(all, "agent")).toHaveLength(9);
  });

  it("filters over the title and the subtitle", () => {
    const rows = arrange([item("agent", "Ada", "Developer"), item("agent", "Leo", "Research")], "devel");
    expect(rows.map((r) => r.label)).toEqual(["Ada"]);
  });

  it("keeps the caller's order inside a group", () => {
    const rows = arrange([item("channel", "#b"), item("channel", "#a")], "");
    expect(rows.map((r) => r.label)).toEqual(["#b", "#a"]);
  });
});

describe("suggestedName", () => {
  it("offers what was typed as a name, trimmed and capped", () => {
    expect(suggestedName("  Orion ")).toBe("Orion");
    expect(suggestedName("x".repeat(80))).toHaveLength(60);
  });
  it("offers nothing for an empty query or actions mode", () => {
    expect(suggestedName("   ")).toBeNull();
    expect(suggestedName("> new")).toBeNull();
  });
});

describe("noteTitle", () => {
  it("turns a file name into words", () => {
    expect(noteTitle("pricing-pro.md")).toBe("Pricing pro");
    expect(noteTitle("como_o_gabriel_decide.md")).toBe("Como o gabriel decide");
  });
});
