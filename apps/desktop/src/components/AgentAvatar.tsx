import AgentTile from "@/components/AgentTile";
import type { Pose } from "@/lib/face";
import type { RosterAgent } from "@/lib/roster";

/// An agent's face at any size the app draws one. Kept as the name the existing
/// callers import; the drawing is `AgentTile`, so there is one tile, not two.
/// Takes the whole face the agent picked (body, parts, photo), so every caller shows the same agent.
export default function AgentAvatar({
  agent,
  size = 32,
  pose,
  className,
}: {
  agent: Pick<RosterAgent, "id" | "kind" | "color"> & Partial<Pick<RosterAgent, "shape" | "look" | "photo">>;
  size?: number;
  pose?: Pose;
  className?: string;
}) {
  return (
    <AgentTile
      id={agent.id}
      kind={agent.kind}
      color={agent.color}
      shape={agent.shape}
      look={agent.look}
      photo={agent.photo}
      pose={pose}
      size={size}
      className={className}
    />
  );
}
