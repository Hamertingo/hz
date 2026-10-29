import { describe, expect, it } from "vitest";

import { STATUSES, statusLine, statusMeta } from "@/lib/me";

describe("status", () => {
  it("lists Available first and names each state", () => {
    expect(STATUSES.map((s) => s.id)).toEqual(["available", "focus", "away"]);
    expect(statusLine("focus")).toBe("Focus");
  });

  it("reads an unknown state as Available", () => {
    expect(statusMeta("nonsense" as never).id).toBe("available");
  });
});
