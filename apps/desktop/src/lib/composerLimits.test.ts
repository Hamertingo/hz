import { describe, expect, it } from "vitest";

import {
  MAX_PROMPT_CHARS,
  PASTE_AS_FILE_CHARS,
  overLimitNote,
  pasteBecomesFile,
} from "@/lib/composerLimits";

describe("composerLimits", () => {
  /// The threshold is a size, not a smell: one character under it is still text
  /// the reader meant to type, and reading it as "this is really a file" would
  /// take their paste away from them.
  it("keeps a paste below the threshold as text", () => {
    expect(pasteBecomesFile("x".repeat(PASTE_AS_FILE_CHARS - 1))).toBe(false);
    expect(pasteBecomesFile("x".repeat(PASTE_AS_FILE_CHARS))).toBe(true);
  });

  it("says nothing about a draft inside the limit", () => {
    expect(overLimitNote("")).toBeNull();
    expect(overLimitNote("x".repeat(MAX_PROMPT_CHARS))).toBeNull();
  });

  /// The line names both figures, because "too long" leaves the reader to guess
  /// which way to cut, and the escape hatch is the whole reason the limit is
  /// reachable rather than fatal.
  it("names the length, the limit and the way out", () => {
    const note = overLimitNote("x".repeat(MAX_PROMPT_CHARS + 1));
    expect(note).toContain("120k");
    expect(note).toContain("paste the rest as a file");

    expect(overLimitNote("x".repeat(128_400))).toContain("128.4k");
  });
});
