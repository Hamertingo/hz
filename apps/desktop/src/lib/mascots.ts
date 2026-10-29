/// The pixel heads an Agent is drawn as.
///
/// Each is a 16×16 grid of which only the **left eight columns** are written;
/// the right half is the mirror. That halves what has to be drawn and makes
/// asymmetry impossible, which is the whole reason the heads read as one family.
///
/// Letters: `o` outline, `b` body, `l` light, `d` shade, `w` white, `e` eye,
/// `h` eye shine, `p` blush, `n` mouth, `a` the character's own accent, `.` empty.
/// Eyes and their shine are drawn into their own group so CSS can blink them.
export const MASCOTS = {
  sun: {
    name: "Sun",
    accent: "#e0a03a",
    rows: ["........", ".......a", "..a....a", "...a.ooo", "....olbb", "...oblbb", "...obbbb", "aa.obheb", "...obeeb", "...opbbb", "...obbnb", "....obbn", "...a.odd", "..a...oo", ".......a", "........"],
  },
  cat: {
    name: "Cat",
    accent: "#e88aa0",
    rows: ["........", "..o.....", "..oo....", "..opo...", "..opbooo", "..olbbbb", "..obbbbb", "..obhebb", "..obeebb", "..opbbba", "..obbbnb", "...obbbb", "...obddd", "....oooo", "........", "........"],
  },
  fox: {
    name: "Fox",
    accent: "#4a2410",
    rows: ["........", ".o......", ".oo.....", ".oao....", ".oaao...", ".obbbooo", ".olbbbbb", ".obhebbb", ".obeebbb", ".owbbbbb", ".owwbbbb", "..owwwwn", "...owwww", "....oooo", "........", "........"],
  },
  frog: {
    name: "Frog",
    accent: "#e36a6a",
    rows: ["........", "........", "..oooo..", ".owwheo.", ".owweeo.", ".obbbboo", "oblbbbbb", "obbbbbbb", "obpbbbbb", "obbnbbbb", "obbbnnnn", ".obbbbbb", ".odddddd", "..oooooo", "........", "........"],
  },
  owl: {
    name: "Owl",
    accent: "#e0a03a",
    rows: ["........", ".o......", ".oo.....", ".obooooo", ".obbbbbb", ".owwwwbb", ".owhewbb", ".oweewbb", ".owwwwba", ".obbbbba", ".oblllll", ".obllldl", "..obllll", "...ooooo", "........", "........"],
  },
  ghost: {
    name: "Ghost",
    accent: "#e88aa0",
    rows: ["........", ".....ooo", "...oolbb", "..olbbbb", ".olbbbbb", ".obbbbbb", ".obbhebb", ".obbeebb", ".obbeebb", ".obpbbbb", ".obbbbbn", ".obbbbbb", ".obbbbbb", ".obbobbb", "..oo.ooo", "........"],
  },
  bear: {
    name: "Bear",
    accent: "#2e1d10",
    rows: ["........", "..ooo...", ".obpbooo", ".oblbbbb", ".obbbbbb", ".obbbbbb", ".obbebbb", ".obbebbb", ".obbbwww", ".opbwwwn", ".obbwwnw", "..obbwww", "...odddd", "....oooo", "........", "........"],
  },
  bunny: {
    name: "Bunny",
    accent: "#e88aa0",
    rows: ["...oo...", "..obpo..", "..obpo..", "..obpo..", "..obbooo", ".olbbbbb", ".obbbbbb", ".obbhebb", ".obbeebb", ".opbbbba", ".obbbbnb", "..obbbbb", "...odddd", "....oooo", "........", "........"],
  },
} as const;

export type MascotKind = keyof typeof MASCOTS;

export const MASCOT_KINDS = Object.keys(MASCOTS) as MascotKind[];

/// The colours an Agent can be given. Picked to stay legible as a 16px head on
/// both a light and a dark sidebar, which is why there is no white and no black.
export const MASCOT_COLORS = [
  "#e2a440",
  "#e2814a",
  "#df6f86",
  "#9a87ea",
  "#6a8cf0",
  "#4fb0c4",
  "#55b884",
  "#9198a8",
] as const;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/// `a` moved `t` of the way to `b`, both `#rrggbb`.
export function mixHex(a: string, b: string, t: number): string {
  const from = channels(a);
  const to = channels(b);
  const mixed = from.map((v, i) => Math.round(v + (to[i] - v) * t));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const cache = new Map<string, string>();

/// The head as one SVG string, coloured from `color`.
///
/// Light, shade and outline are derived from the one colour, so an Agent's
/// colour is a single value and every head stays readable on any of them. Cached,
/// since a sidebar draws the same few heads on every render.
export function mascotSvg(kind: MascotKind, color: string): string {
  const key = `${kind}${color}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const m = MASCOTS[kind];
  const palette: Record<string, string> = {
    o: mixHex(color, "#000000", 0.55),
    b: color,
    l: mixHex(color, "#ffffff", 0.35),
    d: mixHex(color, "#000000", 0.18),
    w: "#f2f2f2",
    e: "#0e0e10",
    h: "#f2f2f2",
    p: "#e88aa0",
    n: mixHex(color, "#000000", 0.62),
    a: m.accent,
  };

  let body = "";
  let eyes = "";
  m.rows.forEach((row, y) => {
    const half = row.padEnd(8, ".").slice(0, 8);
    const full = half + [...half].reverse().join("");
    [...full].forEach((cell, x) => {
      if (cell === ".") return;
      // 1.02 rather than 1: adjacent rects at fractional scale leave a hairline
      // seam between pixels in some renderers.
      const rect = `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${palette[cell]}"/>`;
      if (cell === "e" || cell === "h") eyes += rect;
      else body += rect;
    });
  });

  const svg = `<svg viewBox="0 0 16 16" aria-hidden="true">${body}<g class="mascot-eyes">${eyes}</g></svg>`;
  cache.set(key, svg);
  return svg;
}
