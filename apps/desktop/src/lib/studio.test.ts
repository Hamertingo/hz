import { describe, expect, it } from "vitest";

import { formatClock } from "@/lib/clock";
import { coerceStudio, DEFAULT_STUDIO, sendsOnKey, validTime } from "@/lib/studio";

const key = (over: Partial<Parameters<typeof sendsOnKey>[0]> = {}) => ({
  key: "Enter",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...over,
});

describe("coerceStudio", () => {
  it("gives the defaults for nothing and for junk", () => {
    expect(coerceStudio(null)).toEqual(DEFAULT_STUDIO);
    expect(coerceStudio("nope")).toEqual(DEFAULT_STUDIO);
    expect(coerceStudio({ density: "huge", notify: 3, quiet: { from: "25:00" } })).toEqual(DEFAULT_STUDIO);
  });

  it("keeps good picks and drops the wrong-typed ones one by one", () => {
    const out = coerceStudio({
      density: "compact",
      livingFaces: false,
      sendKey: "modEnter",
      clock: "12h",
      notify: { needsYou: "off", finishes: "loud", mentions: "badge" },
      quiet: { on: true, from: "23:30", to: "07:15" },
      warmUp: "yes",
    });
    expect(out.density).toBe("compact");
    expect(out.livingFaces).toBe(false);
    expect(out.sendKey).toBe("modEnter");
    expect(out.clock).toBe("12h");
    expect(out.notify).toEqual({ needsYou: "off", finishes: DEFAULT_STUDIO.notify.finishes, mentions: "badge" });
    expect(out.quiet).toEqual({ on: true, from: "23:30", to: "07:15" });
    expect(out.warmUp).toBe(true);
  });
});

describe("validTime", () => {
  it("takes HH:MM only", () => {
    expect(validTime("00:00")).toBe(true);
    expect(validTime("23:59")).toBe(true);
    expect(validTime("24:00")).toBe(false);
    expect(validTime("7:30")).toBe(false);
    expect(validTime(730)).toBe(false);
  });
});

describe("sendsOnKey", () => {
  it("sends on plain Enter by default and never on Shift+Enter", () => {
    expect(sendsOnKey(key(), "enter")).toBe(true);
    expect(sendsOnKey(key({ shiftKey: true }), "enter")).toBe(false);
    expect(sendsOnKey(key({ metaKey: true }), "enter")).toBe(false);
    expect(sendsOnKey(key({ key: "a" }), "enter")).toBe(false);
  });

  it("with the modifier pick, Enter is a newline and ⌘/Ctrl+Enter sends", () => {
    expect(sendsOnKey(key(), "modEnter")).toBe(false);
    expect(sendsOnKey(key({ metaKey: true }), "modEnter")).toBe(true);
    expect(sendsOnKey(key({ ctrlKey: true }), "modEnter")).toBe(true);
    expect(sendsOnKey(key({ metaKey: true, shiftKey: true }), "modEnter")).toBe(false);
  });
});

describe("formatClock", () => {
  const at = new Date(2026, 9, 23, 18, 5);
  it("writes 24 hours padded, or 12 hours with AM/PM", () => {
    expect(formatClock(at, false)).toBe("18:05");
    expect(formatClock(new Date(2026, 9, 23, 9, 5), false)).toBe("09:05");
    expect(formatClock(at, true)).toMatch(/^6:05\s?PM$/);
    expect(formatClock(new Date(2026, 9, 23, 0, 0), true)).toMatch(/^12:00\s?AM$/);
  });
});
