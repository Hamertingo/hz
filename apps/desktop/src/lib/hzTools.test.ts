import { describe, expect, it } from "vitest";

import { agentFromRequest } from "./agentFactory";
import { fileIn, hzTool, idIn, toolPosts } from "./hzTools";
import type { RosterAgent } from "./roster";
import type { AgentEvent, ToolResult } from "@/types/events";

let seq = 0;
function started(callId: string, name: string, input: Record<string, unknown>, title: string | null = null): AgentEvent {
  seq += 1;
  return {
    id: `e${seq}`, sessionId: "s", harness: "claude-acp", seq, ts: "2026-10-26T10:00:00Z", turnId: "t", subagent: null, raw: null,
    payload: { type: "tool_call_started", callId, name, toolType: "mcp", input, rawInput: null, title },
  } as unknown as AgentEvent;
}
const ok = (text: string): ToolResult => ({ text, isError: false, structured: null, exitCode: null, durationMs: 5, images: [] });

describe("an hz tool call", () => {
  it("is known under each CLI's spelling and nothing else", () => {
    expect(hzTool("mcp__hz__propose_draft")).toBe("propose_draft");
    expect(hzTool("hz_show_chart")).toBe("show_chart");
    expect(hzTool("show_plan", "hz · show_plan")).toBe("show_plan");
    expect(hzTool("mcp__team__team_ask")).toBeNull();
    expect(hzTool("mcp__hz__draft_status")).toBeNull();
  });

  it("names what its card needs in the answer", () => {
    expect(idIn("Page updated (id p_1a2b3c4d5e, version 3). 2 block(s) changed.")).toEqual({ id: "p_1a2b3c4d5e", version: 3 });
    expect(idIn("Draft posted (id 4f1e-aa). It is a card")).toEqual({ id: "4f1e-aa", version: null });
    expect(fileIn("Screenshot shared (file /h/.hz/attachments/s/screenshots/ada-1.png). The person")).toBe("/h/.hz/attachments/s/screenshots/ada-1.png");
  });
});

describe("the cards a turn posted", () => {
  it("come from each call's input and answer, in order, and a failed call posts none", () => {
    const calls = [
      started("d", "mcp__hz__propose_draft", { to: "ana@x.com", subject: "Invoice", body: "Hi Ana", via: "gmail" }),
      started("c", "mcp__hz__show_chart", { title: "Margin", kind: "line", unit: "%", points: [{ label: "Q1", value: 31 }, { label: "Q2", value: 40 }] }),
      started("x", "mcp__hz__show_chart", { title: "Broken", points: [] }),
      started("s", "mcp__hz__share_screenshot", { caption: "The deploy page" }),
    ];
    const results = new Map([
      ["d", ok("Draft posted (id d1). It is a card in the chat now")],
      ["c", ok("Chart shown in the chat (id c_1): 2 points.")],
      ["x", { ...ok("chart has no data"), isError: true }],
      ["s", ok("Screenshot shared (id c_2) (file /p/shot.png). The person sees it")],
    ]);
    expect(toolPosts(calls, results).map((p) => p.stored)).toEqual([undefined, "c_1", "c_2"]);
    expect(toolPosts(calls, results).map((p) => p.card)).toEqual([
      { type: "draft", id: "d1", to: "ana@x.com", part: "Invoice", body: "Hi Ana", channel: "gmail" },
      { type: "chart", title: "Margin", unit: "%", bars: [["Q1", 31], ["Q2", 40]], note: undefined, kind: "line" },
      { type: "image", path: "/p/shot.png", caption: "The deploy page" },
    ]);
  });

  it("show a page and a plan once, as they ended", () => {
    const calls = [
      started("p1", "mcp__hz__page_create", { title: "Pricing", html: "<p>a</p>" }),
      started("l1", "mcp__hz__show_plan", { steps: [{ text: "Read", status: "running" }, { text: "Write" }] }),
      started("p2", "mcp__hz__page_update", { id: "p_1", html: "<p>b</p>", base_version: 1 }),
      started("l2", "mcp__hz__show_plan", { steps: [{ text: "Read", status: "done" }, { text: "Write", status: "in_progress" }] }),
    ];
    const results = new Map([
      ["p1", ok("Page posted (id p_1, version 1). The person")],
      ["l1", ok("Plan shown: 0 of 2 done.")],
      ["p2", ok("Page updated (id p_1, version 2). 1 block(s) changed.")],
      ["l2", ok("Plan shown (id c_9): 1 of 2 done.")],
    ]);
    const posts = toolPosts(calls, results);
    expect(posts.map((p) => p.key)).toEqual(["p1", "l1"]);
    expect(posts[1].stored).toBe("c_9");
    expect(posts[0].card).toEqual({ type: "page", id: "p_1", title: "Pricing", url: "Live page", version: 2 });
    expect(posts[1].card).toEqual({ type: "plan", steps: [{ text: "Read", state: "done" }, { text: "Write", state: "run" }] });
  });

  it("show a sign-in while it waits and settle it by the answer", () => {
    const calls = [
      started("q", "qr_login", { site: "WhatsApp Web", why: "To read the group", region: { x: 10, y: 20, w: 200, h: 200 } }, "hz · qr_login"),
      started("l", "mcp__hz__request_login", { site: "github.com", why: "To open the PR" }),
    ];
    const waiting = toolPosts(calls, new Map());
    expect(waiting[0].card).toEqual({ type: "signin", site: "WhatsApp Web", why: "To read the group", qr: true, region: { x: 10, y: 20, w: 200, h: 200 }, state: "waiting" });
    const settled = toolPosts(calls, new Map([["q", ok("Sign-in card (id c_q) answered. The person chose not to sign in to WhatsApp Web now.")], ["l", ok("Sign-in card (id c_l) answered. The person says they are signed in to github.com")]]));
    expect(settled.map((p) => (p.card as { state: string }).state)).toEqual(["declined", "done"]);
  });

  it("names a new agent by the name it was given, even when the logged input is partial", () => {
    const posts = toolPosts([started("a", "mcp__hz__create_agent", { name: "Ivy" })], new Map([["a", ok("Made Ivy 2 (id c_a), Support desk. They are on the team")]]));
    expect(posts[0]).toEqual({ key: "a", stored: "c_a", card: { type: "agent", id: "", name: "Ivy 2", role: "Support desk" } });
  });

  // From a real Claude run: the call was logged with `{"to": …}` alone and the chart with `{"kind": …}`.
  it("still finds the card when the input arrived in part", () => {
    const calls = [started("d", "mcp__hz__propose_draft", { to: "ana@example.com" }), started("c", "mcp__hz__show_chart", { kind: "bar" }), started("w", "mcp__hz__wake_when_done", {})];
    const posts = toolPosts(calls, new Map([
      ["d", ok("Draft posted (id 3f64f17d-302e). It is a card")],
      ["c", ok("Chart shown in the chat (id c_c): 3 points.")],
      ["w", ok("Watching pid 4242 (id c_w): the build. When it ends you get a message")],
    ]));
    expect(posts.map((p) => [p.card.type, p.stored ?? (p.card as { id?: string }).id])).toEqual([["draft", "3f64f17d-302e"], ["chart", "c_c"], ["watch", "c_w"]]);
    expect(posts[2].card).toEqual({ type: "watch", label: "the build", pid: 4242 });
  });
});

describe("an agent another agent asked for", () => {
  const maker = {
    id: "atlas", name: "Atlas", kind: "owl", color: "#9a87ea", harness: "claude-acp", projectPath: "/p", modelId: "m", effort: "high",
    permission: "auto", workspaceId: "w1", instructions: "", role: "", sessionId: "s1",
  } as RosterAgent;

  it("takes its maker's CLI, folder, model and workspace, and an id of its own", () => {
    const made = agentFromRequest({ requestId: "r", fromAgentId: "atlas", name: "Atlas", role: "Support", job: "Answer tickets" }, [maker]);
    if (typeof made === "string") throw new Error(made);
    expect(made).toMatchObject({ id: "atlas2", name: "Atlas", role: "Support", instructions: "Answer tickets", harness: "claude-acp", projectPath: "/p", workspaceId: "w1", sessionId: null });
  });

  it("is refused for a maker the roster does not hold", () => {
    expect(agentFromRequest({ requestId: "r", fromAgentId: "ghost", name: "X", role: "", job: "" }, [maker])).toBe("the agent asking is not on the roster");
  });
});
