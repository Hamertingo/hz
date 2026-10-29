import { useMemo } from "react";

import Dither from "@/components/Dither";
import Mascot from "@/components/Mascot";
import { useTheme } from "@/hooks/useTheme";
import { rng } from "@/lib/dither";
import type { MascotKind } from "@/lib/mascots";

/// The band at the top of an agent's profile or a sheet: its colour as a
/// dithered sky with a few copies of its face drifting across it.
///
/// Laid out from the id, so each agent's band is its own and never changes
/// between visits.
export default function PixelBanner({
  id,
  kind,
  color,
  height = 132,
}: {
  id: string;
  kind: MascotKind;
  color: string;
  height?: number;
}) {
  // A white face vanishes on the pale light-mode sky, so the faces take the ink.
  const { resolvedMode } = useTheme();
  const face = resolvedMode === "light" ? "#1b1b1a" : "#ffffff";

  const sprites = useMemo(() => {
    const rand = rng(`${id}:faces`);
    return Array.from({ length: 5 }, () => ({
      left: 8 + rand() * 84,
      top: 8 + rand() * 60,
      size: 14 + Math.round(rand() * 14),
      opacity: 0.18 + rand() * 0.25,
    }));
  }, [id]);

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <Dither color={color} seed={id} cols={120} rows={Math.max(8, Math.round(height / 4))} light={0.8} />
      {sprites.map((s, i) => (
        <span key={i} className="absolute" style={{ left: `${s.left}%`, top: `${s.top}%`, opacity: s.opacity }}>
          <Mascot kind={kind} color={face} size={s.size} />
        </span>
      ))}
    </div>
  );
}
