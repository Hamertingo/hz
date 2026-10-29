import { describe, expect, it } from "vitest";

import { answerBody, answerPrefix, answerSuffix, counts, isNoReply, teamActivity, threadLines } from "@/lib/teamTalk";
import type { ChannelMessage, PairThread } from "@/types/events";

const viktor = { sessionId: "s-v", title: "Viktor" };

const msg = (seq: number, ts: number, from: string, extra: Partial<ChannelMessage> = {}): ChannelMessage => ({
  seq,
  ts,
  from,
  text: `m${seq}`,
  replyTo: null,
  reactions: [],
  round: 0,
  taskId: null,
  kind: "message",
  attachments: [],
  ...extra,
});

describe("answerBody", () => {
  it("takes the answer out of the framing talk.rs builds", () => {
    const wire = `${answerPrefix(viktor)}The price is $9.${answerSuffix(viktor)}`;
    expect(answerBody(wire, viktor)).toBe("The price is $9.");
  });

  it("is null for anything else", () => {
    expect(answerBody("[Atlas answered in your thread]\n\nhi", viktor)).toBeNull();
    expect(answerBody("hello", null)).toBeNull();
  });
});

describe("isNoReply", () => {
  it("reads the agent's silence loosely and nothing else as it", () => {
    expect(isNoReply("NO_REPLY")).toBe(true);
    expect(isNoReply(" `NO_REPLY`. ")).toBe(true);
    expect(isNoReply("No, reply first")).toBe(false);
    expect(isNoReply("")).toBe(false);
    expect(isNoReply(null)).toBe(false);
  });
});

describe("threadLines", () => {
  const pair: PairThread = {
    channelId: "p1",
    other: "v",
    messages: [
      msg(1, 100, "a", { fromChat: true }),
      msg(2, 200, "v", { toChat: false }),
      msg(3, 300, "a", { fromChat: false }),
      msg(4, 400, "v", { toChat: true }),
      msg(5, 450, "hz", { kind: "note" }),
    ],
  };

  it("counts what the agent's own chat does not already show", () => {
    expect(counts(pair.messages[0], "a")).toBe(false);
    expect(counts(pair.messages[1], "a")).toBe(true);
    expect(counts(pair.messages[3], "a")).toBe(false);
    expect(counts(pair.messages[0], "v"), "the receiver handled it in the thread").toBe(true);
    expect(counts(pair.messages[4], "a"), "notes are not messages").toBe(false);
  });

  it("is one line per thread between two points of the chat, with the newest message", () => {
    const lines = threadLines([pair], "a", 0, 1000);
    expect(lines).toEqual([{ channelId: "p1", other: "v", count: 2, latest: pair.messages[2] }]);
    expect(threadLines([pair], "a", 250, 1000)[0].count).toBe(1);
    expect(threadLines([pair], "a", 300, 1000)).toEqual([]);
  });
});

describe("teamActivity", () => {
  it("prefers working for someone over waiting on someone", () => {
    const status = [{ agentId: "a", waitingFor: ["v"], workingFor: ["m"] }, { agentId: "b", waitingFor: ["v"], workingFor: [] }];
    expect(teamActivity(status, "a")).toEqual({ activity: "workingFor", who: ["m"] });
    expect(teamActivity(status, "b")).toEqual({ activity: "waitingFor", who: ["v"] });
    expect(teamActivity(status, "c")).toBeNull();
  });
});
