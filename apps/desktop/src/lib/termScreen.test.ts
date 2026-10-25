import { describe, expect, it } from "vitest";

import { EMPTY_SCREEN, feed, screenText } from "./termScreen";

const print = (...chunks: string[]) => chunks.reduce(feed, EMPTY_SCREEN);

describe("terminal screen", () => {
  it("prints lines as they come, split across chunks", () => {
    expect(screenText(print("$ ls\r\nfi", "le.txt\r\n$ "))).toBe("$ ls\nfile.txt\n$ ");
  });

  it("drops colour and title escapes", () => {
    expect(screenText(print("\u001b[32mok\u001b[0m \u001b]0;title\u0007done"))).toBe("ok done");
    expect(screenText(print("\u001b[?2004hready"))).toBe("ready");
  });

  it("lets a carriage return rewrite the line, as a progress bar does", () => {
    expect(screenText(print("10%\r50%\r100%"))).toBe("100%");
    expect(screenText(print("abcdef\rxy"))).toBe("xycdef");
  });

  it("steps back on backspace so an echoed erase lands", () => {
    expect(screenText(print("ab\b\bx"))).toBe("xb");
  });

  it("keeps the last two thousand lines", () => {
    const lots = Array.from({ length: 2500 }, (_, i) => `l${i}\n`).join("");
    const screen = print(lots);
    expect(screen.lines.length).toBe(2000);
    expect(screen.lines.at(-2)).toBe("l2499");
  });
});
