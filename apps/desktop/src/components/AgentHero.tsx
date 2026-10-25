import Mascot from "@/components/Mascot";
import type { RosterAgent } from "@/lib/roster";

/// What the agent says about itself, from what it was given: its description if
/// it has one, else the opening of its instructions. Never both, and never made
/// up — an agent with neither is introduced by its name alone.
function intro(agent: RosterAgent): string | null {
  if (agent.role) return agent.role;

  const first = agent.instructions
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return null;
  return first.length > 160 ? `${first.slice(0, 160)}…` : first;
}

/// The top of an agent's empty chat: its face, its name and a line on what it is
/// for. It stands where the app's wordmark stands in a new task, since an agent's
/// chat is not "a new task" — it is a conversation with someone, and that someone
/// is what the page is about.
export default function AgentHero({ agent }: { agent: RosterAgent }) {
  const line = intro(agent);

  return (
    <div className="mb-8 flex w-full flex-col items-center gap-3 text-center">
      <Mascot kind={agent.kind} color={agent.color} size={72} />
      <span className="rounded-full border border-border px-4 py-1.5 text-base font-medium text-foreground">
        {agent.name}
      </span>
      {line && <p className="max-w-md text-chat text-muted-foreground">{line}</p>}
    </div>
  );
}
