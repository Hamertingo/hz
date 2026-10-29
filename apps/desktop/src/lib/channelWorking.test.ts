import { describe, expect, it } from "vitest";

import { afterPost, isFailureNote } from "./channelWorking";

describe("the answering line", () => {
  it("drops the agent that just posted and keeps the rest", () => {
    expect(afterPost({ agents: ["a", "b"], round: 1 }, "a")).toEqual({ agents: ["b"], round: 1 });
  });

  it("clears the round when the last agent posts", () => {
    expect(afterPost({ agents: ["a"], round: 2 }, "a")).toEqual({ agents: [], round: 0 });
  });

  it("is the same object when the poster was not being waited on", () => {
    const w = { agents: ["a"], round: 1 };
    expect(afterPost(w, "me")).toBe(w);
  });

  it("knows the failure lines the engine writes", () => {
    expect(isFailureNote("Atlas could not answer: it stopped before answering")).toBe(true);
    expect(isFailureNote("The agents stopped unexpectedly. Try again.")).toBe(true);
    expect(isFailureNote("Round 2")).toBe(false);
  });
});
