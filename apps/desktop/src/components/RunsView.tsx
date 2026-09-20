import { useMemo, useState, type ReactNode, type SyntheticEvent } from "react";

import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleDashed, ExternalLink, ListFilter, RefreshCw, Search, TriangleAlert } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { prUnavailableText } from "@/components/PrsView";
import { runKey, type useWorkflowRuns, type RunRow } from "@/hooks/useWorkflowRuns";
import { formatDuration, formatElapsed, relativeTime } from "@/lib/format";
import {
  ANY,
  applyRunFilters,
  branchOptions,
  DEFAULT_RUN_FILTERS,
  eventOptions,
  groupRuns,
  isLive,
  RUN_LABEL,
  runDuration,
  runFilterCount,
  runState,
  runTone,
  STATUS_LABEL,
  STATUS_OPTIONS,
  workflowOptions,
  type RunFilters,
} from "@/lib/runs";
import { cn } from "@/lib/utils";

/// The repository's CI, as the GitHub page's second sub-tab.
///
/// **Read-only, and that is the whole shape.** Cancelling a run, re-running a
/// failed one and dispatching a workflow are all pushes of a button GitHub will
/// act on, and every one of them is a decision with a side effect the reader
/// would want to make from their own browser — where the log is, and where the
/// re-run dialogue lives. What this answers is the question that brings somebody
/// to their own terminal: did what I just pushed pass.
///
/// **One `gh run list` per repository**, with the branch — the one thing CI
/// cannot be asked locally without losing the run somebody is waiting for —
/// narrowed at the host. Everything else the page offers is a filter over the
/// rows already in hand.
export default function RunsView({
  tabs,
  cwds,
  runs,
  branch,
  onBranch,
  picked,
  onPick,
}: {
  /// The inbox's source row and this page's own sub-tab row, in that order: both
  /// are drawn by whichever body is up, and this one draws them at the top of its
  /// own header.
  tabs: ReactNode;
  cwds: string[];
  /// The read, owned by the page rather than here — the counts on the sub-tab row
  /// come out of it, and that row is the page's.
  runs: ReturnType<typeof useWorkflowRuns>;
  /// Which branch the host is being asked about, or `null` for all of them.
  branch: string | null;
  onBranch: (branch: string | null) => void;
  /// The run whose detail the pane beside this is showing, held by `App` so the
  /// pane and the list cannot disagree about which one is picked.
  picked: RunRow | null;
  onPick: (run: RunRow) => void;
}) {
  const [filters, setFilters] = useState<RunFilters>(DEFAULT_RUN_FILTERS);


  const shown = useMemo(() => applyRunFilters(runs.runs, filters), [runs.runs, filters]);
  const groups = useMemo(() => groupRuns(shown), [shown]);

  // Read off the rows rather than asked for, the bargain the pull-requests page's
  // own filter menu makes: every option it offers is already on screen.
  const branches = useMemo(() => branchOptions(runs.runs), [runs.runs]);
  const workflows = useMemo(() => workflowOptions(runs.runs), [runs.runs]);
  const events = useMemo(() => eventOptions(runs.runs), [runs.runs]);

  // A read in flight with nothing to replace yet is the placeholders. Once rows
  // are up they stay while the next read lands: a swap to a spinner would blink
  // every fifteen seconds while a build runs, which is the one time this page is
  // being watched.
  const firstRead = runs.loading && runs.runs.length === 0 && !runs.error;

  // One clock for every row on screen, so two runs that ended together cannot
  // disagree about how long they took by the width of a render.
  const now = Date.now();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-border px-4 py-3">
        {tabs}

        <div className="flex items-center gap-2">
          <h2 className="text-ui font-medium">Actions</h2>
          <span className="min-w-0 truncate text-ui text-muted-foreground">
            {/* One repository is named; several are counted, because naming one
                of them would be a lie about what is on screen. */}
            {cwds.length === 1 ? (runs.runs[0]?.repo ?? basenameOf(cwds[0])) : `${cwds.length} repositories`}
          </span>
          {!firstRead && shown.length > 0 && (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-ui text-muted-foreground tabular-nums">
              {shown.length}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh runs"
            onClick={runs.refresh}
            disabled={runs.loading}
            className="ml-auto cursor-pointer text-muted-foreground"
          >
            <RefreshCw className={cn("size-3.5", runs.loading && "animate-spin")} />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex h-7 min-w-40 flex-1 items-center gap-1.5 rounded-md border border-border px-2 text-ui focus-within:border-accent">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={filters.query}
              // Matched here: a run list is one `gh` call and forty rows, so a
              // round trip per keystroke would be the host answering a question
              // this page can answer itself. `gh run list` has no `--search`
              // either, so there is nothing to delegate to.
              placeholder="Filter runs"
              spellCheck={false}
              aria-label="Filter runs"
              onChange={(e) => setFilters((prev) => ({ ...prev, query: e.currentTarget.value }))}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
          </label>

          <RunsFiltersMenu
            filters={filters}
            branches={branches}
            workflows={workflows}
            events={events}
            branch={branch}
            onChange={setFilters}
            onBranch={onBranch}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {runs.error && (
          <div className="mx-1 mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">{prUnavailableText(runs.error, cwds[0] ?? "")}</span>
          </div>
        )}

        {/* Some of the repositories could not be read. A sentence under the rows
            rather than over them: five of six is the ordinary case. */}
        {runs.failed && (
          <div className="mx-1 mb-2 flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-ui text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">
              {runs.failed.count} of {cwds.length} repositories could not be read — {runs.failed.detail}
            </span>
          </div>
        )}

        {firstRead && <RunPlaceholders />}

        {!firstRead && !runs.error && shown.length === 0 && (
          <div className="flex h-full flex-col">
            <p className="flex min-h-0 flex-1 items-center justify-center p-6 text-balance text-center text-ui text-muted-foreground">
              {runs.loading
                ? "Reading…"
                : runFilterCount(filters) > 0 || filters.query.trim() || branch
                  ? "Nothing matches that."
                  : "No runs yet."}
            </p>
          </div>
        )}

        {!firstRead && shown.length > 0 && (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-0.5">
                {/* A heading only where there is more than one run to tell apart:
                    "Finished" over every run in a repository says what the list
                    already says. */}
                {groups.length > 1 && (
                  <h3 className="flex items-center gap-1.5 px-3 pt-1 pb-0.5 text-ui text-muted-foreground">
                    <span className="font-medium text-foreground">{group.label}</span>
                    <span className="tabular-nums">{group.runs.length}</span>
                  </h3>
                )}
                {group.runs.map((run) => (
                  <Row
                    key={runKey(run)}
                    run={run}
                    now={now}
                    selected={!!picked && runKey(picked) === runKey(run)}
                    onSelect={() => onPick(run)}
                  />
                ))}
              </section>
            ))}
          </div>
        )}

        {/* The count for a screen reader, since the rows say it visually and the
            page has no other place to say how many there are. */}
        <span className="sr-only" role="status">
          {shown.length} runs
        </span>
      </div>
    </div>
  );
}

/// One run: which workflow, what it was for, and how it is doing.
///
/// **Two lines, and the split is the pull-requests row's own.** The verdict and
/// the workflow are what the reader is choosing between, so they hold the first
/// line; the branch it ran on, the trigger, the attempt and the number are
/// context for a run already chosen and drop to the second.
function Row({
  run,
  now,
  selected,
  onSelect,
}: {
  run: RunRow;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const state = runState(run);
  const tone = runTone(state);
  const took = runDuration(run, now);
  const open = (e: SyntheticEvent) => {
    e.stopPropagation();
    void openUrl(run.url);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      // ⌘-click leaves for GitHub, the same modifier the transcript's link
      // dialog and both sibling lists use to mean "out there, not here".
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          void openUrl(run.url);
          return;
        }
        onSelect();
      }}
      // A control inside the row answers its own keys, or Enter on it would also
      // pick the row underneath in one press.
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
      className={cn(
        "group grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg px-3 py-2 text-left text-ui transition-colors",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
        selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
      )}
    >
      <RunGlyph state={state} />

      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
        <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-muted-foreground">{run.workflow}</span>
          <Dot />
          <span className="min-w-0 truncate font-medium">{run.title}</span>
        </span>

        <span
          className={cn(
            "col-start-2 row-start-1 shrink-0 justify-self-end",
            tone === "bad" && "text-destructive",
            tone === "good" && "text-accent-add",
            tone === "muted" && "text-muted-foreground",
          )}
        >
          {RUN_LABEL[state]}
        </span>

        {/* Dot-separated, each segment giving way at the end rather than pushing
            the ones after it off: this is read down one column, and a meta line
            that wraps would break that. */}
        <span className="col-start-1 row-start-2 flex min-w-0 items-center gap-1.5 overflow-hidden text-muted-foreground">
          <span className="shrink-0 tabular-nums">#{run.number}</span>
          <Dot />
          <span className="min-w-0 max-w-40 truncate font-mono">{run.branch}</span>
          <Dot />
          <span className="min-w-0 truncate">{run.event}</span>
          {/* Attempts above the first only: "attempt 1" on every row is a column
              of the same words for the runs that never needed a second go. */}
          {run.attempt > 1 && (
            <>
              <Dot />
              <span className="shrink-0 text-accent-command">attempt {run.attempt}</span>
            </>
          )}
        </span>

        <span className="col-start-2 row-start-2 shrink-0 justify-self-end text-muted-foreground/70 tabular-nums">
          {/* **A tenth of a second under a minute for a finished run, and none
              for a live one**: `formatDuration` exists because 2.3s and 2.8s are
              different experiences, and a build being watched is redrawn on every
              poll, where a tenth would only ever be noise. */}
          {took === null
            ? relativeTime(run.createdAt)
            : isLive(run)
              ? formatElapsed(took)
              : formatDuration(took)}
        </span>
      </span>

      {/* Revealed by the row's own hover, and its box is reserved either way —
          so the meta line never shifts under the cursor that revealed it. A span
          carrying `buttonVariants` rather than a `Button`, for the nesting reason
          both sibling lists give. */}
      <span
        role="button"
        tabIndex={0}
        aria-label="Open on GitHub"
        onClick={open}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          open(e);
        }}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-xs" }),
          "pointer-events-none mt-0.5 text-muted-foreground/60 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 hover:text-muted-foreground focus-visible:pointer-events-auto focus-visible:opacity-100",
        )}
      >
        <ExternalLink className="size-3" />
      </span>
    </div>
  );
}

function Dot() {
  return (
    <span className="shrink-0 text-muted-foreground/40" aria-hidden>
      ·
    </span>
  );
}

/// What a run's state looks like, which is a shape before it is a colour.
///
/// **A run in flight spins the sidebar's own dashed arc** — the same glyph the
/// marks and the session's own checks use, at the same 3s turn — because
/// "something is going" is one fact and this app draws it one way. A finished
/// run is a filled circle, green or red, and a run nobody could reach a verdict
/// on is a hollow one.
export function RunGlyph({ state }: { state: ReturnType<typeof runState> }) {
  if (state === "queued" || state === "running") {
    return (
      <CircleDashed
        className={cn(
          "mt-0.5 size-4 shrink-0 animate-spin text-accent-command [animation-duration:3s]",
          state === "queued" && "opacity-50",
        )}
        strokeWidth={1.75}
        aria-label={RUN_LABEL[state]}
        role="img"
      />
    );
  }

  const tone = runTone(state);
  return (
    <span
      aria-label={RUN_LABEL[state]}
      role="img"
      className={cn(
        "mt-1 size-2.5 shrink-0 justify-self-center rounded-full",
        // A verdict is filled and a run nobody gave one for is a ring: "finished
        // without a word" and "passed" are different things at a glance.
        state === "cancelled" || state === "skipped"
          ? "border-2 border-muted-foreground/40"
          : tone === "good"
            ? "bg-accent-add"
            : tone === "bad"
              ? "bg-destructive"
              : "bg-muted-foreground/40",
      )}
    />
  );
}

/// The facets, behind one control.
///
/// **The branch is in here with the rest of them**, and it is the one that
/// reaches the host: `gh run list --branch` is server-side, and "what happened
/// on the branch I just pushed" is the question CI is opened with. The rows'
/// branches are what fills that list, so the menu offers what is on screen and
/// always keeps *All branches* at the top — a narrowing whose options vanish with
/// it is a corner the reader cannot come back from.
function RunsFiltersMenu({
  filters,
  branches,
  workflows,
  events,
  branch,
  onChange,
  onBranch,
}: {
  filters: RunFilters;
  branches: string[];
  workflows: string[];
  events: string[];
  branch: string | null;
  onChange: (filters: RunFilters) => void;
  onBranch: (branch: string | null) => void;
}) {
  const count = runFilterCount(filters) + (branch === null ? 0 : 1);
  const set = (patch: Partial<RunFilters>) => onChange({ ...filters, ...patch });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 cursor-pointer gap-1.5 text-ui">
          <ListFilter className="size-3.5 text-muted-foreground" />
          Filters
          {count > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <FacetMenu
          label="Branch"
          value={branch ?? ANY}
          options={[
            { value: ANY, label: "All branches" },
            ...branches.map((name) => ({ value: name, label: name })),
          ]}
          onChange={(next) => onBranch(next === ANY ? null : next)}
        />
        <FacetMenu
          label="State"
          value={filters.status}
          options={STATUS_OPTIONS.map((status) => ({ value: status, label: STATUS_LABEL[status] }))}
          onChange={(status) => set({ status: status as RunFilters["status"] })}
        />
        <FacetMenu
          label="Workflow"
          value={filters.workflow}
          options={[
            { value: ANY, label: "Any workflow" },
            ...workflows.map((name) => ({ value: name, label: name })),
          ]}
          onChange={(workflow) => set({ workflow })}
        />
        <FacetMenu
          label="Trigger"
          value={filters.event}
          options={[
            { value: ANY, label: "Any trigger" },
            ...events.map((name) => ({ value: name, label: name })),
          ]}
          onChange={(event) => set({ event })}
        />

        {count > 0 && (
          <>
            <DropdownMenuSeparator />
            {/* The search box is left as it is, for the reason the inbox's own
                menu gives: it is on the row above with the reader's words in it,
                and a menu entry that emptied a field it does not own reads as
                one that failed. */}
            <DropdownMenuItem
              onSelect={() => {
                onChange({ ...DEFAULT_RUN_FILTERS, query: filters.query });
                onBranch(null);
              }}
              className="cursor-pointer text-ui"
            >
              Clear filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FacetMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-ui">
        <span className="flex-1 truncate">{label}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {current.label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-52">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next !== value) onChange(next);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="cursor-pointer text-ui"
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/// A read with nothing behind it yet, in the row's own boxes — the bargain both
/// sibling lists make, so the rows land where the wait already took the space.
function RunPlaceholders() {
  // Ragged, so the block reads as a list of things rather than as a table.
  const titles = ["w-64", "w-48", "w-72", "w-40", "w-56"];
  return (
    <div aria-hidden className="flex flex-col gap-0.5">
      {titles.map((width) => (
        <div
          key={width}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg px-3 py-2 text-ui"
        >
          <span className="mt-0.5 size-4 shrink-0 animate-pulse rounded-full bg-muted-foreground/20" />
          <span className="flex flex-col gap-1">
            <span className={cn("h-[1.4em] animate-pulse rounded bg-muted-foreground/20", width)} />
            <span className="h-[1.3em] w-52 animate-pulse rounded bg-muted-foreground/10" />
          </span>
          <span className="mt-0.5 size-6 shrink-0 animate-pulse rounded-md bg-muted-foreground/10" />
        </div>
      ))}
    </div>
  );
}

const basenameOf = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;
