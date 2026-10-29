import { useMemo } from "react";

import { mascotSvg, type MascotKind } from "@/lib/mascots";
import { cn } from "@/lib/utils";

/// An Agent's pixel head.
///
/// `delay` staggers the blink: a column of heads that all closed their eyes on the
/// same frame would read as a glitch, so the caller seeds it from something
/// stable per agent. The SVG is built from our own constant grids and a colour
/// from a fixed palette, never from anything typed, so setting it as markup is not
/// an injection path.
export default function Mascot({
  kind,
  color,
  size = 16,
  delay = 0,
  className,
}: {
  kind: MascotKind;
  color: string;
  size?: number;
  delay?: number;
  className?: string;
}) {
  const svg = useMemo(() => mascotSvg(kind, color), [kind, color]);

  return (
    <span
      aria-hidden
      className={cn("mascot inline-block shrink-0", className)}
      style={{ width: size, height: size, ["--blink-delay" as string]: `${delay}s` }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/// A stable 0–5s stagger for one agent's blink.
export function blinkDelay(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997;
  return (h % 50) / 10;
}
