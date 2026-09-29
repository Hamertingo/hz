import { describe, expect, it } from "vitest";

import { CHECK_FRESH_FOR_MS, checkDue, checkSummary, checkedAgo } from "@/lib/providerChecks";
import type { ProviderCheck } from "@/types/events";

const AT = 1_700_000_000_000;

function check(parts: Partial<ProviderCheck> = {}): ProviderCheck {
  return {
    checkedAt: AT,
    fingerprint: "https://models.example/v1\nopenai-completions",
    added: 0,
    missing: [],
    outcome: "served",
    ...parts,
  };
}

describe("when a provider is worth asking again", () => {
  it("asks a provider nothing has ever asked about", () => {
    expect(checkDue(undefined, AT)).toBe(true);
  });

  it("holds a reading for the ten minutes the model probe is held for", () => {
    expect(checkDue(check(), AT + CHECK_FRESH_FOR_MS - 1)).toBe(false);
    expect(checkDue(check(), AT + CHECK_FRESH_FOR_MS)).toBe(true);
  });
});

describe("how old a reading is", () => {
  it.each([
    [0, "just now"],
    [59_000, "just now"],
    [61_000, "1m ago"],
    [90_000, "2m ago"],
    [59 * 60_000, "59m ago"],
    [3 * 60 * 60_000, "3h ago"],
    [50 * 60 * 60_000, "2d ago"],
  ])("renders %i ms as %s", (elapsed, expected) => {
    expect(checkedAgo(check(), AT + elapsed)).toBe(expected);
  });

  it("does not render a reading from a clock ahead of this one as negative", () => {
    expect(checkedAgo(check(), AT - 5_000)).toBe("just now");
  });
});

describe("what a reading says under the list", () => {
  it("says nothing when it found nothing", () => {
    expect(checkSummary(check())).toBeNull();
  });

  it("carries the gateway's own sentence when it refused", () => {
    const summary = checkSummary(
      check({ outcome: "failed", error: "https://models.example/v1/models: authentication failed (HTTP 401)" }),
    );
    expect(summary).toEqual({
      text: "https://models.example/v1/models: authentication failed (HTTP 401)",
      bad: true,
    });
  });

  it("still says something when a failure carried no sentence", () => {
    expect(checkSummary(check({ outcome: "failed" }))?.text).toBe("The gateway did not answer.");
  });

  it("tells an answer with nothing registerable apart from a refusal", () => {
    const summary = checkSummary(check({ outcome: "empty" }));
    expect(summary).toEqual({ text: "The gateway serves nothing this build can register.", bad: false });
  });

  it("reports both halves of a list that moved in one line", () => {
    expect(checkSummary(check({ added: 3, missing: ["one", "two"] }))).toEqual({
      text: "3 new · 2 not listed by the gateway",
      bad: false,
    });
  });

  it("counts each half on its own", () => {
    expect(checkSummary(check({ added: 1 }))?.text).toBe("1 new");
    expect(checkSummary(check({ missing: ["gone"] }))?.text).toBe("1 not listed by the gateway");
  });
});
