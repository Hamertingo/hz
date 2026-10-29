import { describe, expect, it } from "vitest";

import { QUOTE_MAX, addressedAgent, quoteLine, replyTo, seqSelector } from "./reply";

describe("reply quote", () => {
  it("collapses whitespace into one line", () => {
    expect(quoteLine("  one\n\ntwo   three ")).toBe("one two three");
  });

  it("cuts a long message with an ellipsis and keeps a short one whole", () => {
    expect(quoteLine("short")).toBe("short");
    const cut = quoteLine("x".repeat(400));
    expect(cut.length).toBeLessThanOrEqual(QUOTE_MAX);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("builds the target the prompt event stores", () => {
    expect(replyTo(12, "Fechado.\nEscreve a página", "a1")).toEqual({
      seq: 12,
      text: "Fechado. Escreve a página",
      agent: "a1",
    });
  });

  it("addresses the agent quoted and nobody for the reader's own words", () => {
    expect(addressedAgent(replyTo(1, "x", "atlas"))).toBe("atlas");
    expect(addressedAgent(replyTo(1, "x", "me"))).toBeNull();
    expect(addressedAgent(null)).toBeNull();
  });

  it("looks a message up by its seq", () => {
    expect(seqSelector(42)).toBe('[data-msg-seq="42"]');
  });
});
