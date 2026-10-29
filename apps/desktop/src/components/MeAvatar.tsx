import { convertFileSrc } from "@tauri-apps/api/core";

import type { Me } from "@/types/events";

/// The reader's face: their photo when they uploaded one, otherwise their initials on a quiet circle.
/// `dot` is a status colour drawn on the corner; `ring` is what the corner's ring is cut from, the
/// surface the avatar sits on.
export default function MeAvatar({ me, size = 32, dot, ring = "var(--side)" }: { me: Me; size?: number; dot?: string; ring?: string }) {
  const initials = me.name.trim().slice(0, 2).toUpperCase() || "ME";
  return (
    <span
      aria-hidden
      className="relative grid shrink-0 place-items-center rounded-full bg-s3 bg-cover bg-center font-semibold text-ink"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), backgroundImage: me.photo ? `url(${convertFileSrc(me.photo)})` : undefined }}
    >
      {me.photo ? null : initials}
      {dot ? <i className="absolute -right-px -bottom-px size-[9px] rounded-full" style={{ background: dot, boxShadow: `0 0 0 2px ${ring}` }} /> : null}
    </span>
  );
}
