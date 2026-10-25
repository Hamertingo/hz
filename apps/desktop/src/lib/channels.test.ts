import { describe, expect, it } from "vitest";

import {
  addressChips,
  channelProblem,
  composerHint,
  dayLabel,
  feedRows,
  isUnread,
  mentionedIds,
  roundLabel,
  slugName,
  sortChannels,
  sortTasks,
  taskTone,
} from "@/lib/channels";
import type { Channel, ChannelMessage, Task } from "@/types/events";

const people = [
  { id: "a", name: "Atlas" },
  { id: "m", name: "Mila" },
  { id: "l", name: "Leo" },
];

const channel = (over: Partial<Channel> = {}): Channel => ({
  id: "c",
  workspaceId: "w",
  name: "launch",
  purpose: "",
  members: ["a", "m"],
  lead: "a",
  mode: "mention",
  rounds: 3,
  muted: false,
  archived: false,
  created: 0,
  lastSeq: 0,
  lastTs: 0,
  lastAgentSeq: 0,
  readSeq: 0,
  ...over,
});

const msg = (seq: number, from: string, round: number, ts = Date.UTC(2026, 9, 23, 12, seq), over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  seq,
  ts,
  from,
  text: `m${seq}`,
  replyTo: null,
  reactions: [],
  round,
  taskId: null,
  kind: "message",
  attachments: [],
  ...over,
});

describe("slugName", () => {
  it("keeps letters and digits and joins the rest with one dash", () => {
    expect(slugName("  Launch Plan! ")).toBe("launch-plan");
    expect(slugName("infra__alerts")).toBe("infra-alerts");
    expect(slugName("###")).toBe("");
    expect(slugName("a".repeat(60))).toHaveLength(40);
  });
});

describe("channelProblem", () => {
  const base = { name: "launch", members: ["a"], channels: [channel()], workspaceId: "w" };
  it("refuses an empty name, no agents and a taken name", () => {
    expect(channelProblem({ ...base, name: " ! " })).toBe("A channel needs a name.");
    expect(channelProblem({ ...base, name: "new", members: [] })).toBe("Pick at least one agent.");
    expect(channelProblem(base)).toBe("#launch already exists.");
  });
  it("lets a channel keep its own name, another workspace reuse it, and an archived one go free", () => {
    expect(channelProblem({ ...base, editing: "c" })).toBeNull();
    expect(channelProblem({ ...base, workspaceId: "w2" })).toBeNull();
    expect(channelProblem({ ...base, channels: [channel({ archived: true })] })).toBeNull();
  });
});

describe("mentionedIds", () => {
  it("reads @names the way the backend routes them", () => {
    expect(mentionedIds("@mila and @LEO please", people)).toEqual(["m", "l"]);
    expect(mentionedIds("@Leo @leo", people)).toEqual(["l"]);
    expect(mentionedIds("@Milan is not Mila", people)).toEqual([]);
    expect(mentionedIds("mail mila@example.com", people)).toEqual([]);
    expect(mentionedIds("hey @Mila, @Leo.", people)).toEqual(["m", "l"]);
    expect(mentionedIds("`@Leo` and\n```\n@Atlas\n```", people)).toEqual([]);
    expect(mentionedIds("@all look", people)).toEqual(["a", "m", "l"]);
  });
  it("prefers the longer name", () => {
    const two = [{ id: "1", name: "Mila" }, { id: "2", name: "Mila Costa" }];
    expect(mentionedIds("@Mila Costa knows", two)).toEqual(["2"]);
    expect(mentionedIds("@Mila knows", two)).toEqual(["1"]);
  });
});

describe("addressChips", () => {
  it("makes one chip per mention and flags who is not in the channel", () => {
    const chips = addressChips("@Mila @Leo @mila", people, ["a", "m"]);
    expect(chips.map((c) => [c.agent.name, c.inChannel])).toEqual([["Mila", true], ["Leo", false]]);
  });
});

describe("unread and order", () => {
  it("is unread when an agent spoke after the reader looked, unless muted", () => {
    expect(isUnread(channel({ lastAgentSeq: 3, readSeq: 2 }))).toBe(true);
    expect(isUnread(channel({ lastAgentSeq: 3, readSeq: 3 }))).toBe(false);
    expect(isUnread(channel({ lastAgentSeq: 3, readSeq: 0, muted: true }))).toBe(false);
  });
  it("lists unread first, then the latest", () => {
    const sorted = sortChannels([
      channel({ name: "b", lastTs: 5 }),
      channel({ name: "a", lastTs: 1, lastAgentSeq: 2 }),
      channel({ name: "c", lastTs: 9 }),
    ]);
    expect(sorted.map((c) => c.name)).toEqual(["a", "c", "b"]);
  });
});

describe("labels", () => {
  it("spells the round line", () => {
    expect(roundLabel(1, 3, 3)).toBe("Round 1 of 3 · three agents answering");
    expect(roundLabel(2, 3, 1)).toBe("Round 2 of 3 · one agent answering");
  });
  it("names the day", () => {
    const now = Date.UTC(2026, 9, 23, 12);
    expect(dayLabel(now, now)).toBe("Today");
    expect(dayLabel(now - 86_400_000, now)).toBe("Yesterday");
  });
  it("says how the channel answers", () => {
    expect(composerHint("mention", 3, "Atlas")).toContain("Atlas leads");
    expect(composerHint("turns", 1, "Atlas")).toContain("1 round.");
    expect(composerHint("lead", 2, "Atlas")).toContain("Atlas reads every message");
  });
});

describe("feedRows", () => {
  it("puts a day divider first and a round divider where a round starts", () => {
    const rows = feedRows(
      [msg(1, "me", 0), msg(2, "m", 1), msg(3, "l", 1), msg(4, "a", 2)],
      3,
      Date.UTC(2026, 9, 23, 18),
    );
    expect(rows.map((r) => (r.kind === "msg" ? `m${r.message.seq}` : r.kind === "round" ? r.label : r.kind))).toEqual([
      "day",
      "m1",
      "Round 1 of 3 · two agents answering",
      "m2",
      "m3",
      "Round 2 of 3 · one agent answering",
      "m4",
    ]);
  });
  it("starts the count again after the reader speaks, and draws notes as notes", () => {
    const rows = feedRows(
      [msg(1, "m", 1), msg(2, "hz", 1, undefined, { kind: "note" }), msg(3, "me", 0), msg(4, "l", 1)],
      3,
      Date.UTC(2026, 9, 23, 18),
    );
    expect(rows.filter((r) => r.kind === "round")).toHaveLength(2);
    expect(rows.find((r) => r.kind === "note")).toBeTruthy();
  });
});

describe("tasks", () => {
  const task = (id: string, status: Task["status"], updated: number): Task => ({
    id,
    channelId: "c",
    title: id,
    owner: "m",
    status,
    created: 0,
    updated,
    messageSeq: null,
    result: null,
    steps: [],
  });
  it("lists open tasks first and tones the dot", () => {
    expect(sortTasks([task("done", "done", 9), task("w", "writing", 1), task("y", "waiting_for_you", 5)]).map((t) => t.id)).toEqual(["y", "w", "done"]);
    expect(taskTone("waiting_for_you")).toBe("amber");
    expect(taskTone("done")).toBe("green");
  });
});
