import type { RosterAgent } from "@/lib/roster";
import type { SlashCommand } from "@/types/events";

/// The commands hz answers itself in an agent's composer, ahead of whatever the
/// CLI publishes. `ask` and `handoff` are rewritten into a sentence the agent
/// acts on with its team tools; `remember`, `routine` and `clear` never reach the
/// agent at all.
export type HzCommandName = "remember" | "ask" | "routine" | "handoff" | "clear";

const COMMANDS: readonly { name: HzCommandName; description: string; argumentHint: string }[] = [
  { name: "remember", description: "Save this to the agent's memory", argumentHint: "<note>" },
  { name: "ask", description: "Ask a teammate and wait for the answer", argumentHint: "<teammate> <question>" },
  { name: "routine", description: "Turn this into a routine", argumentHint: "<what to repeat>" },
  { name: "handoff", description: "Hand this to another agent", argumentHint: "<teammate> [note]" },
  { name: "clear", description: "Start a fresh page in this chat", argumentHint: "" },
];

/// The same list in the shape the `/` picker draws.
export function hzSlashCommands(): SlashCommand[] {
  return COMMANDS.map((c) => ({ ...c, aliases: [] }));
}

export type Parsed = { name: HzCommandName; args: string };

/// A line that is one of ours, or `null`. The name must be the whole first word:
/// `/remembering` is the CLI's to answer, not ours.
export function parseHz(text: string): Parsed | null {
  const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (!COMMANDS.some((c) => c.name === name)) return null;
  return { name: name as HzCommandName, args: (m[2] ?? "").trim() };
}

/// The teammate a line names first, and what follows. A leading `@` is allowed
/// because the mention picker writes one.
export function splitTeammate(
  args: string,
  agents: readonly RosterAgent[],
  selfId?: string,
): { agent: RosterAgent; rest: string } | { error: string } {
  const m = /^@?([^\s]+)\s*([\s\S]*)$/.exec(args.trim());
  if (!m) return { error: "Name a teammate first." };
  const agent = agents.find((a) => a.id !== selfId && a.name.toLowerCase() === m[1].toLowerCase());
  if (!agent) return { error: `No teammate called ${m[1]}.` };
  return { agent, rest: m[2].trim() };
}

/// The sentence the agent receives for `/ask`, which makes it use `team_ask` and
/// wait for the answer rather than guessing one.
export function askPrompt(agent: RosterAgent, question: string): string {
  return `Use your team_ask tool to ask ${agent.name}: ${question}\nWait for the answer, then tell me what ${agent.name} said.`;
}

/// The sentence the agent receives for `/handoff`.
export function handoffPrompt(agent: RosterAgent, note: string): string {
  const extra = note ? ` Include this note: ${note}` : "";
  return `Hand this over to ${agent.name}: use team_message to send them a short brief of where we are and what is left.${extra} Then tell me it is done.`;
}

/// Teammates to offer after an `@`, best first: names that start with the query
/// before names that merely contain it. `memberIds` pulls a channel's own members
/// to the top, which is the order its picker wants.
export function filterMentions(
  agents: readonly RosterAgent[],
  query: string,
  opts: { selfId?: string; memberIds?: readonly string[] } = {},
): RosterAgent[] {
  const q = query.toLowerCase();
  const rank = (a: RosterAgent) => {
    const n = a.name.toLowerCase();
    if (q === "" || n.startsWith(q)) return 0;
    return n.includes(q) ? 1 : -1;
  };
  const members = new Set(opts.memberIds ?? []);
  return agents
    .filter((a) => a.id !== opts.selfId && rank(a) >= 0)
    .sort(
      (a, b) =>
        Number(members.has(b.id)) - Number(members.has(a.id)) ||
        rank(a) - rank(b) ||
        a.name.localeCompare(b.name),
    );
}
