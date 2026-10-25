import type { CallRecord, CatalogEntry, Plugin, Policy, ToolPolicy } from "@/types/events";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/// The three sections of the page.
export type PluginsTab = "connected" | "catalog" | "skills";

export const POLICIES: readonly Policy[] = ["allow", "ask", "off"];

export const POLICY_LABEL: Record<Policy, string> = { allow: "Allow", ask: "Ask", off: "Off" };

/// Whether a name matches what the search box holds, ignoring case. An empty
/// query matches everything.
export function matches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
}

/// Calls to one plugin in the last seven days.
export function callsThisWeek(calls: readonly CallRecord[], pluginId: string, now: number): number {
  return calls.filter((c) => c.plugin === pluginId && c.t > now - WEEK).length;
}

/// Fourteen bars of calls per day, oldest first, as pixel heights from 2 to 14.
/// A plugin nobody has called gets a flat row rather than nothing, so the card's
/// shape does not depend on its history.
export function spark(calls: readonly CallRecord[], pluginId: string, now: number, days = 14): number[] {
  const counts = new Array<number>(days).fill(0);
  for (const c of calls) {
    if (c.plugin !== pluginId) continue;
    const back = Math.floor((now - c.t) / DAY);
    if (back >= 0 && back < days) counts[days - 1 - back] += 1;
  }
  const max = Math.max(...counts, 1);
  return counts.map((n) => 2 + Math.round((n / max) * 12));
}

/// The newest calls to one plugin, newest first.
export function recentCalls(calls: readonly CallRecord[], pluginId: string, limit = 6): CallRecord[] {
  return calls
    .filter((c) => c.plugin === pluginId)
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
}

/// A call's clock time, "21:14".
export function clockOf(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/// How long a call took: "0.4s", "12s", or "-" when it never ran.
export function durationOf(ms: number): string {
  if (ms <= 0) return "-";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

/// What a call's outcome reads as in the log. A plain allowed call says nothing.
export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "approved":
      return "you said yes";
    case "denied":
      return "you said no";
    case "off":
      return "switched off";
    case "revoked":
      return "not granted";
    case "error":
      return "failed";
    default:
      return "";
  }
}

/// The agents that hold a plugin, among those given.
export function holders<T extends { id: string }>(plugin: Plugin, agents: readonly T[]): T[] {
  return agents.filter((a) => plugin.grants.includes(a.id));
}

/// How many squares of the grant matrix are on, and how many there are.
export function matrixCount(plugins: readonly Plugin[], agents: readonly { id: string }[]): { on: number; all: number } {
  let on = 0;
  for (const p of plugins) for (const a of agents) if (p.grants.includes(a.id)) on += 1;
  return { on, all: plugins.length * agents.length };
}

export const CATEGORIES = ["Talk", "Work", "Code", "Data"] as const;

/// Catalog entries not yet connected, matching the search, by category in the
/// order the page shows them. Slack is left out: it has a band of its own.
export function catalogGroups(
  catalog: readonly CatalogEntry[],
  connected: ReadonlySet<string>,
  query: string,
): { category: string; items: CatalogEntry[] }[] {
  const open = catalog.filter((c) => !connected.has(c.id) && matches(c.name, query) && c.id !== "slack");
  return CATEGORIES.map((category) => ({ category, items: open.filter((c) => c.category === category) })).filter(
    (g) => g.items.length > 0,
  );
}

/// What signing in to a catalog entry asks of the reader, in a few words.
export function authNote(entry: CatalogEntry): string | null {
  switch (entry.auth.kind) {
    case "oauth_own":
      return "Needs your own OAuth client";
    case "token":
      return entry.auth.target === "arg" ? "Needs a connection string" : "Needs an access token";
    case "none":
      return "Runs on this Mac";
    default:
      return null;
  }
}

/// A policy for each tool of a plugin, changed where `name` matches.
export function withPolicy(tools: readonly ToolPolicy[], name: string, policy: Policy): ToolPolicy[] {
  return tools.map((t) => (t.name === name ? { ...t, policy } : t));
}

/// The date a plugin was connected, "Oct 22".
export function connectedOn(t: number | null): string {
  if (!t) return "";
  return new Date(t).toLocaleDateString("en", { month: "short", day: "numeric" });
}

/// What the connection line under a plugin's name says.
export function connectionLine(plugin: Plugin): string {
  if (plugin.status === "not") return "Needs to be connected again";
  switch (plugin.auth) {
    case "oauth":
    case "oauth_own":
      return "Connected through OAuth";
    case "token":
      return "Connected with a token";
    default:
      return plugin.transport.kind === "stdio" ? "Runs on this Mac" : "Connected";
  }
}

/// What a grant change tells the reader, since a new grant and a taken one do not
/// land at the same moment.
export function grantToast(agent: string, plugin: string, on: boolean): string {
  return on ? `${agent} can use ${plugin} from its next session` : `${agent} can no longer use ${plugin}`;
}

/// What a new Skill's editor starts with.
export const NEW_SKILL_MD = "---\nname: \ndescription: \n---\n\n1. ";
