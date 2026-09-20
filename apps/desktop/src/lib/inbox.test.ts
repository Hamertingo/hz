import { describe, expect, it } from "vitest";

import { groupInbox, inboxItems } from "@/lib/inbox";
import type { Issue, IssueStateKind, PrListItem } from "@/types/events";

/// Both fixtures are built from a base and cast, the way the transcript tests
/// build an event: every field the rules do not read is noise per row, and one
/// that *is* read is named at the case that reads it.
const prRow = (over: Partial<PrListItem> & { cwd?: string } = {}) =>
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
    cwd: "/repo",
    ...over,
  }) as PrListItem & { cwd: string };

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

describe("inboxItems", () => {
  it("carries both trackers, each keyed so the two cannot collide", () => {
    const items = inboxItems([prRow({ number: 12 })], [issueRow({ identifier: "DRA-53" })], "me");
    expect(items.map((item) => item.key).sort()).toEqual(["issue:linear:DRA-53", "pr:/repo#12"]);
  });

  // The pull-requests page's own rule, carried across: the thing that wants
  // doing is the thing somebody asked you for.
  it("files a pull request you were asked to review under Waiting, authored or not", () => {
    const mine = prRow({ author: "me", reviewRequests: ["me"] });
    const [item] = inboxItems([mine], [], "me");
    expect(item.group).toBe("waiting");
  });

  it("files your own under Yours and a stranger's under Others", () => {
    const items = inboxItems(
      [prRow({ number: 1, author: "me" }), prRow({ number: 2, author: "them" })],
      [],
      "me",
    );
    expect(items.map((item) => item.group).sort()).toEqual(["others", "yours"]);
  });

  /// `gh` would not say who we are, so nothing is ours *by name* — the honest
  /// answer rather than filing everything under Yours.
  it("claims nothing for the reader when the viewer is unknown", () => {
    const items = inboxItems([prRow({ author: "me", reviewRequests: ["me"] })], [], null);
    expect(items[0].group).toBe("others");
  });

  // The one signal Linear gives that outranks the queue.
  it("treats an urgent issue as waiting on you and the rest as yours", () => {
    const items = inboxItems(
      [],
      [issueRow({ identifier: "DRA-1", priority: "urgent" }), issueRow({ identifier: "DRA-2" })],
      "me",
    );
    expect(items.find((i) => i.key.endsWith("DRA-1"))?.group).toBe("waiting");
    expect(items.find((i) => i.key.endsWith("DRA-2"))?.group).toBe("yours");
  });

  /// **The order is the logic**, and these are the pairs where it shows.
  it("answers a conflict before a failing check, and a failing check before a review", () => {
    const [conflict] = inboxItems(
      [prRow({ mergeable: "CONFLICTING", checksState: "FAILING", reviewDecision: "CHANGES_REQUESTED" })],
      [],
      "me",
    );
    expect(conflict.reason?.label).toBe("Conflict");

    const [failing] = inboxItems(
      [prRow({ checksState: "FAILING", reviewDecision: "CHANGES_REQUESTED" })],
      [],
      "me",
    );
    expect(failing.reason?.label).toBe("Checks failing");
  });

  it("calls a cleared, approved pull request ready to merge", () => {
    const [item] = inboxItems(
      [prRow({ checksState: "CLEAR", reviewDecision: "APPROVED" })],
      [],
      "me",
    );
    expect(item.reason).toEqual({ label: "Ready to merge", tone: "good" });
  });

  it("calls a draft a draft rather than waiting on a reviewer", () => {
    const [item] = inboxItems([prRow({ isDraft: true, reviewDecision: "REVIEW_REQUIRED" })], [], "me");
    expect(item.group).not.toBe("waiting");
    // And wears nothing: the row draws the draft glyph, and a word repeating it
    // would spend the scarce end of the line on a fact already on screen.
    expect(item.reason).toBeNull();
  });

  it("does not call a suite that is still running ready", () => {
    const [item] = inboxItems(
      [prRow({ checksState: "RUNNING", reviewDecision: "APPROVED" })],
      [],
      "me",
    );
    expect(item.reason).toBeNull();
  });

  it("draws nothing for a clean, open pull request nobody has to act on", () => {
    const [item] = inboxItems([prRow()], [], "me");
    expect(item.reason).toBeNull();
  });

  it("wears a chip only where there is something to say", () => {
    const items = inboxItems(
      [],
      [
        issueRow({ identifier: "DRA-1", priority: "urgent" }),
        issueRow({ identifier: "DRA-2", state: { id: "s", name: "Shipping", kind: "started", color: "#fff" } }),
      ],
      "me",
    );
    expect(items.find((i) => i.key.endsWith("DRA-1"))?.reason).toEqual({
      label: "Urgent",
      tone: "bad",
    });
    // An issue that is merely assigned: the glyph carries its state, so the row
    // says nothing rather than saying it twice.
    expect(items.find((i) => i.key.endsWith("DRA-2"))?.reason).toBeNull();
  });
});

describe("groupInbox", () => {
  it("keeps the three in the order attention reaches them and drops an empty one", () => {
    const items = inboxItems(
      [prRow({ number: 2, author: "them" })],
      [issueRow({ identifier: "DRA-1", priority: "urgent" })],
      "me",
    );
    expect(groupInbox(items).map((group) => group.key)).toEqual(["waiting", "others"]);
  });

  it("orders the whole list by the newest stamp across both trackers", () => {
    const items = inboxItems(
      [prRow({ number: 1, author: "me", updatedAt: "2026-01-01T00:00:00Z" })],
      [issueRow({ updatedAt: "2026-09-01T00:00:00Z" })],
      "me",
    );
    expect(items[0].kind).toBe("issue");
  });

  /// A stamp neither side can parse sorts last rather than throwing the order
  /// away — `NaN` through the comparator would leave the list as it fell.
  it("sorts an unreadable stamp last instead of scrambling the list", () => {
    const items = inboxItems(
      [prRow({ number: 1, author: "me", updatedAt: "not a date" })],
      [issueRow({ updatedAt: "2026-01-01T00:00:00Z" })],
      "me",
    );
    expect(items.map((item) => item.kind)).toEqual(["issue", "pr"]);
  });
});
