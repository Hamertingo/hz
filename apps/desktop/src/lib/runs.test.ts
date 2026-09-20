import { describe, expect, it } from "vitest";

import {
  ANY,
  DEFAULT_RUN_FILTERS,
  stepLabel,
  applyRunFilters,
  eventOptions,
  groupRuns,
  isLive,
  runDuration,
  runFilterCount,
  runState,
  workflowOptions,
} from "@/lib/runs";
import type { WorkflowRun } from "@/types/events";

/// Built from a base and cast, the way the sibling tests build a row: every
/// field the rules do not read is noise per run, and one that *is* read is named
/// at the case that reads it.
const run = (over: Partial<WorkflowRun> = {}) =>
  ({
    id: 1,
    number: 1,
    attempt: 1,
    workflow: "CI",
    title: "a commit subject",
    branch: "main",
    sha: "abcdef1234567890",
    event: "push",
    status: "completed",
    conclusion: "success",
    createdAt: "2026-09-01T10:00:00Z",
    startedAt: "2026-09-01T10:00:05Z",
    updatedAt: "2026-09-01T10:03:05Z",
    url: "https://example.test/run/1",
    ...over,
  }) as WorkflowRun;

describe("runState", () => {
  it("reads where a run is before how it ended", () => {
    expect(runState(run({ status: "queued", conclusion: null }))).toBe("queued");
    expect(runState(run({ status: "requested", conclusion: null }))).toBe("queued");
    expect(runState(run({ status: "in_progress", conclusion: null }))).toBe("running");
    // A finished run whose conclusion has not landed is not "running".
    expect(runState(run({ status: "completed", conclusion: null }))).toBe("neutral");
  });

  it("folds every way a run can end", () => {
    expect(runState(run({ conclusion: "success" }))).toBe("success");
    expect(runState(run({ conclusion: "skipped" }))).toBe("skipped");
    expect(runState(run({ conclusion: "cancelled" }))).toBe("cancelled");
    expect(runState(run({ conclusion: "stale" }))).toBe("cancelled");
  });

  // A run that did not do its job is a failure whatever GitHub calls it, and a
  // row that drew a timeout as anything else hides the one it exists for.
  it("calls a timeout and a startup failure what they are", () => {
    expect(runState(run({ conclusion: "timed_out" }))).toBe("failure");
    expect(runState(run({ conclusion: "startup_failure" }))).toBe("failure");
    expect(runState(run({ conclusion: "action_required" }))).toBe("failure");
  });

  /// **The safe direction.** A word this build has never heard of is not a
  /// failure, so it lands on the quiet end rather than turning a row red.
  it("does not guess a failure out of a word it does not know", () => {
    expect(runState(run({ conclusion: "something_new" }))).toBe("neutral");
  });

  it("counts a queued run as live, because that is where the wait is", () => {
    expect(isLive(run({ status: "queued" }))).toBe(true);
    expect(isLive(run({ status: "in_progress" }))).toBe(true);
    expect(isLive(run({ status: "completed" }))).toBe(false);
  });
});

describe("runDuration", () => {
  it("measures a finished run from its start to its last move", () => {
    expect(runDuration(run())).toBe(180_000);
  });

  // A queued run has no start time, and the number the reader is watching is the
  // wait itself.
  it("measures a queued run's wait from when it was created", () => {
    const waiting = run({
      status: "queued",
      startedAt: null,
      createdAt: "2026-09-01T10:00:00Z",
    });
    const at = Date.parse("2026-09-01T10:00:40Z");
    expect(runDuration(waiting, at)).toBe(40_000);
  });

  it("answers nothing where there is no stamp to measure from", () => {
    expect(runDuration(run({ startedAt: null, createdAt: "not a date" }))).toBeNull();
    expect(runDuration(run({ updatedAt: "not a date" }))).toBeNull();
  });

  /// A clock skew between this machine and GitHub's is not a negative duration.
  it("never reports a run that finished before it started", () => {
    const skewed = run({ startedAt: "2026-09-01T10:00:10Z", updatedAt: "2026-09-01T10:00:00Z" });
    expect(runDuration(skewed)).toBe(0);
  });
});

describe("groupRuns", () => {
  it("gathers the failures where the eye lands, and drops an empty group", () => {
    const grouped = groupRuns([
      run({ id: 1, status: "in_progress", conclusion: null }),
      run({ id: 2, status: "queued", conclusion: null }),
      run({ id: 3, conclusion: "failure" }),
      run({ id: 4, conclusion: "success" }),
    ]);
    expect(grouped.map((group) => group.key)).toEqual(["live", "failed", "past"]);
    expect(grouped[0].runs.map((r) => r.id)).toEqual([1, 2]);
    expect(grouped[1].runs.map((r) => r.id)).toEqual([3]);
    // Finished is what is left, which is the shape of the answer rather than a
    // bin: a pass, a skip and a cancellation all ended without asking anything.
    expect(grouped[2].runs.map((r) => r.id)).toEqual([4]);

    expect(groupRuns([run({ conclusion: "failure" })]).map((g) => g.key)).toEqual(["failed"]);
  });
});

describe("stepLabel", () => {
  /// GitHub's own parts of speech, taken off a row where they repeat on every
  /// second line — and kept on anything the repository actually named.
  it("takes the shell prefix off and leaves a named step alone", () => {
    expect(stepLabel("Run pnpm lint")).toBe("pnpm lint");
    expect(stepLabel("Post Run actions/checkout@v4")).toBe("Post actions/checkout@v4");
    expect(stepLabel("Set up job")).toBe("Set up job");
    // Not a prefix unless it is the whole word: an action may be *called* Run.
    expect(stepLabel("Runaway test")).toBe("Runaway test");
  });
});

describe("applyRunFilters", () => {
  const rows = [
    run({ id: 1, number: 7, workflow: "Release", status: "in_progress", conclusion: null, branch: "main" }),
    run({ id: 2, number: 42, workflow: "CI", conclusion: "failure", event: "pull_request" }),
    run({ id: 3, number: 43, workflow: "CI", conclusion: "success" }),
  ];

  it("finds a run by its workflow, its title, its branch or its number", () => {
    const find = (query: string) =>
      applyRunFilters(rows, { ...DEFAULT_RUN_FILTERS, query }).map((r) => r.id);
    expect(find("release")).toEqual([1]);
    expect(find("a commit subject")).toEqual([1, 2, 3]);
    expect(find("#42")).toEqual([2]);
    expect(find("abcdef1")).toEqual([1, 2, 3]);
  });

  it("narrows to the three things a reader arrives asking", () => {
    const ids = (status: (typeof DEFAULT_RUN_FILTERS)["status"]) =>
      applyRunFilters(rows, { ...DEFAULT_RUN_FILTERS, status }).map((r) => r.id);
    expect(ids("live")).toEqual([1]);
    expect(ids("failed")).toEqual([2]);
    expect(ids("passed")).toEqual([3]);
    expect(ids("all")).toEqual([1, 2, 3]);
  });

  it("narrows by workflow and by trigger together", () => {
    expect(
      applyRunFilters(rows, { ...DEFAULT_RUN_FILTERS, workflow: "CI", event: "push" }).map(
        (r) => r.id,
      ),
    ).toEqual([3]);
  });

  it("counts the menu's controls and not the box beside them", () => {
    expect(runFilterCount(DEFAULT_RUN_FILTERS)).toBe(0);
    expect(runFilterCount({ ...DEFAULT_RUN_FILTERS, query: "anything" })).toBe(0);
    expect(runFilterCount({ ...DEFAULT_RUN_FILTERS, status: "failed", workflow: "CI" })).toBe(2);
  });
});

describe("the facet lists", () => {
  it("names each workflow once and sorts them", () => {
    expect(
      workflowOptions([run({ workflow: "Warm cache" }), run({ workflow: "CI" }), run({ workflow: "CI" })]),
    ).toEqual(["CI", "Warm cache"]);
  });

  // Most common first: a repository runs on `push` far more than on `schedule`.
  it("lists triggers most common first", () => {
    expect(
      eventOptions([
        run({ event: "push" }),
        run({ event: "push" }),
        run({ event: "schedule" }),
        run({ event: "dynamic" }),
      ]),
    ).toEqual(["push", "dynamic", "schedule"]);
  });

  it("reads the sentinel as no filter at all", () => {
    expect(ANY).toBe("all");
  });
});
