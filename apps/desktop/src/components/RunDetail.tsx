import { useCallback, useMemo, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Clock, ExternalLink, GitBranch, GitCommitVertical, Hash, RotateCcw, Zap } from "lucide-react";

import { RunGlyph } from "@/components/RunsView";
import { Button, buttonVariants } from "@/components/ui/button";
import Spinner from "@/components/ui/spinner";
import { asUnavailable, describe } from "@/hooks/usePrList";
import { useWorkflowRun } from "@/hooks/useWorkflowRun";
import type { RunRow } from "@/hooks/useWorkflowRuns";
import { formatDuration, formatElapsed } from "@/lib/format";
import { RUN_LABEL, runState, runTone, stepLabel, waterfall, type RunState } from "@/lib/runs";
import { cn } from "@/lib/utils";
import type { WorkflowJob, WorkflowRun, WorkflowStep } from "@/types/events";

/// One workflow run, opened: what it was, where it went, and a way to ask again.
///
/// **The pane, not a modal.** Which step failed is read against the list it came
/// from — the run above it, the branch below it — and a dialog would take both
/// off the screen for a question answered by looking at them.
///
/// **The page's one write, and it is a re-run.** CI is where a retry is the whole
/// answer: a flake, a runner that died, a dependency that was briefly gone.
/// Nothing is confirmed — a re-run starts work rather than destroying it, and the
/// reader pressed the only button here that says so.
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

  /// Whether there is anything to retry, which decides both the verb on the
  /// button and the flag behind it.
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
        <section className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
          <div className="flex items-start gap-2.5">
            <RunGlyph state={state} />
            <div className="flex min-w-0 flex-1 flex-col">
              {/* The subject it ran for leads and the workflow sits under it: the
                  title is what the reader chose to run, the workflow is the
                  standing fact about it. */}
              <p className="min-w-0 truncate font-medium">{shown.title}</p>
              <p className="min-w-0 truncate text-ui text-muted-foreground">{shown.workflow}</p>
            </div>
            {(busy || detail.live) && <Spinner className="mt-0.5 size-3.5 text-accent-command" />}
          </div>

          {/* **The facts a reader checks rather than reads** — which branch,
              which commit, when — as chips with a mark each. A labelled column
              spends a third of a 320px pane on labels an icon says in twelve
              pixels, and then truncates the values it kept the room for. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip icon={<Hash className="size-3" />} says={`Run ${shown.number}`}>
              #{shown.number}
              {shown.attempt > 1 && (
                <span className="text-accent-command"> · attempt {shown.attempt}</span>
              )}
            </Chip>
            <Chip icon={<GitBranch className="size-3" />} says="Branch">
              <span className="font-mono">{shown.branch}</span>
            </Chip>
            <Chip icon={<GitCommitVertical className="size-3" />} says="Commit">
              <span className="font-mono">{shown.sha.slice(0, 7)}</span>
            </Chip>
            <Chip icon={<Zap className="size-3" />} says="Triggered by">
              {shown.event}
            </Chip>
            {took !== null && (
              <Chip
                icon={<Clock className="size-3" />}
                says={`Started ${clockOf(shown.startedAt ?? shown.createdAt)}, last moved ${clockOf(shown.updatedAt)}`}
              >
                {detail.live ? `${formatElapsed(took)} so far` : formatDuration(took)}
              </Chip>
            )}
          </div>

          {/* The one line that says how the run as a whole went: the verdict, and
              the numbers a reader takes away from it. */}
          <div className="flex flex-wrap items-center gap-2">
            <StateChip state={state} />
            {jobs.length > 0 && (
              <span className="text-ui text-muted-foreground">
                {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
                {failedJobs > 0 && <span className="text-destructive"> · {failedJobs} failed</span>}
              </span>
            )}
          </div>

          {detail.error && <Note>{detail.error}</Note>}
          {actionError && <Note>{actionError}</Note>}

          {/* **One button, and its verb is what it will do.** A run with
              something red gets its failed jobs — which is what a reader who
              watched a job go red is asking for, and re-running the rest spends
              their minutes on an answer they already have. A run with nothing
              red gets the whole workflow, which is the flake case. */}
          <div className="flex items-center gap-1.5">
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
                "ml-auto cursor-pointer text-muted-foreground/70 hover:text-muted-foreground",
              )}
            >
              <ExternalLink className="size-3.5" />
            </span>
          </div>
        </section>

        {/* The jobs, which is the whole reason this pane exists: the row says a
            run failed, and this says where. */}
        {jobs.map((job) => (
          <Job key={job.id} job={job} />
        ))}

        {!detail.detail && detail.loading && <JobPlaceholders />}
      </div>
    </div>
  );
}

/// One job, with the shape of its steps drawn above them.
///
/// **A card, because two jobs are two answers.** On GitHub's own page they are
/// separated by whitespace; a frame here says where one ends — which matters most
/// for the job that was *skipped*, whose whole answer is that it has no steps.
function Job({ job }: { job: WorkflowJob }) {
  const state = runState(job);
  const bar = useMemo(() => waterfall(job), [job]);
  const ran = elapsed(job.startedAt, job.completedAt, state);

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <RunGlyph state={state} />
        <span className="min-w-0 truncate font-medium">{job.name}</span>
        <span className="shrink-0 text-ui text-muted-foreground">
          {job.steps.length > 0 ? `${job.steps.length} steps` : "no steps"}
        </span>
        <span className="ml-auto shrink-0">
          <StateChip state={state} />
        </span>
        <span className="w-14 shrink-0 text-right text-ui text-muted-foreground/70 tabular-nums">
          {ran}
        </span>
      </div>

      {/* **The waterfall, and it is a proportion of the job.** Each segment is a
          step at its own offset, so a gap between two of them is drawn as the gap
          it is rather than as slack — and a step that ran long is wide, which is
          the one thing a column of durations makes the reader do arithmetic for. */}
      {bar && (
        // **Absolute, not a flex row of widths.** A `margin-left` in a flex row
        // adds to where the item before it *ended*, so an offset per segment
        // compounds — four steps pushed the fifth past the end of the bar and
        // every one of them shrank to nothing. Position is a coordinate here,
        // which is the one thing a waterfall is.
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-well">
          {bar.map((segment) => (
            <span
              key={segment.number}
              title={`${stepLabel(segment.label)}${share(segment.width, job)}`}
              style={{
                left: `${segment.offset * 100}%`,
                width: `${segment.width * 100}%`,
              }}
              className={cn("absolute inset-y-0", segmentTone(segment.state))}
            />
          ))}
        </div>
      )}

      {job.steps.length > 0 && (
        <ol className="flex flex-col border-l border-border pl-3">
          {job.steps.map((step) => (
            <StepRow key={step.number} step={step} />
          ))}
        </ol>
      )}
    </section>
  );
}

/// One step: its number, its name, and how long it took.
///
/// **Every step is drawn, not only the failed one.** The steps around a failure
/// are what say whether it was the change or the runner — a setup that took
/// forty minutes, a step the workflow skipped — and a list holding only the red
/// one hides the evidence the reader came for. A step nobody ran is muted rather
/// than marked: it says nothing happened, which is the absence of a verdict.
function StepRow({ step }: { step: WorkflowStep }) {
  const state = runState(step);
  const ran = elapsed(step.startedAt, step.completedAt, state);

  return (
    <li className="flex items-center gap-2 py-px text-ui">
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

/// A chip: a mark, a value, and a sentence for anyone not reading the mark.
function Chip({
  icon,
  says,
  children,
}: {
  icon: React.ReactNode;
  /// What the mark means for a reader who cannot see it. The value is already on
  /// the chip; this is the word the icon stands for.
  says: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={says}
      className="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-ui"
    >
      <span className="shrink-0 text-muted-foreground/60" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 truncate text-foreground">{children}</span>
    </span>
  );
}

/// The verdict as a word in a pill — the one coloured thing on the run, so the
/// eye finds it before it reads anything under it.
function StateChip({ state }: { state: RunState }) {
  const tone = runTone(state);
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-px text-ui",
        tone === "good" && "border-accent-add/30 bg-accent-add/10 text-accent-add",
        tone === "bad" && "border-destructive/40 bg-destructive/10 text-destructive",
        tone === "muted" && "border-border text-muted-foreground",
      )}
    >
      {RUN_LABEL[state]}
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

/// A job card's own boxes, while the read is out — so the pane does not lay
/// itself out twice for one click.
function JobPlaceholders() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      {["w-24", "w-32"].map((name) => (
        <div key={name} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="size-4 shrink-0 animate-pulse rounded-full bg-muted-foreground/20" />
            <span className={cn("h-[1.3em] animate-pulse rounded bg-muted-foreground/20", name)} />
            <span className="ml-auto h-[1.3em] w-16 shrink-0 animate-pulse rounded-full bg-muted-foreground/10" />
          </div>
          <span className="h-1.5 w-full animate-pulse rounded-full bg-muted-foreground/10" />
          <span className="h-[1.2em] w-2/3 animate-pulse rounded bg-muted-foreground/10" />
          <span className="h-[1.2em] w-1/2 animate-pulse rounded bg-muted-foreground/10" />
        </div>
      ))}
    </div>
  );
}

/// The colour one segment of a waterfall wears.
///
/// **Passing is drawn under the failures rather than beside them in weight.** A
/// fourteen-step job is mostly green, and a green at full strength would drown
/// the one red segment the reader opened the pane for.
function segmentTone(state: RunState): string {
  const tone = runTone(state);
  if (tone === "bad") return "bg-destructive";
  if (tone === "good") return "bg-accent-add/60";
  return "bg-muted-foreground/30";
}

/// What a segment is, and how much of the job it took.
function share(width: number, job: WorkflowJob): string {
  const percent = Math.round(width * 100);
  const total = durationOf(job);
  if (total === null) return ` — ${percent}%`;
  return ` — ${formatElapsed(width * total)} (${percent}% of the job)`;
}

/// A clock time, or a dash where the host gave no stamp.
function clockOf(iso: string | null): string {
  if (!iso) return "—";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : at.toLocaleTimeString();
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

/// A job's own span, from its two stamps.
function durationOf(job: WorkflowJob): number | null {
  if (!job.startedAt || !job.completedAt) return null;
  const ms = Date.parse(job.completedAt) - Date.parse(job.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/// The run's span, measured against the clock while it is still going.
function runDurationOf(run: WorkflowRun, now: number): number | null {
  const live = run.status !== "completed";
  const from = Date.parse(run.startedAt ?? run.createdAt);
  const to = live ? now : Date.parse(run.updatedAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, to - from);
}
