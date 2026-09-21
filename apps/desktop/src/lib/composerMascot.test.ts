import { describe, expect, it } from "vitest";

import {
  CAT_REST_PATH,
  CAT_TALK_PATH,
  COIN_HOVER,
  COLLECT_X,
  MASCOT_GRID,
  RUNNER_INSET,
  RUNNER_SIZE,
  coinCollected,
  exitJumpY,
  jumpHeight,
  mascotPath,
  nextCoinDelay,
  pickCoinX,
  pingPong,
  poseAt,
  scaleTrackX,
  spriteClipBottom,
  stepAlong,
} from "./composerMascot";

describe("mascotPath", () => {
  it("merges each row's runs into one rect apiece", () => {
    expect(mascotPath(["##..##"])).toBe("M0 0h2v1h-2zM4 0h2v1h-2z");
    expect(mascotPath(["........"])).toBe("");
    expect(mascotPath(["########"])).toBe("M0 0h8v1h-8z");
  });

  it("gives the cat two distinct frames", () => {
    expect(CAT_REST_PATH).not.toBe(CAT_TALK_PATH);
    expect(CAT_REST_PATH.length).toBeGreaterThan(0);
  });
});

describe("pingPong", () => {
  it("walks out and back, flipping facing past the end", () => {
    expect(pingPong(5, 10)).toEqual({ t: 5, facing: 1 });
    expect(pingPong(15, 10)).toEqual({ t: 5, facing: -1 });
    expect(pingPong(25, 10)).toEqual({ t: 5, facing: 1 });
  });

  it("stays put on a track with no length", () => {
    expect(pingPong(9, 0)).toEqual({ t: 0, facing: 1 });
  });
});

describe("stepAlong", () => {
  it("bounces off the ends and reports the new facing", () => {
    expect(stepAlong(5, 1, 100, 40, 160).along).toBeCloseTo(21);
    const atEnd = stepAlong(19, 1, 100, 20, 160);
    expect(atEnd.along).toBe(20);
    expect(atEnd.facing).toBe(-1);
    const atStart = stepAlong(1, -1, 100, 20, 160);
    expect(atStart.along).toBe(0);
    expect(atStart.facing).toBe(1);
  });

  it("does nothing on a track with no length", () => {
    expect(stepAlong(5, 1, 100, 0)).toEqual({ along: 0, facing: 1 });
  });
});

describe("poseAt", () => {
  it("keeps the sprite inside the ledge's insets", () => {
    const left = poseAt(-50, 1, 200);
    expect(left.x).toBe(RUNNER_INSET);
    const right = poseAt(999, 1, 200);
    expect(right.x).toBe(200 - RUNNER_INSET);
  });
});

describe("jumpHeight", () => {
  it("is zero away from every coin and peaks at one's center", () => {
    const coin = { id: 1, x: 100, height: COIN_HOVER };
    expect(jumpHeight(0, [coin])).toBe(0);
    expect(jumpHeight(100, [coin])).toBeCloseTo(COIN_HOVER - RUNNER_SIZE / 2);
  });

  it("is zero when there is nothing to jump for", () => {
    expect(jumpHeight(100, [])).toBe(0);
  });
});

describe("coinCollected", () => {
  const coin = { id: 1, x: 100, height: COIN_HOVER };

  it("grabs a coin the sprite is under", () => {
    expect(coinCollected({ x: 100, y: COIN_HOVER, facing: 1 }, coin)).toBe(true);
  });

  it("leaves a coin the sprite walked past or is beneath", () => {
    expect(
      coinCollected({ x: 100 + COLLECT_X + 1, y: COIN_HOVER, facing: 1 }, coin),
    ).toBe(false);
    expect(coinCollected({ x: 100, y: 0, facing: 1 }, coin)).toBe(false);
  });
});

describe("nextCoinDelay", () => {
  it("lands inside its window for the first coin and the rest", () => {
    expect(nextCoinDelay(true, () => 0)).toBe(3500);
    expect(nextCoinDelay(true, () => 1)).toBe(9000);
    expect(nextCoinDelay(false, () => 0)).toBe(7000);
    expect(nextCoinDelay(false, () => 1)).toBe(18000);
  });
});

describe("pickCoinX", () => {
  it("refuses a ledge with no room for a coin", () => {
    expect(pickCoinX(60, 30, () => 0)).toBeNull();
  });

  it("places a coin clear of the sprite", () => {
    const x = pickCoinX(400, 52, () => 0.5);
    expect(x).not.toBeNull();
    expect(Math.abs((x as number) - 52)).toBeGreaterThanOrEqual(40);
  });
});

describe("exitJumpY", () => {
  it("starts on the rim, peaks, then sinks below it", () => {
    expect(exitJumpY(0)).toBe(0);
    expect(exitJumpY(0.38)).toBeCloseTo(44);
    expect(exitJumpY(1)).toBe(-20);
  });
});

describe("spriteClipBottom", () => {
  it("only clips once the sprite is under the rim", () => {
    expect(spriteClipBottom(4)).toBe(0);
    expect(spriteClipBottom(-3)).toBe(3);
    expect(spriteClipBottom(-999)).toBe(RUNNER_SIZE);
  });
});

describe("scaleTrackX", () => {
  it("keeps a position's relative spot across a resize", () => {
    expect(scaleTrackX(50, 200, 400)).toBe(100);
    expect(scaleTrackX(50, 0, 400)).toBe(0);
  });
});

describe("the sprite", () => {
  it("is an 8×8 grid", () => {
    expect(MASCOT_GRID).toBe(8);
  });
});
