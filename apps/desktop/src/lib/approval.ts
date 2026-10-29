import type { PermissionOption } from "@/types/events";

/// The option that lets the call run once, else the first that lets it run at
/// all. `null` for a request offering no way to say yes, which draws no Approve.
export function approveOption(options: readonly PermissionOption[]): PermissionOption | null {
  return (
    options.find((o) => o.kind === "once" && o.behavior !== "deny") ??
    options.find((o) => o.behavior !== "deny") ??
    null
  );
}

/// The option that says no. `null` when the agent offered none.
export function declineOption(options: readonly PermissionOption[]): PermissionOption | null {
  return options.find((o) => o.behavior === "deny") ?? null;
}
