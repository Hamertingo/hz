import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  applyIssue,
  filterIssues,
  groupIssues,
  issueSpan,
  issueTag,
  issueUrl,
  parseIdentifier,
} from "@/lib/issue";
import type { Issue, IssueRef, IssueStateKind } from "@/types/events";

/// The identifier's shape and the tag's text — `parseIdentifier`/`issueTag`
/// here, `parse_identifier`/`tag_text` in Rust — read from the table both suites
/// are held to, so a word the transcript paints is a word the backend links,
/// and a tag picked from the menu is the tag `--issue` appends.
const SHARED_RULES = new URL(
  "../../src-tauri/src/harness/mcode/fixtures/shared_rules.json",
  import.meta.url,
);

type IdentifierRow = { text: string; expected: string | null };
type TagRow = { identifier: string; title: string; expected: string };

type SharedRules = { identifier: IdentifierRow[]; tag: TagRow[] };

/// The cast is the boundary a parsed file needs: this is a fixture in this repo
/// rather than anything off a wire, and a row of the wrong shape fails the
/// assertions below rather than passing quietly.
const shared = JSON.parse(readFileSync(SHARED_RULES, "utf8")) as SharedRules;

const ref = (identifier: string, title: string): IssueRef => ({
  tracker: "linear",
  id: `uuid-${identifier}`,
  identifier,
  title,
  url: `https://linear.app/x/issue/${identifier}`,
});

describe("issueSpan", () => {
  it("opens on a tag the caret is inside", () => {
    const text = "fix #DRA-53 now";
    // Caret just after the `3`.
    expect(issueSpan(text, 11)).toEqual({ start: 4, end: 11, query: "DRA-53" });
  });

  it("opens on a bare hash, which is the whole assigned list", () => {
    expect(issueSpan("#", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("stays shut on a hash that does not open a word", () => {
    // The colour case: a `#` mid-token is not a tag, and painting one would
    // open the picker on every hex value anybody types.
    expect(issueSpan("border #fff", 11)).not.toBeNull();
    expect(issueSpan("color:#fff", 10)).toBeNull();
  });

  it("reads the whole token, not the half before the caret", () => {
    // Backing up to fix a typo filters on the corrected whole — the same rule
    // the file picker follows, and what makes the correction visible.
    const span = issueSpan("#DRA-53", 4);
    expect(span?.query).toBe("DRA-53");
  });

  it("is null when the caret is not in a token at all", () => {
    expect(issueSpan("plain words", 5)).toBeNull();
    expect(issueSpan("#DRA-53 after", 13)).toBeNull();
  });
});

describe("applyIssue", () => {
  it("writes the identifier and the title, and leaves the caret past a space", () => {
    const span = issueSpan("fix #DRA", 8)!;
    const next = applyIssue("fix #DRA", span, "DRA-53", "Issue tracker integration");

    expect(next.text).toBe("fix #DRA-53 Issue tracker integration ");
    expect(next.caret).toBe(next.text.length);
  });

  it("keeps the rest of the line and does not double its space", () => {
    const span = issueSpan("fix #DR now", 7)!;
    const next = applyIssue("fix #DR now", span, "DRA-53", "Fix it");

    expect(next.text).toBe("fix #DRA-53 Fix it now");
    // Caret sits after the space, ready for the next word.
    expect(next.text.slice(next.caret)).toBe("now");
  });

  /// The string Rust's `tag_text` writes for `--issue`, so a tag picked from the
  /// menu and one appended by the CLI are the same thing — the same rows its
  /// own test reads.
  ///
  /// A title that is only whitespace is the one input the two disagree on: Rust
  /// trims it and writes the identifier alone, where this side truth-tests it
  /// and writes the spaces out. Deliberately not a row, and worth knowing before
  /// somebody adds one.
  it("matches the shape the backend writes", () => {
    for (const row of shared.tag) {
      const where = `${row.identifier} / ${JSON.stringify(row.title)}`;

      expect(issueTag(row.identifier, row.title), where).toBe(row.expected);
    }
  });
});

describe("parseIdentifier", () => {
  /// A key and a number, uppercased, wherever the token ends — and nothing for
  /// the words that only look like one: a colour's `fff`, a bare number, a
  /// heading's word. Every row is the backend's too, and both readers decide the
  /// same two things with it: what gets painted as a tag, and what gets linked.
  it("reads every shared row the way the backend does", () => {
    for (const row of shared.identifier) {
      expect(parseIdentifier(row.text), row.text).toBe(row.expected);
    }
  });
});

describe("issueUrl", () => {
  it("finds where a tag points", () => {
    const issues = [ref("DRA-53", "One"), ref("DRA-9", "Two")];

    expect(issueUrl(issues, "DRA-9")).toBe("https://linear.app/x/issue/DRA-9");
  });

  /// A tag whose issue never resolved — the tracker was unreachable when the
  /// prompt was sent — stays plain text rather than becoming a dead link.
  it("is null for a tag nothing was linked for", () => {
    expect(issueUrl([], "DRA-53")).toBeNull();
    expect(issueUrl([ref("DRA-53", "One")], "DRA-9")).toBeNull();
  });
});

const issue = (identifier: string, kind: IssueStateKind): Issue => ({
  tracker: "linear",
  id: `uuid-${identifier}`,
  identifier,
  title: identifier,
  url: `https://linear.app/x/issue/${identifier}`,
  state: { id: `state-${kind}`, name: "Whatever this team calls it", kind, color: "#000" },
  priority: "none",
  assignee: null,
  labels: [],
  team: "DRA",
  project: null,
  updatedAt: "2026-08-27T00:00:00Z",
});

describe("groupIssues", () => {
  /// Started first and settled last, whatever order the list arrived in — the
  /// order work moves through, which is the order attention should reach it in.
  it("buckets by state kind, in the page's own order", () => {
    const groups = groupIssues([
      issue("DRA-1", "completed"),
      issue("DRA-2", "started"),
      issue("DRA-3", "backlog"),
      issue("DRA-4", "started"),
    ]);

    expect(groups.map((g) => g.label)).toEqual(["In Progress", "Backlog", "Done"]);
    expect(groups[0].issues.map((i) => i.identifier)).toEqual(["DRA-2", "DRA-4"]);
  });

  /// Grouping on the *kind*, not the name: a name is per-team prose, so a list
  /// spanning three teams would otherwise draw a dozen headings for what are
  /// really the same few states.
  it("gathers teams that name one state differently", () => {
    const a = issue("DRA-1", "started");
    const b = { ...issue("OPS-1", "started"), state: { id: "state-shipping", name: "Shipping", kind: "started" as const, color: "#000" } };

    expect(groupIssues([a, b])).toHaveLength(1);
  });

  it("drops empty buckets", () => {
    expect(groupIssues([])).toEqual([]);
  });
});

describe("filterIssues", () => {
  const rows = [
    { ...issue("DRA-53", "started"), title: "Add issue tracker integration" },
    { ...issue("DRA-9", "backlog"), title: "Worktree cleanup" },
  ];

  /// The tag gets typed lower case where the identifier is spelled upper.
  it("matches an identifier however it is cased", () => {
    expect(filterIssues(rows, "dra-5").map((i) => i.identifier)).toEqual(["DRA-53"]);
  });

  it("matches a word anywhere in the title", () => {
    expect(filterIssues(rows, "cleanup").map((i) => i.identifier)).toEqual(["DRA-9"]);
  });

  /// A bare `#` opens the picker on the whole assigned list, so an empty query
  /// narrows nothing.
  it("keeps everything for an empty query", () => {
    expect(filterIssues(rows, "  ")).toEqual(rows);
  });

  it("answers nothing rather than everything when nothing matches", () => {
    expect(filterIssues(rows, "zzz")).toEqual([]);
  });
});
