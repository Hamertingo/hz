/// The pixel cat that runs the composer's top edge while a turn is in flight.
///
/// A port of MonoCode's composer runner, trimmed to what hz draws: the sprite is
/// an 8×8 character grid painted as one SVG path, and everything else is
/// arithmetic on how far along the ledge it has walked — a ping-pong patrol, a
/// jump arc that reaches a coin, and a hop off the rim when the turn ends.
///
/// Pure on purpose: no DOM, no timers, and randomness only where a caller hands
/// one in, so the walk, the arc and the collection can be tested directly.

/** Cells per side of the sprite's grid. */
export const MASCOT_GRID = 8;
/** Drawn size of the sprite, in CSS pixels. */
export const RUNNER_SIZE = 16;
/** Patrol speed, in pixels per second. */
export const RUNNER_SPEED_PX = 160;
/** Keep-out from each end of the ledge, so the sprite never clips the corner. */
export const RUNNER_INSET = 10;

/** Drawn size of a coin, in CSS pixels. */
export const COIN_SIZE = 12;
/** How high a coin hovers above the ledge — high enough that reaching it is a jump. */
export const COIN_HOVER = 42;
/** Half-width of a coin's collection band, so the grab reads as touching it. */
export const COIN_WIDTH = 8;
/** Start the jump this far before the coin and land it this far after. */
export const COIN_JUMP_LEAD = 34;
export const COIN_GAP_MIN_MS = 7000;
export const COIN_GAP_MAX_MS = 18000;
/** The first coin of a turn waits less, so the game shows up inside the wait. */
export const COIN_FIRST_MIN_MS = 3500;
export const COIN_FIRST_MAX_MS = 9000;
/** Horizontal distance at which the sprite is "on" the coin. */
export const COLLECT_X = 10;
export const COLLECT_POP_MS = 280;
export const COLLECT_POP_PX = 16;

/** The hop off the rim when the turn ends, before the layer hides. */
export const EXIT_MS = 560;
export const EXIT_PEAK = 44;
export const EXIT_SINK = 20;
const EXIT_APEX = 0.38;

export type Coin = {
  id: number;
  /** Center X in box coordinates. */
  x: number;
  /** How high the sprite must jump to reach it. */
  height: number;
};

export type RunnerPose = {
  /** Sprite center X, in box coordinates. */
  x: number;
  /** Feet height above the top border. Negative sinks behind the box. */
  y: number;
  facing: 1 | -1;
};

/** The two-frame cat: ears up, legs together, then legs out mid-stride. */
export const CAT_REST = [
  ".#....#.",
  ".##..##.",
  "########",
  "#.####.#",
  "########",
  "###..###",
  ".######.",
  "..#..#..",
] as const;

export const CAT_TALK = [
  ".#....#.",
  ".##..##.",
  "########",
  "#.####.#",
  "########",
  "########",
  ".######.",
  ".#....#.",
] as const;

export const COIN_FACE_PATH = mascotPath([
  "........",
  "..####..",
  ".######.",
  "########",
  "########",
  ".######.",
  "..####..",
  "........",
]);

export const COIN_EDGE_PATH = mascotPath([
  "........",
  "...##...",
  "...##...",
  "...##...",
  "...##...",
  "...##...",
  "...##...",
  "........",
]);

/** Merge each row's filled runs into one rect each, so a sprite is a short path. */
export function mascotPath(rows: readonly string[]): string {
  let path = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "#") {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run] === "#") run += 1;
      path += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return path;
}

export const CAT_REST_PATH = mascotPath(CAT_REST);
export const CAT_TALK_PATH = mascotPath(CAT_TALK);

/** Fold a walked distance onto a track, turning around at either end. */
export function pingPong(
  distance: number,
  length: number,
): { t: number; facing: 1 | -1 } {
  if (length <= 0) return { t: 0, facing: 1 };
  const cycle = length * 2;
  const d = ((distance % cycle) + cycle) % cycle;
  if (d <= length) return { t: d, facing: 1 };
  return { t: cycle - d, facing: -1 };
}

/** Mario parabola: 0 at the ends, `height` at the midpoint. */
function arc(
  x: number,
  left: number,
  right: number,
  height: number,
  lead = COIN_JUMP_LEAD,
): number {
  const start = left - lead;
  const end = right + lead;
  if (end <= start || x <= start || x >= end) return 0;
  const t = (x - start) / (end - start);
  return 4 * t * (1 - t) * height;
}

/** Feet peak, so the sprite's body meets the coin rather than its feet. */
export function coinJumpPeak(coin: Coin): number {
  return Math.max(0, coin.height - RUNNER_SIZE / 2);
}

/** Height the sprite should be off the ledge at `x`, over every live coin. */
export function jumpHeight(x: number, coins: readonly Coin[] = []): number {
  let height = 0;
  for (const coin of coins) {
    height = Math.max(
      height,
      arc(
        x,
        coin.x - COIN_WIDTH / 2,
        coin.x + COIN_WIDTH / 2,
        coinJumpPeak(coin),
      ),
    );
  }
  return height;
}

/** Walk `along` by one frame, bouncing at the ends and reporting the new facing. */
export function stepAlong(
  along: number,
  facing: 1 | -1,
  dtMs: number,
  trackWidth: number,
  speed = RUNNER_SPEED_PX,
): { along: number; facing: 1 | -1 } {
  if (trackWidth <= 0) return { along: 0, facing: 1 };
  let next = along + facing * speed * (dtMs / 1000);
  let dir: 1 | -1 = facing;
  if (next >= trackWidth) {
    next = trackWidth;
    dir = -1;
  } else if (next <= 0) {
    next = 0;
    dir = 1;
  }
  return { along: next, facing: dir };
}

/** Where the sprite sits for a walked distance, including any jump it is in. */
export function poseAt(
  along: number,
  facing: 1 | -1,
  boxWidth: number,
  coins: readonly Coin[] = [],
  inset = RUNNER_INSET,
): RunnerPose {
  const trackWidth = Math.max(0, boxWidth - inset * 2);
  const x = inset + Math.min(trackWidth, Math.max(0, along));
  const y = jumpHeight(x, coins);
  return { x, y, facing };
}

/** Keep a position in the same relative spot when the composer's width changes. */
export function scaleTrackX(x: number, fromWidth: number, toWidth: number): number {
  if (fromWidth <= 0) return 0;
  return x * (toWidth / fromWidth);
}

export function coinCollected(pose: RunnerPose, coin: Coin): boolean {
  if (Math.abs(pose.x - coin.x) > COLLECT_X) return false;
  const spriteTop = pose.y + RUNNER_SIZE;
  const spriteBottom = pose.y;
  const coinTop = coin.height + COIN_SIZE / 2;
  const coinBottom = coin.height - COIN_SIZE / 2;
  return spriteTop >= coinBottom && spriteBottom <= coinTop;
}

export function nextCoinDelay(first: boolean, random = Math.random): number {
  const min = first ? COIN_FIRST_MIN_MS : COIN_GAP_MIN_MS;
  const max = first ? COIN_FIRST_MAX_MS : COIN_GAP_MAX_MS;
  return min + random() * (max - min);
}

/** Place a coin clear of the sprite, retrying a few times before giving up. */
export function pickCoinX(
  boxWidth: number,
  runnerX: number,
  random = Math.random,
): number | null {
  const min = RUNNER_INSET + COIN_JUMP_LEAD + 8;
  const max = boxWidth - RUNNER_INSET - COIN_JUMP_LEAD - 8;
  if (max <= min) return null;

  for (let i = 0; i < 8; i++) {
    const x = min + random() * (max - min);
    if (Math.abs(x - runnerX) < 40) continue;
    return x;
  }
  return min + random() * (max - min);
}

/// Vertical hop that peaks, then drops below the rim so the sprite can clip away
/// behind the composer.
export function exitJumpY(t: number, peak = EXIT_PEAK, sink = EXIT_SINK): number {
  if (t <= 0) return 0;
  if (t >= 1) return -sink;
  if (t < EXIT_APEX) {
    const u = t / EXIT_APEX;
    return peak * (1 - (1 - u) * (1 - u));
  }
  const u = (t - EXIT_APEX) / (1 - EXIT_APEX);
  return peak + (-sink - peak) * u * u;
}

/** How many pixels to clip off the sprite bottom as it sinks behind the rim. */
export function spriteClipBottom(y: number, size = RUNNER_SIZE): number {
  if (y >= 0) return 0;
  return Math.min(size, Math.ceil(-y));
}
