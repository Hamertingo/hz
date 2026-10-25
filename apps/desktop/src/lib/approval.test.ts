import { describe, expect, it } from "vitest";

import { approveOption, declineOption } from "./approval";
import type { PermissionOption } from "@/types/events";

const opt = (id: string, kind: PermissionOption["kind"], behavior: PermissionOption["behavior"]) =>
  ({ id, label: id, kind, behavior }) as PermissionOption;

describe("inline approval", () => {
  const options = [
    opt("always", "always_rule", "allow"),
    opt("once", "once", "allow"),
    opt("no", "deny", "deny"),
  ];

  it("approves with the option that commits to the least", () => {
    expect(approveOption(options)?.id).toBe("once");
  });

  it("falls back to any allowing option, and to none", () => {
    expect(approveOption([opt("always", "always_rule", "allow"), opt("no", "deny", "deny")])?.id).toBe("always");
    expect(approveOption([opt("no", "deny", "deny")])).toBeNull();
  });

  it("declines with the deny option, or offers no decline", () => {
    expect(declineOption(options)?.id).toBe("no");
    expect(declineOption([opt("once", "once", "allow")])).toBeNull();
  });
});
