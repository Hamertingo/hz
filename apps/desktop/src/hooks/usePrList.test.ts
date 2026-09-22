import { describe, expect, it } from "vitest";

import { knownPr } from "@/hooks/usePrList";

/// A cache as the page leaves it: keyed by repository, then state and query.
const listing = (number: number) => ({ items: [{ number }] });

const pageKey = (cwd: string, state: string) => `${cwd}\0${state}\0`;

describe("knownPr", () => {
  const repo = "/Users/me/proj";

  it("answers yes where any state holds the number", () => {
    const cache = new Map([
      [pageKey(repo, "open"), listing(8)],
      [pageKey(repo, "all"), listing(7)],
    ]);

    expect(knownPr(cache, repo, 7)).toBe(true);
    expect(knownPr(cache, repo, 8)).toBe(true);
  });

  /// The answer this whole gate exists to give: a repository that has answered,
  /// and has no such pull request. `#1 priority`, `step #2`.
  it("answers no where every state has answered without it", () => {
    const cache = new Map([[pageKey(repo, "all"), listing(7)]]);

    expect(knownPr(cache, repo, 1)).toBe(false);
  });

  /// **The bug this was rewritten for.** `false` here is what left a whole
  /// session with no chips in it — a listing that has not landed, failed, or
  /// been dropped by a hot reload says nothing about whether the number exists,
  /// and must not be read as "no".
  it("answers nothing where no listing has been read", () => {
    expect(knownPr(new Map(), repo, 7)).toBeNull();
    expect(knownPr(new Map([["/Users/me/other\0all\0", listing(7)]]), repo, 7)).toBeNull();
  });

  it("does not take another repository's listing for this one", () => {
    const other = new Map([[pageKey("/Users/me/proj-2", "all"), listing(7)]]);

    expect(knownPr(other, repo, 7)).toBeNull();
  });

  /// A prefix match on the raw path would let one repository answer for another
  /// whose name starts the same way — which is why the key carries a separator.
  it("does not answer for a repository whose path starts the same way", () => {
    const nested = new Map([[pageKey("/Users/me/project-two", "all"), listing(7)]]);

    expect(knownPr(nested, "/Users/me/proj", 7)).toBeNull();
  });
});
