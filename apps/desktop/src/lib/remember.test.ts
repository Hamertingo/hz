import { describe, expect, it } from "vitest";

import { noteFor, withIndexLine } from "./remember";

const now = new Date("2026-10-23T14:05:09Z");

describe("remember", () => {
  it("makes a titled note with a safe file name", () => {
    const note = noteFor("Pro plan is R$ 89, capped at 100h", now);
    expect(note.name).toBe("chat-pro-plan-is-r-89-capped-at-100h-202610231405.md");
    expect(note.content).toContain("# Pro plan is R$ 89, capped at 100h");
    expect(note.content).toContain("_Saved from the chat on 2026-10-23._");
  });

  it("never makes a name from nothing", () => {
    expect(noteFor("   ", now).name.startsWith("chat-note-")).toBe(true);
    expect(noteFor("???", now).name.startsWith("chat-note-")).toBe(true);
  });

  it("cuts a long first line for the title only", () => {
    const note = noteFor("word ".repeat(40), now);
    expect(note.title.length).toBeLessThanOrEqual(60);
    expect(note.content.split("\n").slice(2).join("\n")).toContain("word ".repeat(40).trim());
  });

  it("adds one index line and not a second", () => {
    const note = { name: "chat-x.md", title: "X" };
    const once = withIndexLine("- [A](a.md)\n", note);
    expect(once).toBe("- [A](a.md)\n- [X](chat-x.md) — saved from chat\n");
    expect(withIndexLine(once, note)).toBe(once);
    expect(withIndexLine("", note)).toBe("- [X](chat-x.md) — saved from chat\n");
  });
});
