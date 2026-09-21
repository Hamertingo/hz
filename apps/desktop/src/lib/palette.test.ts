import { describe, expect, it } from "vitest";

import {
  CONTENT_ROWS,
  contentRows,
  highlight,
  isActionMode,
  kindLabel,
  matchItems,
  type PaletteItem,
} from "@/lib/palette";
import type { ContentMatch } from "@/types/events";

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

describe("contentRows", () => {
  const hit = (over: Partial<ContentMatch> = {}): ContentMatch => ({
    path: "/repo/src/lib/model.ts",
    relative: "src/lib/model.ts",
    line: 42,
    text: "const slug = publisherless(name)",
    ...over,
  });

  /// **The row is the line**, and the detail says where it came from. A reader
  /// recognises the sentence they were looking for; the path is what tells two
  /// files with one basename apart.
  it("draws the line, and where it is", () => {
    const rows = contentRows([hit()], () => {});
    expect(rows).toEqual([
      {
        kind: "content",
        id: "/repo/src/lib/model.ts:42",
        label: "const slug = publisherless(name)",
        detail: "src/lib/model.ts:42",
        run: rows[0].run,
      },
    ]);
    expect(kindLabel(rows[0].kind)).toBe("code");
  });

  /// Two hits in one file are two rows, and a row's id is what keeps them apart —
  /// the path alone would key both to the same React child.
  it("keys a row by the line, not by the file", () => {
    const rows = contentRows([hit(), hit({ line: 43 })], () => {});
    expect(rows.map((row) => row.id)).toEqual([
      "/repo/src/lib/model.ts:42",
      "/repo/src/lib/model.ts:43",
    ]);
  });

  /// One word can be in a thousand lines of a lockfile, and the sessions the reader
  /// might have meant instead are rows in this same list.
  it("draws a handful, however many were found", () => {
    const many = Array.from({ length: 40 }, (_, i) => hit({ line: i + 1 }));
    expect(contentRows(many, () => {})).toHaveLength(CONTENT_ROWS);
  });

  it("runs the row's own hit", () => {
    const seen: ContentMatch[] = [];
    contentRows([hit()], (found) => seen.push(found))[0].run();
    expect(seen).toHaveLength(1);
    expect(seen[0].line).toBe(42);
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
