import { memo, useEffect, useId, useMemo, useRef, useState } from "react";

import { NOTIF_BLUE, type DotRender } from "@/lib/bloub/decor";
import { BotEngine, type BotFrame } from "@/lib/bloub/engine";
import { EXPRESSION_BY_ID } from "@/lib/bloub/expressions";
import { DEMI_VIEWBOX, RAYON } from "@/lib/bloub/repere";
import { COLOR_BY_ID, SHAPE_BY_ID, mixHex } from "@/lib/bloub/skins";
import { bloubSkinFor, bloubStateFor, type AgentSkin, type BloubMood } from "@/lib/bloubAgent";
import { cn } from "@/lib/utils";
import type { StateId } from "@/lib/bloub/states";

const R = RAYON;
const VB = DEMI_VIEWBOX;

/// The colour the eyes read as, since they are holes rather than shapes.
///
/// **It has to be an opaque colour close to the surface behind the avatar.** The
/// engine draws the eyes by masking the body, so what shows through is this fill —
/// and it is also painted as an under-copy so the orbit rings cannot reappear
/// inside the eyes. A theme's `--card` is a *veil* (translucent) where glass is on,
/// which would let the window through the ball itself, so the default is the one
/// surface token that is always a solid colour.
const DEFAULT_PAPER = "var(--background, #101014)";

/// One Agent's face.
///
/// **`bloub`, vendored — see `lib/bloub/README.md`.** An SVG bot whose body is a
/// radial profile that morphs between states, with the eyes cut out of it as real
/// holes, so they clip against the silhouette by themselves as they slide to the
/// edge.
///
/// **A still unless asked to move.** The engine renders one exact frame for a
/// date, so a list of Agents is a set of poses drawn once with no loop and no
/// clock; `live` starts the loop, and only the two or three places the reader is
/// actually looking at one should ask for it. Both are the upstream component's
/// own split between its vignettes and its animated bot, for the same reason.
///
/// Memoised on its props, because a live bot re-renders itself sixty times a
/// second and none of that should reach a parent.
function BloubAvatar({
  name,
  variant = null,
  override = null,
  size = 28,
  mood = "idle",
  state,
  live = false,
  paper = DEFAULT_PAPER,
  label,
  className,
}: {
  /// The Agent's name — what the bot is derived from. Two Agents with the same
  /// name wear the same bot, which is the point: it needs no stored field.
  name: string;
  /// The stored portrait marker, where this Agent has one. The agent's own store,
  /// and it decides the shape and the colour when nobody here has.
  variant?: number | null;
  /// The reader's own pick, which wins over both the marker and the name.
  override?: AgentSkin | null;
  size?: number;
  /// What the Agent is doing. Ignored where `state` is given.
  mood?: BloubMood;
  /// One of the engine's own fourteen states, for a caller that wants a
  /// particular one.
  state?: StateId;
  /// Run the clock. Off is a still; on is the animation.
  live?: boolean;
  /// The surface behind the avatar. See [`DEFAULT_PAPER`].
  paper?: string;
  /// What a screen reader says. Falls back to the name.
  label?: string;
  className?: string;
}) {
  const skin = useMemo(() => bloubSkinFor(name, variant, override), [name, variant, override]);
  const wanted = state ?? bloubStateFor(mood);

  // One engine for the life of this element. It is stateful — it morphs between
  // states rather than cutting — so rebuilding it on every render would throw
  // away every transition.
  const engineRef = useRef<BotEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new BotEngine(
      R,
      wanted,
      SHAPE_BY_ID.get(skin.shape)?.radii ?? null,
      EXPRESSION_BY_ID.get(skin.expression) ?? null,
    );
  }
  const engine = engineRef.current;

  const clock = useRef(0);
  const [frame, setFrame] = useState<BotFrame>(() => engine.sample(skin.frozenAt));

  // A different skin morphs into place rather than jumping, which is the engine's
  // own rule for it — every shape is sampled at the same angles, so the radii
  // simply interpolate.
  useEffect(() => {
    engine.setShape(SHAPE_BY_ID.get(skin.shape)?.radii ?? null, clock.current);
    engine.setExpression(EXPRESSION_BY_ID.get(skin.expression) ?? null, clock.current);
    setFrame(engine.sample(clock.current));
  }, [engine, skin]);

  useEffect(() => {
    // **A still is a date, not a stopped loop.** `sample` is a pure function of
    // time, so freezing at the same date gives the same image on every mount —
    // which is why a row in a list can be re-rendered as often as React likes.
    if (!live) {
      clock.current = skin.frozenAt;
      engine.setState(wanted, clock.current);
      setFrame(engine.sample(clock.current));
      return;
    }

    engine.setState(wanted, clock.current);
    setFrame(engine.sample(clock.current));

    let raf = 0;
    let last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      // A tab hidden and shown again resumes without jumping forward: rAF is
      // suspended while it is away, so the delta it reports spans the gap.
      const dt = last ? Math.min((ms - last) / 1000, 0.064) : 0;
      last = ms;
      clock.current += dt;
      setFrame(engine.sample(clock.current));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, live, wanted, skin]);

  // Sanitised because an SVG reference is a CSS `url(#…)`, where React's own
  // colons are not valid.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const maskId = `bloub-mask-${uid}`;
  const ink = COLOR_BY_ID.get(skin.color)?.hex ?? "#0a0a0c";

  /// One particle, dot or squashed mark. A state may give it a path — the "!"
  /// leans, so its dot is a droplet rather than a disc.
  const dotOf = (dot: DotRender, key: string) => {
    const fill =
      dot.color ??
      (dot.depth === undefined || !isHex(paper) ? ink : mixHex(paper, ink, dot.depth));
    return dot.d ? (
      <path
        key={key}
        d={dot.d}
        fill={fill}
        opacity={dot.opacity}
        transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${R})`}
      />
    ) : (
      <circle key={key} cx={dot.x} cy={dot.y} r={dot.r} fill={fill} opacity={dot.opacity} />
    );
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      role="img"
      aria-label={label ?? name}
      className={cn("shrink-0", className)}
    >
      <defs>
        {/* The eyes are real holes punched through the body, not pale shapes laid
            on top of it — which is what makes them clip against the silhouette by
            themselves as they slide towards its edge. */}
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={-VB}
          y={-VB}
          width={VB * 2}
          height={VB * 2}
        >
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, index) => (
            <path
              key={index}
              d={eye.d}
              transform={eye.matrix}
              opacity={eye.alpha}
              fill="#000"
            />
          ))}
          {frame.notch && (
            <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />
          )}
        </mask>

        {frame.arcs.map((arc) => (
          <linearGradient
            key={arc.id}
            id={`${uid}-${arc.id}`}
            gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1}
            y1={arc.grad.y1}
            x2={arc.grad.x2}
            y2={arc.grad.y2}
          >
            {arc.grad.stops.map((stop, index) => (
              <stop
                key={index}
                offset={index / Math.max(1, arc.grad.stops.length - 1)}
                stopColor={stop}
              />
            ))}
          </linearGradient>
        ))}
      </defs>

      {/* The half of each orbit that passes behind the ball, drawn first so the
          body occludes it. */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={`b${arc.id}`}
            d={arc.back}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>

      {frame.dotsBehind && <g>{frame.dots.map((dot, index) => dotOf(dot, `pb${index}`))}</g>}

      <g opacity={frame.bodyAlpha}>
        {/* An opaque copy of the body, *under* it. The eyes are holes, and a hole
            shows whatever is behind — which is exactly where the back half of the
            rings and the burst particles are. Without this a ring passing behind
            the ball reappears inside its eyes. */}
        <path d={frame.bodyPath} fill={paper} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>

      {!frame.dotsBehind && <g>{frame.dots.map((dot, index) => dotOf(dot, `pf${index}`))}</g>}

      {frame.notif && (
        <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} />
      )}

      {/* The front half of each orbit. */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={`f${arc.id}`}
            d={arc.front}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>
    </svg>
  );
}

/// Whether a colour is a literal one, since the particle depth mix needs three
/// channels and a `var(--card)` has none.
function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export default memo(BloubAvatar);
