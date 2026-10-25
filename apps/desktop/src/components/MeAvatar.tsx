import { convertFileSrc } from "@tauri-apps/api/core";

import AgentTile from "@/components/AgentTile";
import { MASCOT_KINDS, type MascotKind } from "@/lib/mascots";
import type { Me } from "@/types/events";

/// The reader's face: their photo when they uploaded one, otherwise a head from
/// the agents' family on a tile of their colour.
export default function MeAvatar({ me, size = 32 }: { me: Me; size?: number }) {
  if (me.photo) {
    return (
      <img
        src={convertFileSrc(me.photo)}
        alt=""
        draggable={false}
        className="shrink-0 object-cover"
        style={{ width: size, height: size, borderRadius: Math.max(5, Math.round(size * 0.27)) }}
      />
    );
  }
  const kind = (MASCOT_KINDS as string[]).includes(me.avatar.kind) ? (me.avatar.kind as MascotKind) : "bear";
  return <AgentTile id={`me-${kind}-${me.avatar.color}`} kind={kind} color={me.avatar.color} size={size} />;
}
