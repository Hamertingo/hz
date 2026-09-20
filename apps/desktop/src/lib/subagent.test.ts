import { describe, expect, it } from "vitest";

import { activeCount, isActive, memberFor, statusWord } from "./subagent";
import type { DelegatedMember } from "@/types/events";

function member(over: Partial<DelegatedMember> = {}): DelegatedMember {
  return {
    sessionId: "mvs_child",
    parentSessionId: "mvs_root",
    agentName: null,
    task: null,
    status: "running",
    backgroundTaskId: null,
    errorMessage: null,
    ...over,
  };
}

describe("isActive", () => {
  it("counts the three words for work still going", () => {
    for (const status of ["queued", "running", "stopping"]) {
      expect(isActive(member({ status }))).toBe(true);
    }
  });

  it("counts a settled child as not going", () => {
    for (const status of ["completed", "failed", "stopped", "unknown"]) {
      expect(isActive(member({ status }))).toBe(false);
    }
  });
});

describe("activeCount", () => {
  it("counts only the ones still going", () => {
    expect(
      activeCount([
        member({ status: "running" }),
        member({ status: "completed" }),
        member({ status: "queued" }),
      ]),
    ).toBe(2);
  });
});

describe("memberFor", () => {
  it("matches a run on the task title before the agent name", () => {
    const members = [
      member({ sessionId: "a", agentName: "explore", task: "Map the auth flow" }),
      member({ sessionId: "b", agentName: "explore", task: "Map the billing flow" }),
    ];

    // Two runs of the same agent are the case the title exists to tell apart.
    expect(
      memberFor({ label: "explore", description: "Map the billing flow" }, members)?.sessionId,
    ).toBe("b");
  });

  it("falls back to the agent name where the run named no title", () => {
    const members = [member({ sessionId: "a", agentName: "worker" })];
    expect(memberFor({ label: "worker", description: null }, members)?.sessionId).toBe("a");
  });

  it("matches nothing when neither side says anything", () => {
    expect(memberFor({ label: null, description: null }, [member()])).toBeNull();
    expect(memberFor({ label: "explore", description: "Map it" }, [])).toBeNull();
  });
});

describe("statusWord", () => {
  it("draws the agent's words as prose", () => {
    expect(statusWord("running")).toBe("Running");
    expect(statusWord("completed")).toBe("Completed");
  });

  it("draws a word this build does not know as itself", () => {
    expect(statusWord("reticulating")).toBe("reticulating");
    expect(statusWord("")).toBe("Unknown");
  });
});
