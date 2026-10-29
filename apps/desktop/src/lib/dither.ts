import { mixHex } from "@/lib/mascots";

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

/// A deterministic generator seeded by a string, so an agent's banner and tile
/// are the same on every draw and differ from the next agent's.
export function rng(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export type DitherOptions = {
  cols?: number;
  rows?: number;
  /// Darkest to lightest. Defaults to five steps of `color`.
  tones?: string[];
  /// How much the blobs of light add; below 1 is dimmer.
  light?: number;
};

/// The five-step ramp a banner is drawn in, darkest to lightest.
///
/// Dark is a sky that falls off to black, with the agent's face drawn white over it.
/// Light has to be the reverse: a white face on a pale sky vanishes, so the sky keeps
/// its colour all the way down and the face is drawn dark (see PixelBanner). The
/// light stops are kept shy of white for the same reason, so the agent's colour
/// still reads as the banner rather than as paper.
export function bannerTones(color: string, mode: "light" | "dark" = "dark"): string[] {
  if (mode === "light") {
    return [
      mixHex(color, "#000000", 0.45),
      mixHex(color, "#000000", 0.2),
      color,
      mixHex(color, "#ffffff", 0.3),
      mixHex(color, "#ffffff", 0.55),
    ];
  }
  return [
    mixHex(color, "#000000", 0.82),
    mixHex(color, "#000000", 0.6),
    mixHex(color, "#000000", 0.32),
    color,
    mixHex(color, "#ffffff", 0.28),
  ];
}

/// The four-step, darker ramp a tile behind a face is drawn in, so the face
/// (lighter than `color`) stays the brightest thing on it.
export function tileTones(color: string): string[] {
  return [0.62, 0.44, 0.26, 0.1].map((t) => mixHex(color, "#000000", t));
}

/// A field of soft light, ordered-dithered into a few tones of one colour: for
/// each cell, the index into `tones` it takes. Pure, so it is testable without
/// a canvas; `paintDither` is the only thing that touches one.
export function ditherGrid(seed: string, { cols = 160, rows = 40, tones = 5, light = 1 } = {}): Uint8Array {
  const r = rng(seed);
  const blobs = Array.from({ length: 4 }, () => ({
    x: r(),
    y: r() * 1.1 - 0.05,
    s: 0.18 + r() * 0.35,
    w: 0.4 + r() * 0.6,
  }));
  const out = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const u = x / cols;
      const v = y / rows;
      let l = 0.18 + 0.32 * u - 0.2 * v;
      for (const b of blobs) {
        const d = Math.hypot(((u - b.x) * cols) / rows * 0.35, v - b.y) / b.s;
        l += b.w * Math.max(0, 1 - d) * light;
      }
      l = Math.min(0.999, Math.max(0, l)) * (tones - 1);
      const base = Math.floor(l);
      const step = l - base > BAYER[y % 4][x % 4] ? 1 : 0;
      out[y * cols + x] = Math.min(tones - 1, base + step);
    }
  }
  return out;
}

/// Paints the dither into `canvas` at one canvas pixel per cell; the element is
/// scaled up by CSS with `image-rendering: pixelated`, which is why the cell
/// count is the resolution and not a quality setting.
export function paintDither(canvas: HTMLCanvasElement, color: string, seed: string, opts: DitherOptions = {}): void {
  const { cols = 160, rows = 40, light = 1 } = opts;
  const tones = opts.tones ?? bannerTones(color);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = cols;
  canvas.height = rows;
  const grid = ditherGrid(seed, { cols, rows, tones: tones.length, light });
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = tones[grid[y * cols + x]];
      ctx.fillRect(x, y, 1, 1);
    }
  }
}
