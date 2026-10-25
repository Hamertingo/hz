import { formatClock } from "@/lib/clock";
import { lineDiff, type DiffLine } from "@/lib/lineDiff";
import type { InboxItem, PermissionOption } from "@/types/events";

export type InboxFilter = "all" | "needs" | "mentions" | "done";

export const INBOX_FILTERS: readonly { key: InboxFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs", label: "Needs you" },
  { key: "mentions", label: "Mentions" },
  { key: "done", label: "Done" },
];

export type InboxGroup = { key: Exclude<InboxFilter, "all">; label: string; items: InboxItem[] };

const isOpen = (i: InboxItem) => i.state === "open";

/// The newest activity on a row: when it was settled, else when it arrived.
const touched = (i: InboxItem) => i.resolvedAt ?? i.created;

/// The rows of a filter as the mockup groups them: what needs a decision, the
/// mentions, then everything settled — newest first within each, so the thing
/// that just arrived is on top. Archived rows never reach here; the backend
/// leaves them out.
export function groupItems(items: readonly InboxItem[], filter: InboxFilter): InboxGroup[] {
  const live = items.filter((i) => !i.archived);
  const newest = (a: InboxItem, b: InboxItem) => touched(b) - touched(a);
  const groups: InboxGroup[] = [
    { key: "needs", label: "Needs you", items: live.filter((i) => isOpen(i) && i.kind !== "mention").sort(newest) },
    { key: "mentions", label: "Mentions", items: live.filter((i) => isOpen(i) && i.kind === "mention").sort(newest) },
    { key: "done", label: "Earlier today", items: live.filter((i) => !isOpen(i)).sort(newest) },
  ];
  return filter === "all" ? groups : groups.filter((g) => g.key === filter);
}

/// The counts on the filter tabs.
export function inboxCounts(items: readonly InboxItem[]): Record<InboxFilter, number> {
  const groups = groupItems(items, "all");
  const by = (k: string) => groups.find((g) => g.key === k)?.items.length ?? 0;
  return { all: items.filter((i) => !i.archived).length, needs: by("needs"), mentions: by("mentions"), done: by("done") };
}

/// The rows in the order they are read, which is the order J and K walk.
export function inboxOrder(groups: readonly InboxGroup[]): InboxItem[] {
  return groups.flatMap((g) => g.items);
}

/// What the sidebar's badge counts: the items waiting on the reader. A finished
/// note is information, not a debt, so it never adds to the number.
export function openCount(items: readonly InboxItem[], agentIds?: ReadonlySet<string>): number {
  return items.filter((i) => isOpen(i) && !i.archived && (!agentIds || agentIds.has(i.agentId))).length;
}

/// The row J or K lands on, wrapping at both ends. `null` for an empty list.
export function stepFrom(order: readonly InboxItem[], currentId: string | null, delta: number): string | null {
  if (!order.length) return null;
  const at = order.findIndex((i) => i.id === currentId);
  const next = at < 0 ? (delta > 0 ? 0 : order.length - 1) : (at + delta + order.length) % order.length;
  return order[next].id;
}

/// The first row still waiting on a decision, for after one is settled.
export function firstOpen(order: readonly InboxItem[]): string | null {
  return order.find(isOpen)?.id ?? null;
}

export type ApprovalPayload = {
  form: "cmd" | "edit" | "post" | "tool" | "auto";
  tool: string;
  command: string | null;
  path: string | null;
  posts: string[];
  input: Record<string, unknown>;
  options: PermissionOption[];
  always: string | null;
};

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function readApproval(item: InboxItem): ApprovalPayload {
  const p = item.payload;
  const form = p.form === "cmd" || p.form === "edit" || p.form === "post" || p.form === "auto" ? p.form : "tool";
  return {
    form,
    tool: str(p.tool) ?? "",
    command: str(p.command),
    path: str(p.path),
    posts: Array.isArray(p.posts) ? p.posts.filter((x): x is string => typeof x === "string") : [],
    input: obj(p.input),
    options: Array.isArray(p.options) ? (p.options as PermissionOption[]) : [],
    always: str(p.always),
  };
}

export function readQuestion(item: InboxItem): { question: string; choices: string[]; answer: string | null } {
  const p = item.payload;
  return {
    question: str(p.question) ?? item.title,
    choices: Array.isArray(p.choices) ? p.choices.filter((c): c is string => typeof c === "string") : [],
    answer: str(p.answer),
  };
}

export function readMention(item: InboxItem): { text: string; place: string } {
  return { text: str(item.payload.text) ?? item.title, place: str(item.payload.place) ?? "their chat" };
}

export function readDone(item: InboxItem): { summary: string; steps: number; durationMs: number | null } {
  const p = item.payload;
  return {
    summary: str(p.summary) ?? item.title,
    steps: typeof p.steps === "number" ? p.steps : 0,
    durationMs: typeof p.durationMs === "number" ? p.durationMs : null,
  };
}

/// What a file-editing call changes, as lines to draw. Claude's Edit carries
/// both sides; a Write carries only the new text, so every line is an addition.
/// `null` for a call whose input holds neither.
export function diffOf(input: Record<string, unknown>): { path: string | null; lines: DiffLine[] } | null {
  const path = str(input.file_path) ?? str(input.path);
  const before = str(input.old_string);
  const after = typeof input.new_string === "string" ? input.new_string : null;
  if (before !== null && after !== null) return { path, lines: lineDiff(before, after) };
  const content = str(input.content);
  if (content !== null) return { path, lines: content.split("\n").map((text) => ({ kind: "add" as const, text })) };
  return null;
}

/// What a key does on the open item, or `null`. The same letters the buttons
/// wear: A allows, D declines, E edits first (a post only), 1–3 pick a choice.
export type KeyAction =
  | { type: "resolve"; verdict: string }
  | { type: "answer"; choice: string }
  | { type: "edit" }
  | { type: "archive" };

export function keyAction(item: InboxItem, key: string): KeyAction | null {
  if (item.state !== "open" && item.kind !== "done") return null;
  const k = key.toLowerCase();
  switch (item.kind) {
    case "approval": {
      const post = readApproval(item).form === "post";
      if (k === "a") return { type: "resolve", verdict: "ALLOWED" };
      if (k === "d") return { type: "resolve", verdict: post ? "NOT NOW" : "DENIED" };
      if (k === "e" && post) return { type: "edit" };
      return null;
    }
    case "question": {
      const n = Number(k);
      const choices = readQuestion(item).choices;
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) return { type: "answer", choice: choices[n - 1] };
      if (k === "d") return { type: "resolve", verdict: "SKIPPED" };
      return null;
    }
    case "mention":
      return k === "d" ? { type: "resolve", verdict: "READ" } : null;
    case "done":
      return k === "d" ? { type: "archive" } : null;
  }
}

/// A verdict as a word and the sentence under it, the way the settled check and
/// the toast say it.
export function verdictCopy(verdict: string, name: string, form?: ApprovalPayload["form"]): [string, string] {
  switch (verdict) {
    case "ALLOWED":
      return form === "post" ? ["Approved", `${name} is posting it now.`] : ["Allowed", `${name} is carrying on.`];
    case "DENIED":
      return ["Denied", `${name} was told no.`];
    case "NOT NOW":
      return ["Not now", `${name} holds off.`];
    case "ANSWERED":
      return ["Answered", `${name} picks the task back up.`];
    case "REPLIED":
      return ["Replied", `Your reply is in ${name}'s chat.`];
    case "READ":
      return ["Read", ""];
    case "SKIPPED":
      return ["Skipped", `${name} goes on without an answer.`];
    case "EXPIRED":
      return ["Expired", `${name} is no longer waiting on this.`];
    case "AUTO":
      return ["Allowed by rule", ""];
    default:
      return ["Finished", ""];
  }
}

/// HH:MM, the clock the rows and the action bar use.
export function clockTime(ms: number): string {
  return formatClock(new Date(ms));
}

/// "5 posts" and friends, for the "+N more" under a post preview.
export function morePosts(total: number, shown: number): number {
  return Math.max(0, total - shown);
}
