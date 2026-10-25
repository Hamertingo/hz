import { MASCOT_COLORS } from "@/lib/mascots";
import type { Workspace, WorkspaceDefaults } from "@/types/events";

/// The workspace on screen: the stored pick when it still exists, otherwise the
/// first. A deleted workspace's id lingering in `settings.json` must not leave
/// the app with nothing up.
export function activeWorkspace(workspaces: readonly Workspace[], storedId: string | null): Workspace | null {
  return workspaces.find((w) => w.id === storedId) ?? workspaces[0] ?? null;
}

/// The letter a generated logo spells, kept in step with the name.
export function workspaceMark(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toUpperCase() : "W";
}

/// The next colour in the palette after `current`, for "Generate": a fresh logo
/// is the same dither in the next colour round.
export function nextColor(current: string): string {
  const at = MASCOT_COLORS.indexOf(current as (typeof MASCOT_COLORS)[number]);
  return MASCOT_COLORS[(at + 1) % MASCOT_COLORS.length];
}

/// "5 agents · 2 working", and "No agents" for an empty team.
export function workspaceLine(agents: number, working: number): string {
  if (agents === 0) return "No agents yet";
  const base = `${agents} ${agents === 1 ? "agent" : "agents"}`;
  return working > 0 ? `${base} · ${working} working` : base;
}

/// Whether the typed name opens the delete button. Exact, as the dialog says.
export function confirmsDelete(typed: string, name: string): boolean {
  return typed === name;
}

/// What a workspace written before the defaults existed reads as. Mirrors
/// `WorkspaceDefaults::default()` in `workspaces.rs`.
export const DEFAULT_WORKSPACE_DEFAULTS: WorkspaceDefaults = {
  harness: null,
  permission: null,
  folder: null,
  sayHello: true,
  tidy: false,
  tidyTime: "03:00",
  sharedMemory: false,
  handoffs: 8,
  waitMins: 10,
  onLimit: "ask",
  fallbackHarness: "codex-acp",
  budgetUsd: null,
  budgetAction: "ask",
  alertPct: 80,
  taskCapUsd: null,
  plans: {},
};
