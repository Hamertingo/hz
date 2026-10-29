import Face from "@/components/Face";
import type { Look, Pose, ShapeName } from "@/lib/face";
import { useRoster } from "@/lib/roster";

/// An agent's face at any size: one component for the sidebar (34), the chat (28), the profile (84),
/// so the same agent is the same face everywhere. `look`, `photo` and `pose` come from the agent; a caller
/// that only knows the id gets them from the roster, so no row draws a stale body.
export default function AgentTile({
  id,
  kind,
  color,
  size = 32,
  shape,
  look,
  photo,
  pose,
  gaze,
  className,
}: {
  id: string;
  kind?: string;
  color: string;
  size?: number;
  shape?: ShapeName | string;
  look?: Look;
  photo?: string | null;
  pose?: Pose;
  gaze?: boolean;
  className?: string;
}) {
  const own = useRoster().agents.find((a) => a.id === id);
  return (
    <Face
      id={id}
      kind={kind}
      color={color}
      size={size}
      shape={shape ?? own?.shape}
      look={look ?? own?.look}
      photo={photo === undefined ? own?.photo : photo}
      pose={pose}
      gaze={gaze}
      className={className}
    />
  );
}
