import { describe, expect, it } from "vitest";

import {
  diffOf,
  firstOpen,
  groupItems,
  inboxCounts,
  inboxOrder,
  keyAction,
  openCount,
  readApproval,
  stepFrom,
  verdictCopy,
} from "@/lib/inbox";
import type { InboxItem } from "@/types/events";

const item = (p: Partial<InboxItem> & Pick<InboxItem, "id" | "kind">): InboxItem => ({
  agentId: "ada",
  title: p.id,
  sub: "",
  payload: {},
  why: null,
  created: 100,
  state: "open",
  resolution: null,
  ok: false,
  resolvedAt: null,
  sent: false,
  archived: false,
  sessionId: "s",
  ref: null,
  channel: null,
  ...p,
});

const ITEMS = [
  item({ id: "a1", kind: "approval", created: 10 }),
  item({ id: "a2", kind: "approval", created: 30 }),
  item({ id: "q1", kind: "question", created: 20 }),
  item({ id: "m1", kind: "mention", created: 40 }),
  item({ id: "d1", kind: "done", state: "done", resolution: "FINISHED", ok: true, created: 5, resolvedAt: 50 }),
  item({ id: "r1", kind: "approval", state: "done", resolution: "ALLOWED", ok: true, created: 1, resolvedAt: 60 }),
  item({ id: "x1", kind: "approval", archived: true }),
];

describe("grouping", () => {
  it("puts decisions, mentions and settled rows in their own groups, newest first", () => {
    const g = groupItems(ITEMS, "all");
    expect(g.map((x) => x.key)).toEqual(["needs", "mentions", "done"]);
    expect(g[0].items.map((i) => i.id)).toEqual(["a2", "q1", "a1"]);
    expect(g[1].items.map((i) => i.id)).toEqual(["m1"]);
    expect(g[2].items.map((i) => i.id)).toEqual(["r1", "d1"]);
  });

  it("never lists an archived row", () => {
    expect(inboxOrder(groupItems(ITEMS, "all")).some((i) => i.id === "x1")).toBe(false);
  });

  it("a filter keeps one group, and the tabs count each", () => {
    expect(groupItems(ITEMS, "mentions").map((x) => x.key)).toEqual(["mentions"]);
    expect(inboxCounts(ITEMS)).toEqual({ all: 6, needs: 3, mentions: 1, done: 2 });
  });

  it("the badge counts what waits on you and ignores finished notes", () => {
    expect(openCount(ITEMS)).toBe(4);
    expect(openCount(ITEMS, new Set(["bob"]))).toBe(0);
  });
});

describe("walking the list", () => {
  const order = inboxOrder(groupItems(ITEMS, "all"));

  it("J and K wrap at both ends", () => {
    expect(stepFrom(order, order.at(-1)!.id, 1)).toBe(order[0].id);
    expect(stepFrom(order, order[0].id, -1)).toBe(order.at(-1)!.id);
    expect(stepFrom(order, "a2", 1)).toBe("q1");
  });

  it("with nothing selected J lands on the first and K on the last", () => {
    expect(stepFrom(order, null, 1)).toBe(order[0].id);
    expect(stepFrom(order, null, -1)).toBe(order.at(-1)!.id);
    expect(stepFrom([], null, 1)).toBeNull();
  });

  it("after a decision the next row is the first still open", () => {
    expect(firstOpen(order)).toBe("a2");
    expect(firstOpen(order.filter((i) => i.state !== "open"))).toBeNull();
  });
});

describe("keys", () => {
  const cmd = item({ id: "c", kind: "approval", payload: { form: "cmd", command: "git push" } });
  const post = item({ id: "p", kind: "approval", payload: { form: "post", posts: ["a"] } });
  const ask = item({ id: "q", kind: "question", payload: { question: "?", choices: ["Yes", "No"] } });

  it("A allows and D denies; E means nothing on a command", () => {
    expect(keyAction(cmd, "a")).toEqual({ type: "resolve", verdict: "ALLOWED" });
    expect(keyAction(cmd, "D")).toEqual({ type: "resolve", verdict: "DENIED" });
    expect(keyAction(cmd, "e")).toBeNull();
  });

  it("a post asks 'not now' and offers edit first", () => {
    expect(keyAction(post, "d")).toEqual({ type: "resolve", verdict: "NOT NOW" });
    expect(keyAction(post, "e")).toEqual({ type: "edit" });
  });

  it("digits pick a choice, up to as many as there are", () => {
    expect(keyAction(ask, "2")).toEqual({ type: "answer", choice: "No" });
    expect(keyAction(ask, "3")).toBeNull();
    expect(keyAction(ask, "d")).toEqual({ type: "resolve", verdict: "SKIPPED" });
  });

  it("a settled decision answers to no key, and a finished note archives on D", () => {
    expect(keyAction({ ...cmd, state: "done" }, "a")).toBeNull();
    expect(keyAction(item({ id: "d", kind: "done", state: "done" }), "d")).toEqual({ type: "archive" });
    expect(keyAction(item({ id: "m", kind: "mention" }), "d")).toEqual({ type: "resolve", verdict: "READ" });
  });
});

describe("payloads", () => {
  it("reads an approval defensively", () => {
    const a = readApproval(item({ id: "z", kind: "approval", payload: { form: "weird", posts: ["x", 3] } }));
    expect(a.form).toBe("tool");
    expect(a.posts).toEqual(["x"]);
    expect(a.options).toEqual([]);
  });

  it("builds a diff from an Edit and from a Write", () => {
    const edit = diffOf({ file_path: "/a/b.ts", old_string: "a\nb", new_string: "a\nc" })!;
    expect(edit.path).toBe("/a/b.ts");
    expect(edit.lines.map((l) => l.kind)).toEqual(["same", "del", "add"]);
    expect(diffOf({ path: "/n.md", content: "x\ny" })!.lines.every((l) => l.kind === "add")).toBe(true);
    expect(diffOf({ command: "ls" })).toBeNull();
  });

  it("says a verdict in words", () => {
    expect(verdictCopy("DENIED", "Ada")).toEqual(["Denied", "Ada was told no."]);
    expect(verdictCopy("ALLOWED", "Mila", "post")[0]).toBe("Approved");
  });
});
