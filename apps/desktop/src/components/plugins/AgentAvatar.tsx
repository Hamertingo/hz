import { isPicture, portraitVariant } from "@/lib/agents";
import { cn } from "@/lib/utils";
import type { PluginAgent } from "@/types/events";

/// One hue per built-in portrait, in the order the store's marker numbers them.
///
/// **A hue and an initial, rather than a picture.** The store's marker names a
/// *number*, not an image — the artwork lives in the agent's own UI — so drawing
/// two agents with different markers as the same disc would be saying they look
/// alike. These are spaced around the wheel so neighbouring variants differ at a
/// glance, which is the whole of what a portrait is for in a list.
const HUES = [42, 12, 168, 205, 268, 320, 96, 240, 0, 150];

/// The agent's face: a stored picture, one of the built-in portraits, or an
/// initial where neither says anything.
export default function AgentAvatar({
  agent,
  size = 36,
  className,
}: {
  agent: Pick<PluginAgent, "displayName" | "name" | "avatar">;
  size?: number;
  className?: string;
}) {
  // A picture the store holds — an uploaded image as a data URL. Drawn as it is:
  // a reader who set an image should see the image, not a hue standing in for it.
  if (isPicture(agent.avatar)) {
    return (
      <img
        src={agent.avatar ?? ""}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-lg object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  const variant = portraitVariant(agent.avatar);
  const hue = HUES[(variant ?? hash(agent.name)) % HUES.length];

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg font-medium select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `hsl(${hue} 58% 48% / 0.16)`,
        color: `hsl(${hue} 62% 62%)`,
      }}
    >
      {initial(agent.displayName || agent.name)}
    </span>
  );
}

/// The first letter a reader would say, or a question mark for a name with none.
function initial(name: string): string {
  const letter = [...name.trim()][0];
  return letter ? letter.toLocaleUpperCase() : "?";
}

/// A stable small number for a name, so an agent with no portrait still keeps the
/// same colour between visits rather than taking whichever one the list happened
/// to assign.
function hash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
