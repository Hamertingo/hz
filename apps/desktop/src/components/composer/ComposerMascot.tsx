import { useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

import {
  CAT_REST_PATH,
  CAT_TALK_PATH,
  COIN_EDGE_PATH,
  COIN_FACE_PATH,
  COIN_HOVER,
  COIN_SIZE,
  COLLECT_POP_MS,
  COLLECT_POP_PX,
  EXIT_MS,
  EXIT_SINK,
  MASCOT_GRID,
  RUNNER_INSET,
  RUNNER_SIZE,
  coinCollected,
  exitJumpY,
  jumpHeight,
  nextCoinDelay,
  pickCoinX,
  poseAt,
  scaleTrackX,
  spriteClipBottom,
  stepAlong,
  type Coin,
} from "@/lib/composerMascot";

type Props = {
  /// The composer card whose top edge the sprite patrols.
  boxRef: RefObject<HTMLElement | null>;
  busy: boolean;
  /// Called once the exit hop has finished, so the caller can unmount the layer.
  onExited?: () => void;
};

type LiveCoin = Coin & { el: HTMLDivElement; collectedAt: number | null };

const COIN_SVG = `<svg viewBox="0 0 8 8" width="${COIN_SIZE}" height="${COIN_SIZE}" shape-rendering="crispEdges" fill="#e8b923" aria-hidden="true"><path class="composer-coin-face" d="${COIN_FACE_PATH}"/><path class="composer-coin-edge" d="${COIN_EDGE_PATH}"/></svg>`;

/// The composer's pixel cat: it walks the card's top edge while a turn is in
/// flight, jumps for the coins that appear on the ledge, and hops off the rim
/// when the turn ends.
///
/// Rides a portal so its transforms are never trapped by the card's own
/// `backdrop-filter` (which is a containing block), and reads the ledge from the
/// live box rect each frame — the composer's width changes with the window and
/// the panel, and the sprite is expected to keep walking across the new one.
export function ComposerMascot({ boxRef, busy, onExited }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLDivElement>(null);
  const coinsRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const onExitedRef = useRef(onExited);
  busyRef.current = busy;
  onExitedRef.current = onExited;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const sprite = spriteRef.current;
    const coinLayer = coinsRef.current;
    if (!layer || !sprite || !coinLayer) return;

    let along = 0;
    let facing: 1 | -1 = 1;
    let prevWidth = 0;
    let last = performance.now();
    let raf = 0;
    let coinId = 0;
    let nextCoinAt = last + nextCoinDelay(true);
    let exiting = false;
    let exitAt = 0;
    let frozenX = 0;
    let frozenFacing: 1 | -1 = 1;
    let finished = false;
    const coins: LiveCoin[] = [];
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const showLayer = (shown: boolean) => {
      layer.style.visibility = shown ? "visible" : "hidden";
    };
    showLayer(false);

    const placeSprite = (
      boxLeft: number,
      boxTop: number,
      x: number,
      y: number,
      face: 1 | -1,
    ) => {
      sprite.style.setProperty(
        "--runner-x",
        `${Math.round(boxLeft + x - RUNNER_SIZE / 2)}px`,
      );
      sprite.style.setProperty(
        "--runner-y",
        `${Math.round(boxTop - RUNNER_SIZE - y + 1)}px`,
      );
      sprite.style.setProperty("--runner-facing", String(face));
      sprite.style.setProperty("--runner-clip", `${spriteClipBottom(y)}px`);
    };

    const clearCoins = () => {
      for (const coin of coins) coin.el.remove();
      coins.length = 0;
    };

    const apply = (now: number) => {
      const dt = Math.min(now - last, 48);
      last = now;

      const box = boxRef.current;
      if (!box || document.hidden) {
        showLayer(false);
        return;
      }
      const rect = box.getBoundingClientRect();
      if (rect.width <= 0) {
        showLayer(false);
        return;
      }
      showLayer(true);

      const width = rect.width;
      const insetTrack = Math.max(0, width - RUNNER_INSET * 2);
      if (prevWidth > 0 && prevWidth !== width) {
        const prevInset = Math.max(0, prevWidth - RUNNER_INSET * 2);
        along = scaleTrackX(along, prevInset, insetTrack);
        frozenX = scaleTrackX(frozenX, prevWidth, width);
        for (const coin of coins) coin.x = scaleTrackX(coin.x, prevWidth, width);
      }
      prevWidth = width;

      if (busyRef.current) {
        if (exiting) exiting = false;
        finished = false;
        if (!reduced) {
          const stepped = stepAlong(along, facing, dt, insetTrack);
          along = stepped.along;
          facing = stepped.facing;
        }
      } else if (!exiting && !finished) {
        exiting = true;
        exitAt = now;
        const current = poseAt(along, facing, width, []);
        frozenX = current.x;
        frozenFacing = current.facing;
        for (const coin of coins) {
          if (coin.collectedAt == null) coin.collectedAt = now;
        }
      }

      if (exiting) {
        const t = reduced ? 1 : Math.min(1, (now - exitAt) / EXIT_MS);
        placeSprite(
          rect.left,
          rect.top,
          frozenX,
          reduced ? -EXIT_SINK : exitJumpY(t),
          frozenFacing,
        );
        for (const coin of [...coins]) {
          const pop = Math.min(
            1,
            (now - (coin.collectedAt ?? now)) / COLLECT_POP_MS,
          );
          coin.el.style.opacity = String(1 - pop);
          if (pop >= 1) {
            coin.el.remove();
            coins.splice(coins.indexOf(coin), 1);
          }
        }
        if (t >= 1 && !finished) {
          finished = true;
          clearCoins();
          onExitedRef.current?.();
        }
        return;
      }

      // A coin left behind by a resize — or one a fast walker overtook — is off
      // the usable ledge, so it counts as collected rather than sitting there.
      for (const coin of coins) {
        if (
          coin.collectedAt == null &&
          (coin.x < RUNNER_INSET || coin.x > width - RUNNER_INSET)
        ) {
          coin.collectedAt = now;
        }
      }

      const pose = poseAt(along, facing, width, coins);
      const hasLive = coins.some((coin) => coin.collectedAt == null);
      if (!reduced && !hasLive && now >= nextCoinAt) {
        const x = pickCoinX(width, pose.x);
        if (x != null) {
          const el = document.createElement("div");
          el.className = "absolute top-0 left-0";
          el.style.width = `${COIN_SIZE}px`;
          el.style.height = `${COIN_SIZE}px`;
          el.style.transform =
            "translate3d(var(--coin-x, -64px), var(--coin-y, -64px), 0)";
          el.innerHTML = COIN_SVG;
          coinLayer.append(el);
          coins.push({
            id: ++coinId,
            x,
            height: COIN_HOVER,
            el,
            collectedAt: null,
          });
        } else {
          nextCoinAt = now + 2000;
        }
      }

      for (const coin of [...coins]) {
        if (coin.collectedAt == null && coinCollected(pose, coin)) {
          coin.collectedAt = now;
          nextCoinAt = now + nextCoinDelay(false);
        }

        const bob = coin.collectedAt == null ? Math.sin(now / 180) * 2 : 0;
        const pop =
          coin.collectedAt == null
            ? 0
            : Math.min(1, (now - coin.collectedAt) / COLLECT_POP_MS);
        coin.el.style.setProperty(
          "--coin-x",
          `${Math.round(rect.left + coin.x - COIN_SIZE / 2)}px`,
        );
        coin.el.style.setProperty(
          "--coin-y",
          `${Math.round(rect.top - coin.height - COIN_SIZE / 2 - bob - COLLECT_POP_PX * pop)}px`,
        );
        coin.el.style.opacity = String(1 - pop);
        if (pop >= 1) coin.el.remove();
        if (pop >= 1 && jumpHeight(pose.x, [coin]) <= 0.5) {
          coins.splice(coins.indexOf(coin), 1);
        }
      }

      placeSprite(rect.left, rect.top, pose.x, pose.y, pose.facing);
    };

    apply(last);
    const tick = (now: number) => {
      apply(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearCoins();
      showLayer(false);
    };
  }, [boxRef]);

  return createPortal(
    <div
      ref={layerRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 overflow-visible text-muted-foreground"
      style={{ visibility: "hidden" }}
    >
      <div ref={coinsRef} className="absolute inset-0" />
      <div
        ref={spriteRef}
        className="absolute top-0 left-0 origin-bottom will-change-transform"
        style={{
          width: RUNNER_SIZE,
          height: RUNNER_SIZE,
          transform:
            "translate3d(var(--runner-x, -64px), var(--runner-y, -64px), 0) scaleX(var(--runner-facing, 1))",
          clipPath: "inset(0 0 var(--runner-clip, 0px) 0)",
        }}
      >
        <svg
          viewBox={`0 0 ${MASCOT_GRID} ${MASCOT_GRID}`}
          shapeRendering="crispEdges"
          fill="currentColor"
          className="composer-mascot-active size-full"
        >
          <path className="composer-mascot-rest" d={CAT_REST_PATH} />
          <path className="composer-mascot-talk" d={CAT_TALK_PATH} />
        </svg>
      </div>
    </div>,
    document.body,
  );
}
