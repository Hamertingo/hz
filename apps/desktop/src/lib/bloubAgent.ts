import { createRng } from "@/lib/bloub/math";
import { COLORS, SHAPES } from "@/lib/bloub/skins";
import { EXPRESSIONS } from "@/lib/bloub/expressions";
import type { StateId } from "@/lib/bloub/states";

/// The three things a reader can choose about an Agent's bot.
///
/// **Not the marker.** The portrait marker is the *agent's* own store and holds a
/// single digit — enough for the ten the vendor's own picker offers, and not
/// enough for a shape, a colour and a face at once. These are the reader's, kept
/// here, and they are read before the marker: see [`bloubSkinFor`].
export interface AgentSkin {
  shape: string;
  color: string;
  expression: string;
}

/// How an Agent is drawn, and how it is drawn *while working*.
///
/// **Derived rather than stored, unless the reader chose.** An Agent's name is the
/// one thing about it nothing else changes, so a bot costs no field on the index
/// and no write: two machines running this build draw the same bot for the same
/// Agent, and a rename is the only thing that changes it. That is also why this is
/// pure — it can be pinned by a test instead of being eyeballed.
export interface BloubSkin {
  shape: string;
  color: string;
  expression: string;
  /// Where a still is frozen, in seconds into the rest state.
  ///
  /// **Not zero, and not the same for every Agent.** Frame zero is the same pose
  /// for everyone — a list of Agents would be a row of identical bots — and a
  /// still frozen mid-drift is a face that reads as *looking* at something. The
  /// range stays inside the state's first breath of life so nothing is caught
  /// mid-blink.
  frozenAt: number;
}

/// A stable 32-bit seed for a name. Not a signature: two names may collide and
/// that costs nothing here.
function seedOf(name: string): number {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/// The skin an Agent wears.
///
/// **Three answers, in order of who chose.** `override` is the reader's own pick
/// and wins outright; then `variant`, the stored portrait marker, which decides
/// the shape and the colour because that is all one digit can carry; then the
/// name, which decides everything. Expression and the frozen pose always come from
/// the name, so two Agents sharing a pick are still two bots rather than one drawn
/// twice.
export function bloubSkinFor(
  name: string,
  variant: number | null = null,
  override: AgentSkin | null = null,
): BloubSkin {
  const rng = createRng(seedOf(name));

  const shape =
    variant === null
      ? SHAPES[Math.floor(rng() * SHAPES.length)]
      : SHAPES[((variant % SHAPES.length) + SHAPES.length) % SHAPES.length];
  const color =
    variant === null
      ? COLORS[Math.floor(rng() * COLORS.length)]
      : COLORS[((variant % COLORS.length) + COLORS.length) % COLORS.length];
  const expression = EXPRESSIONS[Math.floor(rng() * EXPRESSIONS.length)];

  return {
    // A list this build cannot read is not a crash and not a blank: the first row
    // of the table is the shape every bot falls back to on the upstream side too.
    shape: override?.shape ?? shape?.id ?? "cercle",
    color: override?.color ?? color?.id ?? "encre",
    expression: override?.expression ?? expression?.id ?? "neutre",
    frozenAt: 0.35 + rng() * 1.1,
  };
}

/// What an Agent is doing, in the vocabulary the UI has for it.
///
/// Five words rather than fourteen states: the state board is upstream's own
/// language for a montage, and what this app has to say about an Agent is whether
/// it is still, working, waiting on the reader, or finished.
export type BloubMood = "idle" | "working" | "asking" | "done" | "failed";

/// The state that says it.
///
/// `orbit` is the one that reads as *working* from across the room — the eyes
/// travel around the sphere and the rings turn, where `thinking` is a small
/// motion a reader has to look for. `alert` is the state whose whole pose is a
/// startle, which is what a permission request is; `notify` pops the blue dot the
/// sidebar already uses for finished work; `exclaim` is a turn that failed.
export function bloubStateFor(mood: BloubMood): StateId {
  switch (mood) {
    case "working":
      return "orbit";
    case "asking":
      return "alert";
    case "done":
      return "notify";
    case "failed":
      return "exclaim";
    case "idle":
      return "idle";
  }
}
