import { describe, expect, it } from "vitest";

import { asUnavailable } from "@/hooks/usePrList";

describe("asUnavailable", () => {
  /// **A rejected read is already this shape.** Both commands answer
  /// `Result<_, PrUnavailable>`, so the refusal crosses the bridge as the tagged
  /// object — and `String(it)` is `[object Object]`, which is what the page
  /// printed before this checked.
  it("keeps a tagged refusal whole", () => {
    expect(asUnavailable({ kind: "no_cli" })).toEqual({ kind: "no_cli" });
    expect(asUnavailable({ kind: "other", detail: "not a git repository" })).toEqual({
      kind: "other",
      detail: "not a git repository",
    });
  });

  /// A rejection this app threw itself is a string, and the three answers the
  /// panel branches on are read back out of it.
  it("classifies a plain string", () => {
    expect(asUnavailable("GitHub CLI (gh) not found.")).toEqual({ kind: "no_cli" });
    expect(asUnavailable("please run gh auth login first")).toEqual({ kind: "not_authenticated" });
    expect(asUnavailable("something else entirely")).toEqual({
      kind: "other",
      detail: "something else entirely",
    });
  });
});
