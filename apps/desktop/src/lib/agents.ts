import type { AgentDraft, PluginAgent } from "@/types/events";

/// What the Agents pane is showing: an Agent that is written down, one being
/// written, or nothing.
///
/// **One value, and `null` is not `"new"`.** "Create an agent" and "an agent
/// named `new`" are two different things, and the second is legal — so a
/// sentinel string would one day open the wrong form. The bargain [`McpPick`]
/// makes.
///
/// [`McpPick`]: ./mcp.ts
export type AgentPick = { mode: "agent"; name: string } | { mode: "new" } | null;

/// A group of Agents under one heading.
export interface AgentGroup {
  key: string;
  label: string;
  agents: PluginAgent[];
}

/// The roster split where a reader expects the line: the roles the agent ships,
/// then the ones written here.
///
/// **The store's own mark decides, not a list of names.** A role added after this
/// build files itself as a built-in, and one that stops shipping stops being
/// drawn as one, which a name list in this file could never keep true.
export function groupAgents(agents: readonly PluginAgent[]): AgentGroup[] {
  const groups: AgentGroup[] = [];
  const builtin = agents.filter((agent) => agent.builtin);
  const yours = agents.filter((agent) => !agent.builtin);

  if (builtin.length > 0) groups.push({ key: "builtin", label: "Built-in", agents: builtin });
  if (yours.length > 0) groups.push({ key: "yours", label: "Yours", agents: yours });
  return groups;
}

/// The rows a query keeps.
///
/// Name, label and description together: somebody looking for the read-only
/// mapper may remember `explore`, `Explore` or "map unfamiliar code".
export function filterAgents(agents: readonly PluginAgent[], query: string): PluginAgent[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...agents];

  return agents.filter((agent) =>
    `${agent.name} ${agent.displayName} ${agent.description ?? ""}`
      .toLocaleLowerCase()
      .includes(needle),
  );
}

/// The agent's own rule for a name, which is also what a `task` call types.
const NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/// The names the store keeps for itself.
///
/// Reserved rather than forbidden: a custom Agent may *be* named one of these,
/// but the store files it under `agent:<name>` so a `task` call naming the bare
/// word still reaches the built-in. Saying so before the round trip is the
/// point — the alternative is a name that saves and then never gets picked.
const RESERVED = new Set(["mavis", "main", "explore", "worker", "verifier"]);

/// What is wrong with a draft, or `null` for one worth saving.
///
/// **The agent's rules, said before the round trip.** The store still has the
/// last word — this says what will be refused, so a reader is told beside the
/// field rather than by a child that took a second to boot.
export function draftProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the agent a name.";
  if (trimmed.length > 60 || !NAME_PATTERN.test(trimmed)) {
    return "A name holds letters, numbers, dots, underscores and hyphens.";
  }
  if (RESERVED.has(trimmed.toLocaleLowerCase())) {
    return `“${trimmed}” is one of the agent's own roles. Pick another name.`;
  }
  return null;
}

/// A blank draft, for the form behind "Create agent".
///
/// **Every field absent, which the agent reads as "not said"** — the form holds
/// its own strings and only turns them into a draft at Save, so there is no
/// empty box to send before then.
export function emptyAgent(): AgentDraft {
  return {
    name: null,
    displayName: null,
    description: null,
    avatar: null,
    systemPrompt: null,
    persona: null,
    // Left to the backend on a creation: it fills the machine's own default,
    // which is the one model a definition can safely name — see `create_agent`.
    model: null,
  };
}

/// How many portraits the store's marker names.
///
/// The agent's own format is `[0-9]`, so this is its ceiling and not a choice
/// made here.
export const PORTRAIT_COUNT = 10;

/// The marker the store reads as "built-in portrait number N".
export function portraitMarker(variant: number): string {
  return `mavis-agent-avatar://default/v1/${variant}`;
}

/// The variant a stored avatar names, or `null` for an image or none at all.
///
/// Parsed rather than pattern-matched loosely: an avatar that is *nearly* a
/// marker is an image the store wrote, and reading it as a variant would draw the
/// wrong thing rather than the right one.
export function portraitVariant(avatar: string | null | undefined): number | null {
  const match = avatar ? /^mavis-agent-avatar:\/\/default\/v1\/(\d)$/u.exec(avatar) : null;
  if (!match) return null;
  const variant = Number(match[1]);
  return variant >= 0 && variant < PORTRAIT_COUNT ? variant : null;
}

/// Whether a stored avatar is a picture rather than a marker.
export function isPicture(avatar: string | null | undefined): boolean {
  if (!avatar) return false;
  return portraitVariant(avatar) === null;
}
