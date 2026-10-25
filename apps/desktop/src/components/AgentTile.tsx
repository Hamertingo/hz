import Dither from "@/components/Dither";
import Mascot, { blinkDelay } from "@/components/Mascot";
import { tileTones } from "@/lib/dither";
import { mixHex, type MascotKind } from "@/lib/mascots";
import { cn } from "@/lib/utils";

/// An agent's face on its tile: the head, lightened, on a small dither of the
/// agent's own colour. One component for every size a face is drawn at, so the
/// corner and the inset scale together (20 in the sidebar, 32 in the chat, 96 on
/// the profile) and the same agent is the same tile everywhere.
export default function AgentTile({
  id,
  kind,
  color,
  size = 32,
  className,
}: {
  id: string;
  kind: MascotKind;
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(5, Math.round(size * 0.27)),
        boxShadow: `inset 0 0 0 1px ${color}47`,
      }}
    >
      <Dither color={color} seed={`${id}:tile`} cols={12} rows={12} light={0.9} tones={tileTones(color)} />
      <Mascot
        kind={kind}
        color={mixHex(color, "#ffffff", 0.42)}
        size={Math.round(size * 0.78)}
        delay={blinkDelay(id)}
        className="relative"
      />
    </span>
  );
}
