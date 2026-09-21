import { describe, expect, it } from "vitest";

import { BYOK_FALLBACK_CONTEXT, compactLimit, limitLabel } from "./providerLimits";

describe("compactLimit", () => {
  it("truncates at each scale rather than rounding", () => {
    expect(compactLimit(1_000_000)).toBe("1M");
    expect(compactLimit(2_000_000)).toBe("2M");
    expect(compactLimit(200_000)).toBe("200k");
    expect(compactLimit(16_384)).toBe("16k");
    expect(compactLimit(1_048_576)).toBe("1M");
    expect(compactLimit(999)).toBe("999");
  });

  it("keeps a nine-hundred-ninety-nine-thousand window out of the millions", () => {
    // The boundary the wrong comparison would smear: a limit one token short of
    // a million drawn as `1M` is a number nobody published.
    expect(compactLimit(999_999)).toBe("999k");
    expect(compactLimit(1_000)).toBe("1k");
  });
});

describe("limitLabel", () => {
  it("takes a recorded limit as it stands", () => {
    expect(limitLabel(1_000_000, BYOK_FALLBACK_CONTEXT)).toEqual({
      text: "1M",
      recorded: true,
    });
  });

  it("falls back, and says that is what it did", () => {
    // The reader's own case: nothing recorded, so the number drawn is the
    // agent's, and the row has to be able to say which of the two it is.
    for (const unset of [undefined, null, 0]) {
      expect(limitLabel(unset, BYOK_FALLBACK_CONTEXT)).toEqual({
        text: "200k",
        recorded: false,
      });
    }
  });
});
