import { describe, expect, it } from "vitest";

import {
  authorFacets,
  DEFAULT_FILTERS,
  groupPrs,
  isAuthored,
  isFiltered,
  isWaiting,
  labelFacets,
  visiblePrs,
  type PrFilters,
} from "@/lib/prList";
import type { PrListItem } from "@/types/events";

/// A row as the page holds it — the listing's fields plus the checkout it came
/// from, which the repository filter narrows on.
type Row = PrListItem & { cwd: string };

function item(over: Partial<Row> & { number: number }): Row {
  return {
    title: `#${over.number}`,
    url: "",
    state: "OPEN",
    isDraft: false,
    author: "someone",
    avatar: null,
    headRefName: `b${over.number}`,
    baseRefName: "main",
    updatedAt: "2026-09-19T00:00:00Z",
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    reviewDecision: null,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    checksState: "CLEAR",
    reviewRequests: [],
    labels: [],
    cwd: "/repo/one",
    ...over,
  } as Row;
}

const filters = (over: Partial<PrFilters> = {}): PrFilters => ({ ...DEFAULT_FILTERS, ...over });

const lab = (name: string, color: string | null = null) => ({ name, color });

describe("who a row is to the reader", () => {
  const mine = item({ number: 1, author: "Hamerti" });
  const asked = item({ number: 2, author: "someone", reviewRequests: ["hamerti"] });

  /// Case, because a team slug and a login share this list and neither has to
  /// agree with the other on case.
  it("reads a review request as waiting, whatever the case", () => {
    expect(isWaiting(asked, "hamerti")).toBe(true);
    expect(isWaiting(mine, "hamerti")).toBe(false);
  });

  it("reads the author as yours", () => {
    expect(isAuthored(mine, "hamerti")).toBe(true);
    expect(isAuthored(asked, "hamerti")).toBe(false);
  });

  /// `gh` refusing to say who we are is an answer, not a licence to guess: no
  /// row is filed under the reader's own name, so everything lands in Others.
  it("claims nothing for a reader we cannot name", () => {
    expect(isWaiting(asked, null)).toBe(false);
    expect(isAuthored(mine, null)).toBe(false);
  });
});

describe("groupPrs", () => {
  /// **Waiting first, because it is the only group that wants something.**
  const waiting = item({ number: 1, author: "someone", reviewRequests: ["hamerti"] });
  const mine = item({ number: 2, author: "hamerti" });
  const other = item({ number: 3, author: "someone" });

  it("orders the runs and drops the empty ones", () => {
    const groups = groupPrs([other, mine, waiting], "hamerti");
    expect(groups.map((group) => group.key)).toEqual(["waiting", "authored", "others"]);
    expect(groups[0].items.map((i) => i.number)).toEqual([1]);
  });

  it("draws no heading over nothing", () => {
    // One reader, no review requests, one own PR: two runs, not three.
    expect(groupPrs([mine], "hamerti").map((group) => group.key)).toEqual(["authored"]);
    expect(groupPrs([], "hamerti")).toEqual([]);
  });

  /// A row goes to the first group that claims it: your own pull request that
  /// somebody then asked you to review is waiting on you, and that is the thing
  /// to do.
  it("files a row once, under what wants doing", () => {
    const both = item({ number: 4, author: "hamerti", reviewRequests: ["hamerti"] });
    const groups = groupPrs([both], "hamerti");
    expect(groups.map((group) => group.key)).toEqual(["waiting"]);
  });
});

describe("visiblePrs", () => {
  const items = [
    item({ number: 1, author: "hamerti" }),
    item({ number: 2, author: "other", reviewRequests: ["hamerti"] }),
    item({ number: 3, author: "other" }),
  ];

  it("draws everything when nothing is asked", () => {
    expect(visiblePrs(items, filters(), "hamerti")).toHaveLength(3);
  });

  /// The state and the search are the server's, so this filter is the one thing
  /// the page narrows for itself — and it must narrow to exactly the rows its
  /// own group would have shown.
  it("narrows to what the reader is involved in", () => {
    expect(visiblePrs(items, filters({ involvement: "waiting" }), "hamerti")).toEqual([items[1]]);
    expect(visiblePrs(items, filters({ involvement: "authored" }), "hamerti")).toEqual([items[0]]);
  });

  it("keeps the order the listing came in", () => {
    const order = visiblePrs(items, filters(), "hamerti").map((i) => i.number);
    expect(order).toEqual([1, 2, 3]);
  });

  /// A second label is a narrowing, not a second chance: three labels ticked
  /// means rows holding all three, which is what a checkbox means.
  it("asks for every ticked label, not any of them", () => {
    const labelled = [
      item({ number: 1, labels: [lab("bug"), lab("ui")] }),
      item({ number: 2, labels: [lab("bug")] }),
      item({ number: 3, labels: [] }),
    ];

    expect(visiblePrs(labelled, filters({ labels: ["bug"] }), null)).toEqual([labelled[0], labelled[1]]);
    expect(visiblePrs(labelled, filters({ labels: ["bug", "ui"] }), null)).toEqual([labelled[0]]);
  });

  /// GitHub spells a label however somebody typed it, and two rows of one list
  /// can disagree about the case of the same one.
  it("matches a label whatever its case", () => {
    const one = [item({ number: 1, labels: [lab("Bug")] })];
    expect(visiblePrs(one, filters({ labels: ["bug"] }), null)).toEqual(one);
  });

  it("narrows to one checkout", () => {
    const two = [item({ number: 1, cwd: "/a" }), item({ number: 2, cwd: "/b" })];
    expect(visiblePrs(two, filters({ repo: "/b" }), null)).toEqual([two[1]]);
  });
});

describe("the facets a filter menu is built from", () => {
  it("counts each author once and keeps their face", () => {
    const rows = [
      item({ number: 1, author: "bob", avatar: "https://a/bob.png" }),
      item({ number: 2, author: "alice" }),
      item({ number: 3, author: "bob", avatar: null }),
    ];

    expect(authorFacets(rows)).toEqual([
      { login: "alice", avatar: null, count: 1 },
      { login: "bob", avatar: "https://a/bob.png", count: 2 },
    ]);
  });

  /// Most-used first, because a repository's twenty labels are never all
  /// interesting and the count is the only thing saying which are.
  it("counts labels and puts the common ones first", () => {
    const rows = [
      item({ number: 1, labels: [lab("bug", "d73a4a"), lab("ui")] }),
      item({ number: 2, labels: [lab("bug", "d73a4a")] }),
    ];

    expect(labelFacets(rows)).toEqual([
      { name: "bug", color: "d73a4a", count: 2 },
      { name: "ui", color: null, count: 1 },
    ]);
  });
});

describe("isFiltered", () => {
  /// What the "clear" control is drawn from: a button that clears filters
  /// nothing set is a button that does nothing.
  it("knows when the reader has narrowed something", () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered(filters({ state: "all" }))).toBe(true);
    expect(isFiltered(filters({ involvement: "authored" }))).toBe(true);
    expect(isFiltered(filters({ query: "flaky" }))).toBe(true);
    // Whitespace is not a search.
    expect(isFiltered(filters({ query: "   " }))).toBe(false);
    // Both new groups, or the menu's own count is one short of what it drew.
    expect(isFiltered(filters({ labels: ["bug"] }))).toBe(true);
    expect(isFiltered(filters({ repo: "/repo/one" }))).toBe(true);
  });
});
