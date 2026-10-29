import { useEffect, useMemo, useRef, useState } from "react";

import { type Look, type Pose, type ShapeName, lookFor, mascot, shapeOfKind } from "@/lib/face";
import { cn } from "@/lib/utils";

/// An agent's face: a body with eyes, a mouth, an extra and a pattern, or a photo the reader chose.
/// The pose decides the motion (blinking, glancing, a monitor, a laptop, a thought bubble, sleeping).
export default function Face({
  id,
  color,
  kind,
  shape,
  look,
  photo,
  pose = "idle",
  size = 32,
  gaze = false,
  className,
}: {
  id: string;
  color: string;
  /// The older pixel-head kind; becomes a body when there is no `shape`.
  kind?: string;
  shape?: ShapeName | string;
  look?: Look;
  photo?: string | null;
  pose?: Pose;
  size?: number;
  /// Wakes up, jumps and follows the pointer while it is over the face, or over the nearest `[data-gaze]` ancestor.
  gaze?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);

  // Eased by hand, not by CSS transitions: the target moves with every pointer event, and a spring that chases it
  // looks alive where a fixed transition lags and snaps. The offsets are applied with the individual `translate`,
  // `rotate` and `scale` properties so they stack on the blink and glance animations instead of replacing them.
  useEffect(() => {
    const el = ref.current;
    if (!gaze || !el) return;
    const region = el.closest<HTMLElement>("[data-gaze]") ?? el;
    const t = { x: 0, y: 0, w: 0 };
    const c = { x: 0, y: 0, w: 0 };
    let frame = 0;
    let inside = false;
    let relax = 0;

    const apply = () => {
      const svg = el.querySelector("svg");
      if (!svg) return;
      svg.style.translate = `${(c.x * size * 0.05).toFixed(2)}px ${(c.y * size * 0.025).toFixed(2)}px`;
      svg.style.rotate = `${(c.x * 5).toFixed(2)}deg`;
      const eyes = svg.querySelector<SVGElement>(".ey");
      if (eyes) {
        eyes.style.translate = `${(c.x * 2.2).toFixed(2)}px ${(c.y * 1.6).toFixed(2)}px`;
        eyes.style.scale = (1 + c.w * 0.14).toFixed(3);
      }
      for (const pupil of svg.querySelectorAll<SVGElement>(".pu")) {
        pupil.style.translate = `${(c.x * 3.6).toFixed(2)}px ${(c.y * 3).toFixed(2)}px`;
        pupil.style.scale = (1 - c.w * 0.12).toFixed(3);
      }
    };
    const clear = () => {
      const svg = el.querySelector("svg");
      if (!svg) return;
      for (const node of [svg, ...svg.querySelectorAll<SVGElement>(".ey, .pu")]) {
        node.style.translate = "";
        node.style.rotate = "";
        node.style.scale = "";
      }
    };
    const tick = () => {
      c.x += (t.x - c.x) * 0.16;
      c.y += (t.y - c.y) * 0.16;
      c.w += (t.w - c.w) * 0.12;
      apply();
      const settled = Math.abs(t.x - c.x) + Math.abs(t.y - c.y) + Math.abs(t.w - c.w) < 0.004;
      if (!inside && settled) {
        frame = 0;
        clear();
        setNear(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const run = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const enter = () => {
      inside = true;
      setNear(true);
      // Eyes open wide for a beat, then relax to a steady, attentive size.
      t.w = 1;
      window.clearTimeout(relax);
      relax = window.setTimeout(() => {
        if (inside) t.w = 0.45;
      }, 260);
      run();
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const pull = Math.min(d / 55, 1);
      t.x = (dx / d) * pull;
      t.y = (dy / d) * pull;
      run();
    };
    const leave = () => {
      inside = false;
      window.clearTimeout(relax);
      t.x = 0;
      t.y = 0;
      t.w = 0;
      run();
    };
    region.addEventListener("pointerenter", enter);
    region.addEventListener("pointermove", move);
    region.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(relax);
      region.removeEventListener("pointerenter", enter);
      region.removeEventListener("pointermove", move);
      region.removeEventListener("pointerleave", leave);
      clear();
    };
  }, [gaze, size]);

  const shown: Pose = near && pose === "sleep" ? "idle" : pose;
  // Keyed on the look's contents, not its identity: every roster update hands over a fresh object, and a new
  // string here rewrites the SVG, which restarts every animation in it. While an agent works the roster changes
  // often, and the face used to flicker with each change.
  const lookKey = JSON.stringify(look ?? null);
  const svg = useMemo(
    () =>
      mascot((shape as string) || shapeOfKind(kind ?? ""), color, size, {
        look: { ...lookFor(id), ...(look ?? {}) },
        photo: photo ?? undefined,
        state: shown,
      }),
    [id, color, kind, shape, lookKey, photo, shown, size],
  );
  return (
    <span
      ref={ref}
      aria-hidden
      className={cn("face inline-flex shrink-0", near && "gaze-on", className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
