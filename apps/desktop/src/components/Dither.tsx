import { useEffect, useRef } from "react";

import { useTheme } from "@/hooks/useTheme";
import { bannerTones, paintDither, type DitherOptions } from "@/lib/dither";
import { cn } from "@/lib/utils";

/// A dithered field of one colour on a canvas that fills its parent. The cell
/// count is the resolution, so the pixels stay pixels at any size.
export default function Dither({
  color,
  seed,
  className,
  ...opts
}: { color: string; seed: string; className?: string } & DitherOptions) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { cols, rows, light } = opts;
  // The ramp follows the mode, so a banner repaints when the theme flips under it.
  const { resolvedMode } = useTheme();
  const toneList = opts.tones ?? bannerTones(color, resolvedMode);

  // Keyed by the joined string so an inline array does not repaint on every render.
  const tones = toneList.join();

  useEffect(() => {
    if (ref.current) paintDither(ref.current, color, seed, { cols, rows, light, tones: tones.split(",") });
  }, [color, seed, cols, rows, light, tones]);

  return <canvas ref={ref} aria-hidden className={cn("absolute inset-0 size-full [image-rendering:pixelated]", className)} />;
}
