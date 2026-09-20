import BloubAvatar from "@/components/BloubAvatar";
import { isPicture, portraitVariant } from "@/lib/agents";
import { useAgentSkin } from "@/lib/agentSkin";
import { cn } from "@/lib/utils";
import type { BloubMood } from "@/lib/bloubAgent";
import type { StateId } from "@/lib/bloub/states";
import type { PluginAgent } from "@/types/events";

/// One Agent's face.
///
/// **A `bloub`, derived from the Agent's name.** See `lib/bloub/README.md`: an SVG
/// bot whose body is a radial profile morphing between states, with the eyes cut
/// out of it as real holes. An Agent that has never been given a portrait gets one
/// of these for free, and it is the same bot everywhere because the name is the
/// only input.
///
/// **A stored picture wins outright.** An uploaded image is a choice the reader
/// made; a bot from the name is what stands in when they have made none.
///
/// The stored portrait marker picks the bot's shape and colour — the same marker
/// the Portrait row writes — so that row is a real choice of who this is rather
/// than a tint on a disc.
export default function AgentAvatar({
  agent,
  size = 36,
  live = false,
  mood = "idle",
  state,
  paper,
  className,
}: {
  agent: Pick<PluginAgent, "displayName" | "name" | "avatar">;
  size?: number;
  /// Run the animation. Off by default: a list of Agents is a set of stills, and
  /// only a place the reader is looking at one bot should ask for the clock.
  live?: boolean;
  mood?: BloubMood;
  state?: StateId;
  /// The surface behind the bot. The eyes are holes, so this is the colour they
  /// read as — pass the surface the avatar is actually drawn on.
  paper?: string;
  className?: string;
}) {
  const override = useAgentSkin(agent.name);

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

  return (
    <BloubAvatar
      name={agent.name}
      variant={portraitVariant(agent.avatar)}
      override={override}
      size={size}
      live={live}
      mood={mood}
      state={state}
      paper={paper}
      label={agent.displayName || agent.name}
      className={className}
    />
  );
}
