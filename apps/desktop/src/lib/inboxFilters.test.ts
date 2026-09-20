import { describe, expect, it } from "vitest";

import { inboxItems } from "@/lib/inbox";
import {
  ANY,
  DEFAULT_INBOX_FILTERS,
  applyInboxFilters,
  inboxFilterCount,
  projectOptions,
  repoOptions,
} from "@/lib/inboxFilters";
import type { Issue, IssueStateKind, PrListItem } from "@/types/events";

/// Built from a base and cast, the way the sibling tests build a row: every
/// field the rules do not read is noise per row, and one that *is* read is named
/// at the case that reads it.
const prRow = (over: Partial<PrListItem> & { cwd?: string; repo?: string } = {}) =>
  ({
    number: 1,
    title: "a pull request",
    url: "https://example.test/pr/1",
    state: "OPEN",
    isDraft: false,
    author: "someone",
    avatar: null,
    headRefName: "feature",
    baseRefName: "main",
    updatedAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-08-01T00:00:00Z",
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    reviewDecision: null,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    checksState: "CLEAR",
    reviewRequests: [],
    labels: [],
    cwd: "/code/hz",
    repo: "hz",
    ...over,
  }) as PrListItem & { cwd: string; repo: string };

const issueRow = (over: Partial<Issue> = {}) =>
  ({
    tracker: "linear",
    id: "uuid",
    identifier: "DRA-53",
    title: "an issue",
    url: "https://example.test/DRA-53",
    state: { id: "s", name: "Todo", kind: "unstarted" as IssueStateKind, color: "#fff" },
    priority: "medium",
    assignee: { name: "me", avatar: null },
    labels: [],
    team: "DRA",
    project: null,
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  }) as Issue;

/// One of each, so every facet has a half to narrow.
const rows = inboxItems([prRow({ author: "hamerti" })], [issueRow()], "hamerti");

const withQuery = (query: string) => applyInboxFilters(rows, { ...DEFAULT_INBOX_FILTERS, query });

describe("applyInboxFilters", () => {
  it("finds a row by its title, its key, its branch or whoever wrote it", () => {
    expect(withQuery("pull request")).toHaveLength(1);
    expect(withQuery("DRA-53")).toHaveLength(1);
    expect(withQuery("feature")).toHaveLength(1);
    expect(withQuery("hamerti")).toHaveLength(1);
    // Case is not the reader's problem.
    expect(withQuery("DRA-53".toLowerCase())).toHaveLength(1);
  });

  it("matches nothing rather than everything for a word no row says", () => {
    expect(withQuery("kubernetes")).toHaveLength(0);
  });

  // **A checkout is not a fact about an issue**, so choosing one narrows the
  // pull requests and leaves the other half alone rather than emptying it.
  it("narrows pull requests by checkout and leaves issues untouched", () => {
    const filtered = applyInboxFilters(rows, { ...DEFAULT_INBOX_FILTERS, repo: "/code/other" });
    expect(filtered.map((item) => item.kind)).toEqual(["issue"]);

    const kept = applyInboxFilters(rows, { ...DEFAULT_INBOX_FILTERS, repo: "/code/hz" });
    expect(kept).toHaveLength(2);
  });

  it("narrows issues by project and leaves pull requests untouched", () => {
    const filtered = applyInboxFilters(rows, { ...DEFAULT_INBOX_FILTERS, project: "Composer" });
    expect(filtered.map((item) => item.kind)).toEqual(["pr"]);

    const kept = applyInboxFilters(
      inboxItems([prRow()], [issueRow({ project: "Composer" })], "hamerti"),
      { ...DEFAULT_INBOX_FILTERS, project: "Composer" },
    );
    expect(kept).toHaveLength(2);
  });

  it("drops what is older than the window, measured from the clock it is given", () => {
    const now = Date.parse("2026-09-01T12:00:00Z");
    const items = inboxItems(
      [
        prRow({ number: 1, updatedAt: "2026-09-01T09:00:00Z" }),
        prRow({ number: 2, updatedAt: "2026-08-20T09:00:00Z" }),
      ],
      [],
      "hamerti",
    );

    expect(applyInboxFilters(items, { ...DEFAULT_INBOX_FILTERS, time: "today" }, now)).toHaveLength(1);
    // The older one is inside a week — the window is what separates the two
    // filters, not just their names.
    expect(applyInboxFilters(items, { ...DEFAULT_INBOX_FILTERS, time: "week" }, now)).toHaveLength(1);
    expect(applyInboxFilters(items, { ...DEFAULT_INBOX_FILTERS, time: "all" }, now)).toHaveLength(2);
  });

  /// A narrowing must not become a way to lose a row nothing is known about.
  it("keeps a row whose stamp cannot be read", () => {
    const items = inboxItems([prRow({ updatedAt: "not a date" })], [], "hamerti");
    expect(
      applyInboxFilters(items, { ...DEFAULT_INBOX_FILTERS, time: "today" }, Date.now()),
    ).toHaveLength(1);
  });

  it("keeps the run that is asking for the reader and nothing else", () => {
    const items = inboxItems(
      [prRow({ number: 1, reviewRequests: ["hamerti"] }), prRow({ number: 2, author: "them" })],
      [],
      "hamerti",
    );
    const filtered = applyInboxFilters(items, { ...DEFAULT_INBOX_FILTERS, waiting: true });
    expect(filtered.map((item) => item.title)).toEqual(["a pull request"]);
    expect(filtered[0].group).toBe("waiting");
  });
});

describe("inboxFilterCount", () => {
  it("counts the menu's own controls and not the box beside it", () => {
    expect(inboxFilterCount(DEFAULT_INBOX_FILTERS)).toBe(0);
    expect(inboxFilterCount({ ...DEFAULT_INBOX_FILTERS, query: "anything" })).toBe(0);
    expect(
      inboxFilterCount({ ...DEFAULT_INBOX_FILTERS, time: "today", waiting: true, repo: "/code/hz" }),
    ).toBe(3);
  });
});

describe("the facet lists", () => {
  it("names each checkout once, by its own directory", () => {
    const items = inboxItems(
      [prRow(), prRow({ number: 2, cwd: "/code/hz-web", repo: "hz-web" })],
      [],
      "hamerti",
    );
    expect(repoOptions(items)).toEqual([
      { value: "/code/hz", label: "hz" },
      { value: "/code/hz-web", label: "hz-web" },
    ]);
  });

  it("lists the projects issues are in and skips the ones with none", () => {
    const items = inboxItems(
      [],
      [
        issueRow({ identifier: "DRA-1", project: "Composer" }),
        issueRow({ identifier: "DRA-2", project: "Composer" }),
        issueRow({ identifier: "DRA-3", project: "Automations" }),
        issueRow({ identifier: "DRA-4", project: null }),
      ],
      "hamerti",
    );
    expect(projectOptions(items)).toEqual(["Automations", "Composer"]);
    expect(repoOptions(items)).toEqual([]);
  });

  it("reads the sentinel as no filter at all", () => {
    expect(ANY).toBe("all");
  });
});
