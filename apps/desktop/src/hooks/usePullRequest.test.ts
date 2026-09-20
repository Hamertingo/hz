import { describe, expect, it, vi, beforeEach } from "vitest";

import { prTabVisible, runPrAction, type PrAction } from "./usePullRequest";
import type { PullRequest } from "@/types/events";

/// The bridge, replaced so the table below can be read without a Tauri process.
const invoke = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args as []) }));

const pr = { number: 1, state: "OPEN" } as PullRequest;

/// **The command table, pinned one row at a time.** Every write in this pane is
/// a command name plus its arguments and nothing else, so a mistake here is a
/// button that either does nothing or does the wrong thing on GitHub — and
/// neither shows up in a render. Each case names the exact argument object the
/// bridge has to receive.
describe("runPrAction", () => {
  beforeEach(() => invoke.mockClear());

  const cases: [PrAction, string, Record<string, unknown>][] = [
    [{ kind: "merge", method: "squash" }, "merge_pr", { cwd: "/repo", number: 7, method: "squash" }],
    [{ kind: "delete_branch" }, "delete_branch", { cwd: "/repo", number: 7 }],
    [{ kind: "reopen" }, "reopen_pr", { cwd: "/repo", number: 7 }],
    [{ kind: "close" }, "close_pr", { cwd: "/repo", number: 7 }],
    [{ kind: "ready" }, "mark_pr_ready", { cwd: "/repo", number: 7 }],
    [{ kind: "comment", body: "hello" }, "comment_on_pr", { cwd: "/repo", number: 7, body: "hello" }],
    // Addressed by the thread, never by the PR: a reply that named the pull
    // request would answer the whole conversation rather than the note.
    [
      { kind: "reply", threadId: "T_1", body: "hello" },
      "reply_to_thread",
      { cwd: "/repo", threadId: "T_1", body: "hello" },
    ],
    [
      { kind: "resolve", threadId: "T_1", resolved: true },
      "set_thread_resolved",
      { cwd: "/repo", threadId: "T_1", resolved: true },
    ],
    [
      { kind: "resolve", threadId: "T_1", resolved: false },
      "set_thread_resolved",
      { cwd: "/repo", threadId: "T_1", resolved: false },
    ],
    [
      { kind: "review", number: 7, verdict: "approve", body: "" },
      "submit_review",
      { cwd: "/repo", number: 7, verdict: "approve", body: "" },
    ],
    [
      { kind: "reviewers", logins: ["alice"] },
      "request_reviewers",
      { cwd: "/repo", number: 7, logins: ["alice"] },
    ],
  ];

  for (const [action, command, args] of cases) {
    it(`sends ${action.kind} to ${command}`, async () => {
      await runPrAction("/repo", 7, action);
      expect(invoke).toHaveBeenCalledWith(command, args);
    });
  }

  /// The switch is exhaustive over `PrAction`, so a tenth action that nobody
  /// wired up fails to compile rather than falling through to a no-op.
  it("covers every action the panel can build", () => {
    expect(new Set(cases.map(([action]) => action.kind)).size).toBe(
      cases.length - 1, // `resolve` appears twice, once per direction
    );
  });
});

describe("prTabVisible", () => {
  it("keeps the tab where the reader can set up their way out of it", () => {
    // The pane is the cure in both states, and the only place the app says
    // `gh` is what pull requests run on.
    expect(prTabVisible([], { kind: "no_cli" })).toBe(true);
    expect(prTabVisible([], { kind: "not_authenticated" })).toBe(true);
  });

  it("hides it for everything else with nothing to show", () => {
    // Including a missing `gh` in a directory with no GitHub remote, which the
    // backend answers as `no_remote` rather than `no_cli` precisely so this
    // reads false.
    expect(prTabVisible([], { kind: "no_remote" })).toBe(false);
    expect(prTabVisible([], { kind: "other", detail: "boom" })).toBe(false);
    expect(prTabVisible([], null)).toBe(false);
  });

  it("follows the rows once there are any, failed refresh or not", () => {
    // A refresh that failed must not take the tab away from pull requests the
    // reader is looking at — the panel draws that sentence under the header.
    expect(prTabVisible([pr], null)).toBe(true);
    expect(prTabVisible([pr], { kind: "other", detail: "boom" })).toBe(true);
  });
});
