import { useCallback, useMemo, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Clock,
  Copy,
  ExternalLink,
  RotateCcw,
  Search,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import Spinner from "@/components/ui/spinner";
import { asUnavailable, describe } from "@/hooks/usePrList";
import { useRunLog } from "@/hooks/useRunLog";
import { useWorkflowRun } from "@/hooks/useWorkflowRun";
import type { RunRow } from "@/hooks/useWorkflowRuns";
import { formatDuration, formatElapsed } from "@/lib/format";
import { annotate, logGroups, logText, tail, type LogLine } from "@/lib/logs";
import { RUN_LABEL, runState, runTone, stepLabel, type RunState } from "@/lib/runs";
import { cn } from "@/lib/utils";
import type { WorkflowJob, WorkflowRun, WorkflowStep } from "@/types/events";

/// How much of a step's log is drawn before it is cut to its tail.
///
/// **The tail, because the end is where a step went wrong.** A failing `pnpm
/// install` prints its whole dependency tree before the error, and a view that
/// capped the front would show the reader everything except the reason. The
/// count of what was left out is said rather than hidden.
const LOG_LINES = 800;

/// One workflow run, opened: what it was, the jobs it ran, and their logs.
///
/// **GitHub's own run page, in one column.** Its shape is a header that leads
/// with the commit, a rail of jobs with their steps hanging off it, and the log
/// as a pane of its own — and each of those is a decision about *reading* rather
/// than about drawing: a run is a thing that happened to a commit, its life is a
/// tree of jobs and steps, and its output is a record you scroll.
///
/// The pane is the one place this deviates, and it is the width: GitHub puts the
/// log beside the job list because it has the room a 320px pane does not, so the
/// log opens **under the job it belongs to** instead. It belongs to the *job*,
/// and that is not a shortcut — a step with a `name:` is titled in the log by its
/// command, so there is no per-step log to show (see [logs.ts](../../lib/logs.ts)).
export default function RunDetail({
  run,
  active,
  onChanged,
}: {
  run: RunRow;
  /// Whether the pane is the thing on screen: a hidden detail must not read.
  active: boolean;
  /// Called after a write, so the list beside this can re-read the row.
  onChanged: () => void;
}) {
  const detail = useWorkflowRun(run, active);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The read's own answer once it lands, the list's row until then: the pane is
  // opened by a click and has to draw something in the frame it opens.
  const shown: WorkflowRun = detail.detail?.run ?? run;
  const state = runState(shown);
  const took = runDurationOf(shown, Date.now());
  const jobs = detail.detail?.jobs ?? [];
  const failedJobs = jobs.filter((job) => runState(job) === "failure").length;

  /// Which jobs are expanded, and which of them has its log open.
  ///
  /// **`null` means "nobody has said", so the default can follow the read as it
  /// lands**: the job that failed opens itself, because it is the reason the pane
  /// was opened, and asking for one more click to reach it would be asking the
  /// reader to guess where the failure was.
  const [openJobs, setOpenJobs] = useState<string[] | null>(null);
  const revealed = useMemo(
    () => openJobs ?? jobs.filter((job) => runState(job) === "failure").map((job) => String(job.id)),
    [openJobs, jobs],
  );
  const toggleJob = (id: string) =>
    setOpenJobs(
      revealed.includes(id) ? revealed.filter((open) => open !== id) : [...revealed, id],
    );

  /// Whether the log is up at all — one job's at a time, since two logs is a pane
  /// that has stopped being scannable.
  const [logJob, setLogJob] = useState<string | null>(null);
  const log = useRunLog(run, logJob !== null);

  const retryable = failedJobs > 0;
  const rerun = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await invoke("rerun_workflow", { cwd: run.cwd, id: run.id, failedOnly: retryable });
      // The pane first, then the list: the reader is looking at the pane, and a
      // row still saying "Failed" under a run being asked again would be the
      // pane contradicted two inches away.
      detail.invalidate();
      onChanged();
    } catch (e) {
      setActionError(describe(asUnavailable(e)));
    } finally {
      setBusy(false);
    }
  }, [run.cwd, run.id, retryable, detail, onChanged]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-3">
        <header className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
          <div className="flex items-start gap-2.5">
            <Verdict state={state} size="lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {/* **The commit leads**, which is GitHub's own reading: a run is
                  something that happened to a commit, and the workflow is the
                  line under it rather than the headline. */}
              <p className="min-w-0 truncate font-medium">{shown.title}</p>
              <p className="flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground">
                {logJob !== null && <Spinner className="size-3 text-accent-command" />}
                <span className="min-w-0 truncate">{shown.workflow}</span>
                {shown.attempt > 1 && (
                  <span className="shrink-0 text-accent-command">attempt {shown.attempt}</span>
                )}
              </p>
            </div>
          </div>

          {/* Dot-separated, each segment giving way at the end rather than
              pushing the ones after it off — the meta line every list in this
              app reads down one column. */}
          <p className="flex min-w-0 items-center gap-1.5 overflow-hidden text-ui text-muted-foreground">
            <span className="shrink-0 tabular-nums">#{shown.number}</span>
            <Dot />
            {/* Each truncating segment carries its own `title`: this line gives
                way rather than wrapping, so the whole value has to be readable
                somewhere — and that is the rule the app reserves `title` for. */}
            <span className="min-w-0 max-w-40 truncate font-mono" title={shown.branch}>
              {shown.branch}
            </span>
            <Dot />
            <span className="shrink-0 font-mono" title={shown.sha}>
              {shown.sha.slice(0, 7)}
            </span>
            <Dot />
            <span className="min-w-0 truncate" title={shown.event}>
              {shown.event}
            </span>
            {took !== null && (
              <>
                <Dot />
                <span className="shrink-0 tabular-nums">
                  {detail.live ? `${formatElapsed(took)} so far` : formatDuration(took)}
                </span>
              </>
            )}
          </p>

          {/* **The verdict, and what it cost** — the two numbers a reader takes
              away, on the line GitHub puts its status and duration on. */}
          <div className="flex flex-wrap items-center gap-2 text-ui">
            <StatePill state={state} />
            {jobs.length > 0 && (
              <span className="text-muted-foreground">
                {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
                {failedJobs > 0 && <span className="text-destructive"> · {failedJobs} failed</span>}
              </span>
            )}

            <div className="ml-auto flex items-center gap-1.5">
              {/* **One button, and its verb is what it will do.** A run with
                  something red gets its failed jobs — what a reader who watched
                  a job go red is asking for, and it does not spend their minutes
                  on an answer they already have. Nothing red gets the whole
                  workflow, which is the flake case. */}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void rerun()}
                disabled={busy || detail.live}
                className="cursor-pointer gap-1.5"
              >
                {busy ? <Spinner className="size-3.5" /> : <RotateCcw className="size-3.5" />}
                {retryable ? "Re-run failed jobs" : "Re-run all jobs"}
              </Button>

              <span
                role="button"
                tabIndex={0}
                aria-label="Open on GitHub"
                onClick={() => void openUrl(shown.url)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  void openUrl(shown.url);
                }}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon-sm" }),
                  "cursor-pointer text-muted-foreground/70 hover:text-muted-foreground",
                )}
              >
                <ExternalLink className="size-3.5" />
              </span>
            </div>
          </div>

          {detail.error && <Note>{detail.error}</Note>}
          {actionError && <Note>{actionError}</Note>}
        </header>

        {/* **The jobs, as the rail GitHub draws them.** A node per job with its
            steps hanging off it, rather than a card each: they are one run's
            parts and belong to one another — which is the whole reason the
            version of this that framed each of them read as unrelated things. */}
        <ol className="flex flex-col">
          {jobs.map((job, index) => (
            <Job
              key={job.id}
              job={job}
              last={index === jobs.length - 1}
              open={revealed.includes(String(job.id))}
              onToggle={() => toggleJob(String(job.id))}
              logOpen={logJob === String(job.id)}
              onToggleLog={() => setLogJob(logJob === String(job.id) ? null : String(job.id))}
              logLines={logJob === String(job.id) ? log.lines : null}
              loading={log.lines === null && log.loading}
              error={log.error}
            />
          ))}
        </ol>

        {!detail.detail && detail.loading && <JobPlaceholders />}
      </div>
    </div>
  );
}

/// One job: a node on the rail, the steps under it, and its log when asked for.
///
/// **The log is the job's, and its toggle is on the job's row.** That is where it
/// belongs — the wire cannot attribute a line to a step — and it is also what
/// stops the same log appearing under every step the reader tries.
function Job({
  job,
  last,
  open,
  onToggle,
  logOpen,
  onToggleLog,
  logLines,
  loading,
  error,
}: {
  job: WorkflowJob;
  /// The last job's rail stops at its node, or it draws a line into nothing.
  last: boolean;
  open: boolean;
  onToggle: () => void;
  logOpen: boolean;
  onToggleLog: () => void;
  logLines: LogLine[] | null;
  loading: boolean;
  error: string | null;
}) {
  const state = runState(job);
  const ran = elapsed(job.startedAt, job.completedAt, state);

  return (
    <li className="flex gap-2.5">
      {/* The rail: the node, then the line every step hangs off. GitHub's own
          shape, and the one thing that makes a list of jobs read as one run. */}
      <div className="flex w-4 shrink-0 flex-col items-center pt-1">
        <Verdict state={state} />
        {!last && <span className="mt-1 w-px flex-1 bg-border" />}
      </div>

      <div className={cn("flex min-w-0 flex-1 flex-col", !last && "pb-3")}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-ui hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/50 transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 truncate font-medium">{job.name}</span>
          <span className="shrink-0 text-muted-foreground">
            {job.steps.length > 0 ? `${job.steps.length} steps` : "no steps"}
          </span>
          <span className={cn("ml-auto shrink-0", toneText(state))}>{RUN_LABEL[state]}</span>
          <span className="w-14 shrink-0 text-right text-muted-foreground/70 tabular-nums">
            {ran}
          </span>
        </button>

        {open && job.steps.length > 0 && (
          <ol className="mt-0.5 flex flex-col">
            {job.steps.map((step) => (
              <StepRow key={step.number} step={step} />
            ))}
          </ol>
        )}

        {open && (
          <div className="mt-1.5 flex flex-col">
            <button
              type="button"
              onClick={onToggleLog}
              aria-expanded={logOpen}
              className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-ui text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
            >
              <ChevronRight
                className={cn("size-3 shrink-0 transition-transform", logOpen && "rotate-90")}
              />
              <span className="font-mono">Log</span>
            </button>

            {logOpen && (
              <Log
                title={job.name}
                lines={logLines}
                loading={loading}
                error={error}
                job={job}
              />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/// One step: its number, its name, and how long it took.
///
/// **A line, not a control.** It was a disclosure, and the log it opened could
/// only ever be the *job's* — a step's output is not reliably grouped under its
/// name — so every step that was clicked showed the same thing. A chevron that
/// opens another step's answer is worse than no chevron.
function StepRow({ step }: { step: WorkflowStep }) {
  const state = runState(step);
  const ran = elapsed(step.startedAt, step.completedAt, state);

  return (
    <li className="flex items-center gap-2 text-ui">
      <span className="w-5 shrink-0 text-right text-muted-foreground/50 tabular-nums">
        {step.number}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          state === "failure" && "font-medium text-destructive",
          (state === "skipped" || state === "neutral") && "text-muted-foreground/60",
        )}
        // **The name whole.** The row draws GitHub's shell prefix off it, so the
        // tooltip is where the repository's own words still are.
        title={step.name}
      >
        {stepLabel(step.name)}
      </span>
      <span className="w-14 shrink-0 text-right text-muted-foreground/70 tabular-nums">{ran}</span>
    </li>
  );
}

/// A job's log: a toolbar, then the runner's own numbered stream.
///
/// **GitHub's log view, which is a numbered stream rather than a list of
/// blocks.** Every line carries its number in a dim column, and a `##[group]`
/// becomes a heading *in* the stream with the number of the first line inside it
/// — so a shut group reads as "lines 2 to 9" without being opened, which is the
/// whole reason the numbers are there. The search is GitHub's too: it is the only
/// way into a job that printed four thousand lines.
function Log({
  title,
  lines,
  loading,
  error,
  job,
}: {
  title: string;
  lines: LogLine[] | null;
  loading: boolean;
  error: string | null;
  job: WorkflowJob;
}) {
  /// Which groups the reader has opened. **Shut by default**, which is GitHub's
  /// own answer and the reason is the same: a runner wraps everything it does, so
  /// an open log is a wall of output with its own headings buried in it.
  const [open, setOpen] = useState<number[]>([]);
  /// Whether each line wears the clock it was written at.
  const [stamps, setStamps] = useState(false);
  const [query, setQuery] = useState("");

  const all = useMemo(() => lines ?? [], [lines]);
  const cut = useMemo(() => tail(all, LOG_LINES), [all]);
  const groups = useMemo(() => logGroups(cut.lines), [cut.lines]);
  /// **A line's number is its number in the whole log**, not in what is drawn:
  /// the tail drops the front, and a block of lines renumbered from one whenever
  /// the cap moves would make the numbers say nothing about the log.
  const numberOf = useCallback((index: number) => cut.hidden + index + 1, [cut.hidden]);

  const needle = query.trim().toLowerCase();
  /// What the search leaves, with the numbers it had — flat, because a hunt for
  /// a word is not a reading of the structure the headings describe.
  const hits = useMemo(
    () =>
      needle
        ? cut.lines
            .map((line, index) => ({ line, number: numberOf(index) }))
            .filter((hit) => hit.line.text.toLowerCase().includes(needle))
        : null,
    [needle, cut.lines, numberOf],
  );

  return (
    <div className="mt-1 flex flex-col rounded-md border border-border">
      {/* **The toolbar, which is what a log pane wears.** GitHub's carries the
          job's name, a search, and the two or three switches a reader wants on a
          record. The panel itself has no fill: neither recess token survives a
          ported palette whose card is lighter than its editor. */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-ui text-muted-foreground">
        {/* **No job name here.** It is on the row the `Log` toggle sits under,
            one line above, and a toolbar that says it again is the same word
            twice in one place — which is also what stopped the search fitting a
            320px pane. `aria-label` carries it for a reader who cannot see. */}
        <label
          aria-label={`Search the log for ${title}`}
          className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md border border-border px-1.5 focus-within:border-accent"
        >
          <Search className="size-3 shrink-0" />
          <input
            value={query}
            placeholder="Search logs"
            aria-label="Search this job's log"
            spellCheck={false}
            onChange={(e) => setQuery(e.currentTarget.value)}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </label>
        <button
          type="button"
          aria-pressed={stamps}
          aria-label="Show timestamps"
          onClick={() => setStamps((prev) => !prev)}
          className={cn(
            "flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 hover:bg-sidebar-accent/50 hover:text-foreground",
            stamps && "text-foreground",
          )}
        >
          <Clock className="size-3" />
        </button>
        <span className="shrink-0 tabular-nums">
          {hits
            ? `${hits.length} ${hits.length === 1 ? "match" : "matches"}`
            : cut.hidden > 0
              ? `last ${LOG_LINES} of ${cut.total}`
              : `${cut.total} lines`}
        </span>
        <button
          type="button"
          aria-label="Copy this job's log"
          onClick={() => void navigator.clipboard.writeText(logText(all))}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          <Copy className="size-3" />
          Copy
        </button>
      </div>

      <Errors lines={all} job={job} />

      <div className="flex max-h-96 flex-col overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
        {error && <p className="font-sans text-ui text-destructive">{error}</p>}

        {!error && lines === null && (
          <p className="font-sans text-ui text-muted-foreground">
            {loading ? "Reading…" : "No log to read."}
          </p>
        )}

        {!error && lines !== null && all.length === 0 && (
          <p className="font-sans text-ui text-muted-foreground">This job printed nothing.</p>
        )}

        {hits !== null &&
          (hits.length === 0 ? (
            <p className="font-sans text-ui text-muted-foreground">Nothing matches that.</p>
          ) : (
            <div className="flex flex-col break-words whitespace-pre-wrap">
              {hits.map((hit) => (
                <LogRow key={hit.number} line={hit.line} number={hit.number} stamps={stamps} />
              ))}
            </div>
          ))}

        {hits === null &&
          groups.map((group, index) =>
            group.title === null ? (
              <Lines key={index} lines={group.lines} from={group.at} numberOf={numberOf} stamps={stamps} />
            ) : (
              <div key={index} className="flex flex-col">
                <button
                  type="button"
                  onClick={() =>
                    setOpen((prev) =>
                      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
                    )
                  }
                  aria-expanded={open.includes(index)}
                  className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-0.5 text-left text-muted-foreground/70 hover:bg-sidebar-accent/50 hover:text-muted-foreground"
                >
                  <ChevronRight
                    className={cn(
                      "size-3 shrink-0 transition-transform",
                      open.includes(index) && "rotate-90",
                    )}
                  />
                  {/* **The number of the first line inside**, which is what makes
                      a shut block legible: the reader can see how much they are
                      folding away without opening it. */}
                  <span className="w-8 shrink-0 text-right tabular-nums">
                    {numberOf(group.at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{group.title}</span>
                </button>
                {open.includes(index) && (
                  <div className="pl-6">
                    <Lines
                      lines={group.lines}
                      from={group.at}
                      numberOf={numberOf}
                      stamps={stamps}
                    />
                  </div>
                )}
              </div>
            ),
          )}
      </div>
    </div>
  );
}

/// A run of lines, each with its number in the log's own column.
function Lines({
  lines,
  from,
  numberOf,
  stamps,
}: {
  lines: LogLine[];
  /// Where this run starts in the array the group was read from.
  from: number;
  numberOf: (index: number) => number;
  stamps: boolean;
}) {
  return (
    <div className="flex flex-col break-words whitespace-pre-wrap">
      {lines.map((line, index) => (
        <LogRow
          // Keyed by position: two identical lines are two lines of a log, and
          // nothing here reorders.
          key={index}
          line={line}
          number={numberOf(from + index)}
          stamps={stamps}
        />
      ))}
    </div>
  );
}

/// The failing lines, gathered at the foot of the log.
///
/// **The same lines, said twice, and that is deliberate.** GitHub does it: the
/// error is one line in four hundred, and a reader who has scrolled the tail is
/// the reader who most needs it. Nothing is hidden from its place in the log —
/// this is a second copy, not a move.
function Errors({ lines, job }: { lines: LogLine[]; job: WorkflowJob }) {
  const errors = useMemo(
    () => lines.map((l) => annotate(l.text)).filter((l) => l.kind === "error"),
    [lines],
  );
  if (errors.length === 0) return null;

  const step = failingStep(job);
  return (
    <div className="flex flex-col gap-0.5 border-b border-destructive/30 bg-destructive/5 p-2 font-sans text-ui">
      <span className="font-medium text-destructive">
        {step ? `Failed at step ${step.number} — ${stepLabel(step.name)}` : "Errors"}
      </span>
      {errors.map((line, index) => (
        <span key={index} className="break-words text-destructive">
          {line.text}
        </span>
      ))}
    </div>
  );
}

/// The step the job went red on, which is the one a reader wants named.
function failingStep(job: WorkflowJob): WorkflowStep | null {
  return job.steps.find((step) => runState(step) === "failure") ?? null;
}

/// One log line: its number, the clock if the reader asked for it, and the words
/// — coloured by what the runner said they were.
function LogRow({
  line,
  number,
  stamps,
}: {
  line: LogLine;
  number: number;
  stamps: boolean;
}) {
  const { kind, text: body } = annotate(line.text);

  return (
    <span className="flex gap-2">
      {/* The number, dim and never selected: a reader copying a log wants the
          lines, and a column of counters in the clipboard is not a log. */}
      <span aria-hidden className="w-8 shrink-0 select-none text-right text-muted-foreground/30">
        {number}
      </span>
      <span className="min-w-0 flex-1">
        {stamps && line.at && (
          // The time alone, not the whole stamp: the date belongs to the run,
          // which the header already says, and the seconds are what a reader
          // compares.
          <span className="mr-2 text-muted-foreground/40">{clock(line.at)}</span>
        )}
        <span
          className={cn(
            kind === "error" && "text-destructive",
            kind === "warning" && "text-accent-command",
            kind === "notice" && "text-accent-mention",
            (kind === "command" || kind === "debug") && "text-muted-foreground/50",
            kind === "section" && "font-medium text-foreground",
          )}
        >
          {body}
        </span>
      </span>
    </span>
  );
}

/// `HH:MM:SS` out of a stamp, and the stamp itself where it does not have one.
function clock(iso: string): string {
  return iso.slice(11, 19) || iso;
}

/// The verdict as a mark: a circle, filled or a ring, in the colour of what it
/// says. A shape before a colour, so the state survives the palettes where red
/// and green are closest.
function Verdict({ state, size = "sm" }: { state: RunState; size?: "sm" | "lg" }) {
  const tone = runTone(state);
  const Icon =
    state === "queued" || state === "running"
      ? CircleDashed
      : tone === "good"
        ? CircleCheck
        : tone === "bad"
          ? CircleX
          : CircleSlash;

  return (
    <Icon
      role="img"
      aria-label={RUN_LABEL[state]}
      strokeWidth={2}
      className={cn(
        "shrink-0",
        size === "lg" ? "mt-0.5 size-4" : "size-4",
        tone === "good" && "text-accent-add",
        tone === "bad" && "text-destructive",
        tone === "muted" && "text-muted-foreground/50",
        (state === "queued" || state === "running") &&
          "animate-spin text-accent-command [animation-duration:3s]",
      )}
    />
  );
}

function StatePill({ state }: { state: RunState }) {
  const tone = runTone(state);
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-px",
        tone === "good" && "border-accent-add/30 bg-accent-add/10 text-accent-add",
        tone === "bad" && "border-destructive/40 bg-destructive/10 text-destructive",
        tone === "muted" && "border-border text-muted-foreground",
      )}
    >
      {RUN_LABEL[state]}
    </span>
  );
}

function Dot() {
  return (
    <span className="shrink-0 text-muted-foreground/40" aria-hidden>
      ·
    </span>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">
      {children}
    </p>
  );
}

/// A job's own boxes, while the read is out — so the pane does not lay itself out
/// twice for one click.
function JobPlaceholders() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      {["w-24", "w-32"].map((name) => (
        <div key={name} className="flex items-center gap-2.5">
          <span className="size-4 shrink-0 animate-pulse rounded-full bg-muted-foreground/20" />
          <span className={cn("h-[1.3em] animate-pulse rounded bg-muted-foreground/20", name)} />
          <span className="ml-auto h-[1.3em] w-16 shrink-0 animate-pulse rounded bg-muted-foreground/10" />
        </div>
      ))}
    </div>
  );
}

/// The colour a state wears as text, in one place for the pane.
function toneText(state: RunState): string {
  const tone = runTone(state);
  if (tone === "bad") return "text-destructive";
  if (tone === "good") return "text-accent-add";
  return "text-muted-foreground";
}

/// How long something took, from two stamps — nothing where either is missing,
/// and nothing for a step that was skipped.
///
/// **`0s` is not nothing.** A skipped job carries a start *and* an end — the
/// capture is what settled that — so measuring it would print "0s" on every row
/// nobody ran, which reads as a measurement rather than as the absence of one.
function elapsed(from: string | null, to: string | null, state: RunState): string {
  if (state === "skipped" || !from || !to) return "";
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return "";
  return ms < 60_000 ? formatElapsed(ms) : formatDuration(ms);
}

/// The run's span, measured against the clock while it is still going.
function runDurationOf(run: WorkflowRun, now: number): number | null {
  const live = run.status !== "completed";
  const from = Date.parse(run.startedAt ?? run.createdAt);
  const to = live ? now : Date.parse(run.updatedAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, to - from);
}
