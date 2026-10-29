import { describe, expect, it } from "vitest";

import { toggled } from "./reactions";

describe("reactions", () => {
  it("adds a reaction and a second press takes it back", () => {
    expect(toggled([], "👍")).toEqual(["👍"]);
    expect(toggled(["👍", "🎉"], "👍")).toEqual(["🎉"]);
  });
});
