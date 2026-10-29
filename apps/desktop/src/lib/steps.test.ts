import { describe, expect, it } from "vitest";

import { cardsOf, findPrUrls, isDocPath } from "./chatCards";
import { stepTime, timingsOf, traceOf } from "./steps";
import type { AgentEvent, ToolResult } from "@/types/events";

const result = (over: Partial<ToolResult> = {}): ToolResult => ({
  text: "",
  isError: false,
  structured: null,
  exitCode: null,
  durationMs: null,
  images: [],
  ...over,
});

let n = 0;
const ev = (payload: object, ts: string): AgentEvent =>
  ({
    id: `e${n++}`,
    sessionId: "s",
    harness: "claude-acp",
    seq: n,
    ts,
    turnId: null,
    subagent: null,
    payload,
    raw: null,
  }) as unknown as AgentEvent;

const started = (callId: string, name: string, toolType: string, input: object, ts: string) =>
  ev({ type: "tool_call_started", callId, name, toolType, input, rawInput: null, title: null }, ts);
const completed = (callId: string, r: ToolResult, ts: string) =>
  ev({ type: "tool_call_completed", callId, result: r }, ts);

describe("timings", () => {
  it("prefers the harness's own duration and falls back to the timestamps", () => {
    const events = [
      started("a", "Read", "file_read", { file_path: "/x/plans.ts" }, "2026-10-23T10:00:00.000Z"),
      completed("a", result({ durationMs: 400 }), "2026-10-23T10:00:09.000Z"),
      started("b", "Bash", "shell", { command: "ls" }, "2026-10-23T10:00:10.000Z"),
      completed("b", result(), "2026-10-23T10:00:12.100Z"),
      started("c", "Bash", "shell", { command: "sleep" }, "2026-10-23T10:00:13.000Z"),
    ];
    const t = timingsOf(events);
    expect(t.get("a")).toBe(400);
    expect(t.get("b")).toBe(2100);
    expect(t.has("c")).toBe(false);
  });

  it("writes a time the way the trace shows it", () => {
    expect(stepTime(400)).toBe("0.4s");
    expect(stepTime(null)).toBe("");
  });
});

describe("trace", () => {
  it("makes one step per call, with its time and whether it failed", () => {
    const read = started("a", "Read", "file_read", { file_path: "/x/y/plans.ts" }, "2026-10-23T10:00:00Z");
    const run = started("b", "Bash", "shell", { command: "pnpm test" }, "2026-10-23T10:00:01Z");
    const results = new Map([
      ["a", result()],
      ["b", result({ isError: true })],
    ]);
    const steps = traceOf([read, run], results, new Map([["a", 400]]));
    expect(steps.map((s) => [s.verb, s.target, s.ms, s.failed])).toEqual([
      ["Read", "y/plans.ts", 400, false],
      ["Ran", "pnpm test", null, true],
    ]);
  });

  it("names who a team call went to", () => {
    const ask = started("t", "mcp__team__team_ask", "mcp", { to: "Hugo", text: "prices?" }, "2026-10-23T10:00:00Z");
    const [step] = traceOf([ask], new Map([["t", result()]]), new Map());
    expect([step.verb, step.target]).toEqual(["Asked", "Hugo"]);
  });
});

describe("cards", () => {
  it("offers documents and not source files", () => {
    expect(isDocPath("/p/notes/pricing-pro.md")).toBe(true);
    expect(isDocPath("/p/src/app.ts")).toBe(false);
    expect(isDocPath("/p/.claude/notes.md")).toBe(false);
    expect(isDocPath("/p/README")).toBe(false);
  });

  it("finds each pull request once", () => {
    const text = "see https://github.com/hyze/api-node/pull/208 and again https://github.com/hyze/api-node/pull/208, plus https://github.com/hyze/site/pull/212";
    expect(findPrUrls(text).map((p) => `${p.repo}#${p.number}`)).toEqual([
      "hyze/api-node#208",
      "hyze/site#212",
    ]);
  });

  it("builds a card for a written document and one for a PR a shell call printed", () => {
    const write = started("w", "Write", "file_edit", { file_path: "/p/notes/pricing-pro.md" }, "2026-10-23T10:00:00Z");
    const edit = started("e", "Edit", "file_edit", { file_path: "/p/notes/old.md" }, "2026-10-23T10:00:01Z");
    const pr = started("g", "Bash", "shell", { command: "gh pr create" }, "2026-10-23T10:00:02Z");
    const results = new Map([["g", result({ text: "https://github.com/hyze/site/pull/212\n" })]]);
    const cards = cardsOf([write, edit, pr], results, "Done.");
    expect(cards.map((c) => c.kind)).toEqual(["file", "pr"]);
  });
});
