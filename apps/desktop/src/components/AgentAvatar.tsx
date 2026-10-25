import AgentTile from "@/components/AgentTile";
import type { RosterAgent } from "@/lib/roster";

/// An agent's face at any size the app draws one. Kept as the name the existing
/// callers import; the drawing is `AgentTile`, so there is one tile, not two.
export default function AgentAvatar({
  agent,
  size = 32,
  className,
}: {
  agent: Pick<RosterAgent, "id" | "kind" | "color">;
  size?: number;
  className?: string;
}) {
  return <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={size} className={className} />;
}
