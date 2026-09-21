import { describe, expect, it } from "vitest";

import {
  activeCount,
  foldSubagents,
  isActive,
  memberFor,
  memberTitle,
  runBrief,
  statusWord,
} from "./subagent";
import type { AgentEvent, DelegatedMember } from "@/types/events";

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

describe("foldSubagents", () => {
  it("follows the work until the reader says otherwise", () => {
    // Open while anything is going, so a fan-out is watchable as it happens…
    expect(foldSubagents(undefined, [member({ status: "running" })])).toBe(false);
    // …and folded once nothing is, so finished runs stop being rows in a list
    // that is a worklist.
    expect(foldSubagents(undefined, [member({ status: "completed" })])).toBe(true);
    expect(foldSubagents(undefined, [])).toBe(true);
  });

  it("takes the reader's own pick over the work", () => {
    expect(foldSubagents(true, [member({ status: "running" })])).toBe(true);
    expect(foldSubagents(false, [member({ status: "completed" })])).toBe(false);
  });
});

describe("memberTitle", () => {
  it("takes the task, then the agent's name, then the floor", () => {
    expect(memberTitle(member({ task: "Map the auth flow", agentName: "explore" }))).toBe(
      "Map the auth flow",
    );
    expect(memberTitle(member({ agentName: "explore" }))).toBe("explore");
    expect(memberTitle(member())).toBe("Subagent");
  });

  it("passes over a task that is only space", () => {
    expect(memberTitle(member({ task: "   ", agentName: "explore" }))).toBe("explore");
  });
});

describe("runBrief", () => {
  /// Only the field the reader looks at. Everything else on a captured event is
  /// irrelevant to reading one prompt out of it.
  const spawn = (payload: unknown) => ({ payload }) as unknown as AgentEvent;

  it("reads mcode's top-level prompt off the spawning call", () => {
    const run = { spawn: spawn({ type: "tool_call_started", input: { prompt: "Map the auth flow" } }) };
    expect(runBrief(run)).toBe("Map the auth flow");
  });

  it("answers nothing where the call says nothing, or is not a spawn", () => {
    expect(runBrief({ spawn: spawn({ type: "tool_call_started", input: {} }) })).toBeNull();
    expect(runBrief({ spawn: spawn({ type: "tool_call_started", input: { prompt: "  " } }) })).toBeNull();
    // An update is not the announcement, and carries no input at all.
    expect(runBrief({ spawn: spawn({ type: "tool_call_updated", input: { prompt: "x" } }) })).toBeNull();
    // A run in a transcript replayed after a restart may hold no call.
    expect(runBrief({ spawn: null })).toBeNull();
  });
});
