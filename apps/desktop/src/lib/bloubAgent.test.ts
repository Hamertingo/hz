import { describe, expect, it } from "vitest";

import { bloubSkinFor, bloubStateFor, type BloubMood } from "./bloubAgent";
import { COLORS, SHAPES } from "./bloub/skins";
import { EXPRESSION_BY_ID } from "./bloub/expressions";
import { STATE_BY_ID } from "./bloub/states";

describe("bloubSkinFor", () => {
  it("gives the same Agent the same bot every time", () => {
    // The whole reason it is derived rather than stored: two builds, two
    // machines, one face — and nothing to keep in step on the index.
    expect(bloubSkinFor("explore")).toEqual(bloubSkinFor("explore"));
    expect(bloubSkinFor("worker")).toEqual(bloubSkinFor("worker"));
  });

  it("only ever names a skin the engine has", () => {
    // A name the engine cannot spell would draw a blank avatar rather than fail,
    // which is the one kind of bug a viewer would never report.
    for (const name of ["explore", "worker", "verifier", "notes-writer", "a", "Ω"]) {
      const skin = bloubSkinFor(name);
      expect(SHAPES.some((shape) => shape.id === skin.shape)).toBe(true);
      expect(COLORS.some((color) => color.id === skin.color)).toBe(true);
      expect(EXPRESSION_BY_ID.has(skin.expression)).toBe(true);
    }
  });

  it("freezes a still somewhere the pose has settled", () => {
    // Frame zero is the same pose for everyone — a list of Agents would be a row
    // of identical bots — so the still is taken later, and inside the first
    // breath of life so nothing is caught mid-blink.
    for (const name of ["explore", "worker", "verifier"]) {
      const skin = bloubSkinFor(name);
      expect(skin.frozenAt).toBeGreaterThan(0.3);
      expect(skin.frozenAt).toBeLessThan(1.5);
    }
  });

  it("lets a stored portrait decide the shape and colour before the name does", () => {
    const first = bloubSkinFor("explore", 0);
    const second = bloubSkinFor("explore", 1);
    expect(first.shape).not.toBe(second.shape);

    // The marker owns the shape and the colour and nothing else — which is what
    // makes the Portrait row a pick rather than a hint. What it does *not* own is
    // still the name's, so two Agents sharing a marker are still two bots rather
    // than one drawn twice.
    for (const name of ["explore", "worker"]) {
      const skin = bloubSkinFor(name, 3);
      expect([skin.shape, skin.color]).toEqual(["capsule", "orange"]);
    }
    expect(bloubSkinFor("explore", 3)).not.toEqual(bloubSkinFor("worker", 3));
  });

  it("takes the reader's own pick over everything else", () => {
    // The three answers, in order: a pick beats the marker, and the marker beats
    // the name. This is the one that has to win.
    const picked = { shape: "triangle", color: "rose", expression: "hilare" };
    const skin = bloubSkinFor("explore", 3, picked);
    expect([skin.shape, skin.color, skin.expression]).toEqual([
      "triangle",
      "rose",
      "hilare",
    ]);

    // The still's date is still the name's: two Agents wearing one pick are two
    // bots, not one drawn twice.
    expect(bloubSkinFor("explore", 3, picked).frozenAt).not.toBe(
      bloubSkinFor("worker", 3, picked).frozenAt,
    );
  });

  it("gives the first ten markers ten different bots", () => {
    const seen = new Set(
      Array.from({ length: 10 }, (_, variant) => {
        const skin = bloubSkinFor("agent", variant);
        return `${skin.shape}/${skin.color}`;
      }),
    );
    expect(seen.size).toBe(10);
  });

  it("keeps a marker whose index runs past the tables", () => {
    // The marker is whatever the store holds; it is never validated here, and a
    // large one must wrap rather than come back undefined.
    for (const variant of [7, 8, 11, 12, 40]) {
      const skin = bloubSkinFor("agent", variant);
      expect(SHAPES.some((shape) => shape.id === skin.shape)).toBe(true);
      expect(COLORS.some((color) => color.id === skin.color)).toBe(true);
    }
  });
});

describe("bloubStateFor", () => {
  it("names a state the engine has, for every mood the UI has", () => {
    const moods: BloubMood[] = ["idle", "working", "asking", "done", "failed"];
    for (const mood of moods) {
      expect(STATE_BY_ID.has(bloubStateFor(mood))).toBe(true);
    }
  });

  it("does not collapse two moods onto one state", () => {
    // Two states alike would make the sidebar's marks and the working indicator
    // say the same thing while meaning different ones.
    const states = (["idle", "working", "asking", "done", "failed"] as BloubMood[]).map(
      bloubStateFor,
    );
    expect(new Set(states).size).toBe(states.length);
  });
});
