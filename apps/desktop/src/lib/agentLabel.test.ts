import { describe, expect, it } from "vitest";

import { displayNames } from "./agentLabel";

const a = (id: string, name: string, role = "") => ({ id, name, role });

describe("displayNames", () => {
  it("leaves unique names alone", () => {
    expect(displayNames([a("1", "Atlas"), a("2", "Ada")]).get("1")).toBe("Atlas");
  });

  it("uses the role when it tells the pair apart", () => {
    const m = displayNames([a("1", "Atlas", "Research"), a("2", "Atlas", "Review")]);
    expect([m.get("1"), m.get("2")]).toEqual(["Atlas · Research", "Atlas · Review"]);
  });

  it("numbers them when roles are missing or equal", () => {
    const m = displayNames([a("1", "Atlas"), a("2", "Atlas", "Review")]);
    expect([m.get("1"), m.get("2")]).toEqual(["Atlas (1)", "Atlas (2)"]);
  });
});
