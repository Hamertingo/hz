import { describe, expect, it } from "vitest";

import { attributeAgent, boardLanes, prLane } from "./prBoard";
import type { PrListItem } from "@/types/events";

function pr(over: Partial<PrListItem> = {}): PrListItem {
  return {
    number: 1,
    title: "t",
    url: "https://github.com/x/y/pull/1",
    state: "OPEN",
    isDraft: false,
    author: "ada",
    avatar: null,
    headRefName: "feat/x",
    baseRefName: "main",
    updatedAt: "2026-10-23T00:00:00Z",
    createdAt: "2026-10-23T00:00:00Z",
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    reviewDecision: null,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    checksState: "CLEAR",
    reviewRequests: [],
    labels: [],
    ...over,
  } as PrListItem;
}

describe("prLane", () => {
  it("puts a review asked of the viewer in the first lane", () => {
    expect(prLane(pr({ reviewRequests: ["Me"] }), "me")).toBe("you");
  });

  it("keeps a draft out of the first lane even when a review was asked", () => {
    expect(prLane(pr({ isDraft: true, reviewRequests: ["me"] }), "me")).toBe("work");
  });

  it("holds a PR whose checks are running or failing with the work", () => {
    expect(prLane(pr({ checksState: "RUNNING" }), "me")).toBe("work");
    expect(prLane(pr({ checksState: "FAILING" }), "me")).toBe("work");
  });

  it("holds a change request with the work", () => {
    expect(prLane(pr({ reviewDecision: "CHANGES_REQUESTED" }), "me")).toBe("work");
  });

  it("is ready only when approved, green and not conflicting", () => {
    expect(prLane(pr({ reviewDecision: "APPROVED" }), "me")).toBe("ready");
    expect(
      prLane(pr({ reviewDecision: "APPROVED", mergeable: "CONFLICTING" }), "me"),
    ).toBe("work");
    expect(
      prLane(pr({ reviewDecision: "APPROVED", checksState: "FAILING" }), "me"),
    ).toBe("work");
  });

  it("does not treat a missing viewer as a request for the reader", () => {
    expect(prLane(pr({ reviewRequests: ["me"] }), null)).toBe("work");
  });
});

describe("boardLanes", () => {
  it("drops merged and closed rows and sorts the rest", () => {
    const lanes = boardLanes(
      [
        pr({ number: 1, reviewRequests: ["me"] }),
        pr({ number: 2, state: "MERGED", reviewDecision: "APPROVED" }),
        pr({ number: 3, state: "CLOSED", isDraft: true }),
        pr({ number: 4, reviewDecision: "APPROVED" }),
      ],
      "me",
    );
    expect(lanes.you.map((p) => p.number)).toEqual([1]);
    expect(lanes.work).toEqual([]);
    expect(lanes.ready.map((p) => p.number)).toEqual([4]);
  });
});

describe("attributeAgent", () => {
  const agents = [
    { agentId: "ada", projectPath: "/r/api", branch: "worktree-warm-pool" },
    { agentId: "leo", projectPath: "/r/site", branch: "post/sandbox" },
  ];

  it("attributes a PR to the agent whose branch it is opened from", () => {
    expect(attributeAgent({ cwd: "/r/api", headRefName: "worktree-warm-pool" }, agents)).toBe("ada");
  });

  it("does not attribute across repositories that share a branch name", () => {
    expect(attributeAgent({ cwd: "/r/site", headRefName: "worktree-warm-pool" }, agents)).toBeNull();
  });

  it("returns null for a PR no agent opened", () => {
    expect(attributeAgent({ cwd: "/r/api", headRefName: "main-fix" }, agents)).toBeNull();
  });
});
