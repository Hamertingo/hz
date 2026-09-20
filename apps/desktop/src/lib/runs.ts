import type { WorkflowRun } from "@/types/events";

/// What a run's two words add up to, as one thing a row can draw.
///
/// **GitHub splits a run's life across `status` and `conclusion`**, and a row has
/// room for one glyph and one colour: `status` is where it is (queued, in
/// progress, completed) and `conclusion` is how it ended. They are never both
/// interesting — a run in flight has no conclusion and a finished one has no
/// live status — so the fold is a switch, pure and tested, the same split
/// `prState` makes for a pull request.
export type RunState =
  | "queued"
  | "running"
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "neutral";

/// The words a row can draw, and the tone each one carries.
///
/// **A word first and a colour second**, the rule every mark in this app
/// follows: red is also the destructive colour, so the sentence carries the
/// meaning and the tone only agrees with it. `neutral` is where anything
/// unrecognised lands, which is the safe direction — a run this build cannot
/// name is not reported as having failed.
export const RUN_LABEL: Record<RunState, string> = {
  queued: "Queued",
  running: "Running",
  success: "Passed",
  failure: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
  neutral: "Finished",
};

export function runTone(state: RunState): "bad" | "good" | "muted" {
  if (state === "failure") return "bad";
  if (state === "success") return "good";
  return "muted";
}

/// A run folded to the one state its row wears.
export function runState(run: Pick<WorkflowRun, "status" | "conclusion">): RunState {
  const status = run.status.toLowerCase();
  if (status === "queued" || status === "requested" || status === "waiting" || status === "pending") {
    return "queued";
  }
  if (status === "in_progress") return "running";

  switch (run.conclusion?.toLowerCase()) {
    case "success":
      return "success";
    // `timed_out`, `startup_failure` and `action_required` are all a run that
    // did not do its job, and a row that drew them as anything but failed would
    // be hiding the one it exists for.
    case "failure":
    case "timed_out":
    case "startup_failure":
    case "action_required":
      return "failure";
    case "cancelled":
    case "stale":
      return "cancelled";
    case "skipped":
      return "skipped";
    default:
      return "neutral";
  }
}

/// Whether a run is still going — queued counts, because the reader waiting on
/// CI is waiting from the moment the push lands.
export function isLive(run: Pick<WorkflowRun, "status" | "conclusion">): boolean {
  const state = runState(run);
  return state === "queued" || state === "running";
}

/// How long a run took, or has been going, in milliseconds. `null` where the
/// host gave no stamp to measure from.
///
/// **A queued run measures its own wait**, from when it was created rather than
/// from a start time it does not have yet: "queued for 40 seconds" is the number
/// the reader is watching, and the alternative is a blank.
export function runDuration(run: WorkflowRun, now: number = Date.now()): number | null {
  const from = Date.parse(run.startedAt ?? run.createdAt);
  if (Number.isNaN(from)) return null;

  const to = isLive(run) ? now : Date.parse(run.updatedAt);
  if (Number.isNaN(to)) return null;

  // A clock skew between this machine and GitHub's is not a negative duration.
  return Math.max(0, to - from);
}

/// The three runs a reader reads a run list as.
///
/// **A failure is not filed with the passes.** The question CI is opened with is
/// "did what I pushed pass", and the answer is a red row — so the failures are
/// gathered where the eye lands rather than being sorted chronologically among
/// thirty green ones. `Finished` is then what is left, which is the shape of the
/// answer rather than a bin. Empty groups are dropped, on the rule every list in
/// this app follows.
export function groupRuns<T extends WorkflowRun>(
  runs: T[],
): { key: "live" | "failed" | "past"; label: string; runs: T[] }[] {
  const live = runs.filter(isLive);
  const failed = runs.filter((run) => !isLive(run) && runState(run) === "failure");
  const past = runs.filter((run) => !isLive(run) && runState(run) !== "failure");

  return [
    { key: "live" as const, label: "In flight", runs: live },
    { key: "failed" as const, label: "Failed", runs: failed },
    { key: "past" as const, label: "Finished", runs: past },
  ].filter((group) => group.runs.length > 0);
}

/// A step's name, with GitHub's own shell prefix taken off.
///
/// GitHub labels a step `Run <command>`, and `Post Run <command>` for the
/// teardown an action leaves behind, because in the workflow file it *is* a
/// `run:`. On a row that prefix is part of speech rather than information, and it
/// is the same on every second row of a real job.
///
/// **Display only.** The tooltip and anything a reader copies carries the name
/// whole, so nothing is lost — and a name that is not one of those two is left
/// exactly as the repository wrote it.
export function stepLabel(name: string): string {
  if (name.startsWith("Post Run ")) return `Post ${name.slice("Post Run ".length)}`;
  if (name.startsWith("Run ")) return name.slice("Run ".length);
  return name;
}

/// What the reader has narrowed the list by.
///
/// **The branch is not here.** `gh run list --branch` is server-side, so it is
/// part of what the hook reads rather than a filter over rows in hand — the same
/// split the pull-requests page makes between `state` and everything else.
export type RunFilters = {
  /// Free text over everything a row says: the workflow, the title, the branch,
  /// the event, the run number.
  query: string;
  /// Which of the four things a reader arrives asking about.
  status: "all" | "live" | "failed" | "passed";
  /// One workflow, or `all`.
  workflow: string;
  /// One trigger, or `all` — `push`, `pull_request`, `schedule`, `dynamic`.
  event: string;
};

export const ANY = "all";

export const DEFAULT_RUN_FILTERS: RunFilters = {
  query: "",
  status: "all",
  workflow: ANY,
  event: ANY,
};

export const STATUS_LABEL: Record<RunFilters["status"], string> = {
  all: "Any state",
  live: "In flight",
  failed: "Failed",
  passed: "Passed",
};

export const STATUS_OPTIONS: readonly RunFilters["status"][] = ["all", "live", "failed", "passed"];

/// Everything a row says, folded once.
function haystack(run: WorkflowRun): string {
  return [run.workflow, run.title, run.branch, run.event, `#${run.number}`, run.sha.slice(0, 7)]
    .join(" ")
    .toLowerCase();
}

/// The rows that survive every filter, in the order they arrived in.
export function applyRunFilters<T extends WorkflowRun>(runs: T[], filters: RunFilters): T[] {
  const needle = filters.query.trim().toLowerCase();

  return runs.filter((run) => {
    if (filters.status === "live" && !isLive(run)) return false;
    if (filters.status === "failed" && runState(run) !== "failure") return false;
    if (filters.status === "passed" && runState(run) !== "success") return false;
    if (filters.workflow !== ANY && run.workflow !== filters.workflow) return false;
    if (filters.event !== ANY && run.event !== filters.event) return false;
    return !needle || haystack(run).includes(needle);
  });
}

/// How many of the menu's own controls are off their default. The search box is
/// not counted: it is drawn on the row, where the reader can already see the
/// words they typed.
export function runFilterCount(filters: RunFilters): number {
  return (
    (filters.status === "all" ? 0 : 1) +
    (filters.workflow === ANY ? 0 : 1) +
    (filters.event === ANY ? 0 : 1)
  );
}

/// The workflows the list holds, alphabetically — one entry per name, since two
/// runs of one workflow are not two workflows.
export function workflowOptions(runs: WorkflowRun[]): string[] {
  const found = new Set(runs.map((run) => run.workflow).filter(Boolean));
  return [...found].sort((a, b) => a.localeCompare(b));
}

/// The branches the list holds runs on, most common first.
///
/// Most common rather than alphabetical, for the reason the triggers are: the
/// branch a repository builds on most is the one a reader is most likely to want,
/// and the menu is read past to reach the one below it. The menu always offers
/// *All branches* first, so a narrowing is never a corner the reader cannot come
/// back from — which is what makes it safe for this list to shrink to the branch
/// it picked.
export function branchOptions(runs: WorkflowRun[]): string[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (run.branch) counts.set(run.branch, (counts.get(run.branch) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([branch]) => branch);
}

/// The triggers the list holds, most common first: a repository runs on `push`
/// far more than on `schedule`, and a menu that lists the rare one first is a
/// menu read past.
export function eventOptions(runs: WorkflowRun[]): string[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (run.event) counts.set(run.event, (counts.get(run.event) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([event]) => event);
}
