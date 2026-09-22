import { describe, expect, it } from "vitest";

import { findPrRefs } from "@/lib/prRef";

describe("findPrRefs", () => {
  it("finds a reference and where it sits", () => {
    // `opened #7 for you` — the `#` at 7, the run ending after the digit.
    expect(findPrRefs("opened #7 for you")).toEqual([{ number: 7, start: 7, end: 9 }]);
  });

  it("finds several, and a multi-digit number", () => {
    expect(findPrRefs("#3 then #128").map((r) => r.number)).toEqual([3, 128]);
  });

  it("takes the digits and stops, leaving the sentence's punctuation", () => {
    // The chip must not swallow the comma, or the message reads as if the
    // punctuation were typed inside the reference.
    expect(findPrRefs("see #7, and #9.")).toEqual([
      { number: 7, start: 4, end: 6 },
      { number: 9, start: 12, end: 14 },
    ]);
    expect(findPrRefs("#7's title").map((r) => r.number)).toEqual([7]);
  });

  /// The rule the issue tag states, and the reason it exists: a `#` inside a
  /// word is a colour or a fragment, never a reference. `#fff` is not a number
  /// at all; `#7f7f7f` is a number followed by a letter.
  it("stays out of a word", () => {
    expect(findPrRefs("colour #fff here")).toEqual([]);
    expect(findPrRefs("colour #7f7f7f here")).toEqual([]);
    expect(findPrRefs("#7abc")).toEqual([]);
    expect(findPrRefs("v1#7")).toEqual([]);
  });

  it("opens behind bracketing punctuation", () => {
    expect(findPrRefs("(see #7)").map((r) => r.number)).toEqual([7]);
    expect(findPrRefs("[#7]").map((r) => r.number)).toEqual([7]);
  });

  it("needs a digit, so a lone # is not one", () => {
    expect(findPrRefs("a # b")).toEqual([]);
    expect(findPrRefs("#")).toEqual([]);
  });

  /// A markdown heading is a `#` and a space, which never matches because the
  /// space is not a digit.
  it("leaves a markdown heading alone", () => {
    expect(findPrRefs("# 7 things")).toEqual([]);
  });
});
