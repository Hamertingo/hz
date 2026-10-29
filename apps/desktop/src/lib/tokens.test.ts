import { describe, expect, it } from "vitest";

import { estimateTokens, tokLabel } from "./tokens";

describe("token estimate", () => {
  it("is four characters to a token, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(412 * 4))).toBe(412);
  });

  it("counts a character, not a byte", () => {
    expect(estimateTokens("ção")).toBe(1);
    expect(estimateTokens("🙂🙂🙂🙂")).toBe(1);
  });

  it("labels a layer", () => {
    expect(tokLabel(112)).toBe("112 tok");
    expect(tokLabel(1234)).toBe("1,234 tok");
    expect(tokLabel(12_345)).toBe("12k tok");
  });
});
