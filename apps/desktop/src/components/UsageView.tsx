import { invoke } from "@tauri-apps/api/core";
import { Activity, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { MetaLine } from "@/components/MetaLine";
import ModelMark from "@/components/ModelMark";
import { TabButton, TabRow } from "@/components/TabRow";
import { Button } from "@/components/ui/button";
import { providerInRef } from "@/lib/model";
import { modelDisplayName } from "@/lib/modelBrand";
import { knownProviderNames, providerLabel, subscribeProviderNames } from "@/lib/providerNames";
import { cn } from "@/lib/utils";
import type { UsageRecord } from "@/types/events";

/// What the agent has spent, over three windows.
///
/// **A page in the main column, in the frame every other page wears** — a header
/// over a rule, the body scrolling under it. It used to scroll as one box, header
/// and all, which is the one thing this page cannot do: the control saying which
/// window is being read is the first thing that went off the top.
///
/// **The one page in the app that lays out in more than one column**, and the grid
/// asks a container rather than the window: what this column's width follows is
/// the sidebar (which collapses to nothing) and the window, never a viewport
/// breakpoint that would fire on a column 400px wide. Two tracks at 56rem of
/// container, so the four sections sit in one column until a second one can hold a
/// chart and a list without either being squeezed.
///
/// **The sections are frameless**, so the space between them is what says where
/// one ends — the bargain the pull-requests panel's own sections make. What each
/// one draws is the app's own list: a heading at `px-3`, then rows carrying their
/// own padding, marks and right-aligned figures, so a figure starts at the same x
/// as the figure above it.
///
/// **The records are the agent's own accounting**, read back out of each session's
/// log by the backend — not a counter this app keeps. Two consequences show on
/// screen: a row the runtime named no model for names none rather than guessing,
/// and deleting a session takes its rows with it.
///
/// **Two narrowings, and they answer different questions.** The period is which
/// window of time; the gateway is which of them served it — and the second is the
/// one a reader with a key on `command-code` and another on `opencode-go` cannot
/// answer from a model name alone. So the gateway is a heading over its models, a
/// chip in the header that narrows the whole page, and a fact on every row of the
/// stream, which has no headings to carry it.
type Period = "day" | "week" | "month";
type Metric = "input" | "output" | "reasoning" | "cacheRead" | "cacheWrite";
type Totals = Record<Metric, number> & { total: number; cost: number };
/// One model's period, as the models list draws it.
type ModelGroup = Totals & { model: string; provider: string; count: number };

const PERIODS: Period[] = ["day", "week", "month"];
const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 };
const PERIOD_LABEL: Record<Period, string> = { day: "today", week: "this week", month: "this month" };
const PERIOD_WORD: Record<Period, string> = { day: "Day", week: "Week", month: "Month" };

/// How much of the stream the recent list draws. A month of records is a log, and
/// a log read from the top of a page is not a list anybody finishes.
const RECENT_ROWS = 12;

/// The four series, in the order the bar and the chart stack them.
///
/// **The app's own accents rather than four literals.** Every palette in
/// `App.css` — including the ported ones — defines all four, so a chart cannot
/// come up blank on a theme somebody added later, which is exactly what a hex
/// value here would do.
const SERIES = [
  { label: "Input", color: "var(--accent-command)" },
  { label: "Output", color: "var(--accent-mention)" },
  { label: "Reasoning", color: "var(--accent-thinking)" },
  { label: "Cache", color: "var(--accent-add)" },
] as const;

/// The row shape both lists wear: a mark, the name and its facts, then the
/// figures. A grid rather than a flex, because a list is read *down* a column —
/// which is the whole reason the figures line up under each other instead of
/// trailing the length of whatever name sits beside them.
const ROW = "grid grid-cols-[1rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-1.5 text-ui";

const EMPTY_TOTALS: Totals = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  cost: 0,
};

function recordTime(row: UsageRecord): number {
  const ts = row.ts ?? 0;
  return ts > 0 && ts < 10_000_000_000 ? ts * 1000 : ts;
}

function periodStart(period: Period): number {
  const now = new Date();
  if (period === "day") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (period === "week") {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset).getTime();
  }
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function recordKey(row: UsageRecord): string {
  if (row.id !== null) return `${row.sessionId}:id:${row.id}`;
  return [row.sessionId, row.turnId, row.ts, row.model, row.agentName, row.frameworkType]
    .map((value) => value ?? "")
    .join("|");
}

/// Cumulative rows are re-reported as the runtime goes, so one record reaches the
/// desktop many times. Newest wins, keyed on the runtime's own row id.
function deduplicate(rows: UsageRecord[]): UsageRecord[] {
  const seen = new Map<string, UsageRecord>();
  for (const row of [...rows].sort((a, b) => recordTime(a) - recordTime(b))) seen.set(recordKey(row), row);
  return [...seen.values()].sort((a, b) => recordTime(b) - recordTime(a));
}

function addRow(totals: Totals, row: UsageRecord) {
  totals.input += row.inputTokens ?? 0;
  totals.output += row.outputTokens ?? 0;
  totals.reasoning += row.reasoningTokens ?? 0;
  totals.cacheRead += row.cacheReadTokens ?? 0;
  totals.cacheWrite += row.cacheWriteTokens ?? 0;
  totals.cost += row.costUsd ?? 0;
  totals.total += rowTokens(row);
}

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const CLOCK_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const STAMP_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/// A row's own stamp: the clock while it is today, the date once it is not.
function rowStamp(value: number) {
  if (!value) return "—";
  const date = new Date(value);
  const now = new Date();
  const today =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return (today ? CLOCK_FORMAT : STAMP_FORMAT).format(date);
}

function compact(value: number) {
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function money(value: number) {
  return `$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`;
}

/// The app's own spelling for a model — the vendor's casing, the publisher's
/// prefix off — with a row that names none reading as such. An old row can
/// arrive with no model at all: the backend fills one in from the session index,
/// and a session deleted since has no entry to fill it from.
function modelName(row: UsageRecord) {
  return row.model ? modelDisplayName(row.model) : "Unknown model";
}

/// The gateway a record came from.
///
/// **The model's own ref is the answer where it names one.**
/// `m:custom_provider%3Aopencode-go:glm-5.3:v:thinking` says who serves the model,
/// and it is the same fact the picker draws its provider headings from. The
/// fallbacks are a *different* fact: `agentName` names the runtime that reported
/// the usage (`hyze-cloud`) and `frameworkType` its framework (`pi-agent`), so a
/// reader with a key on `command-code` and another on `opencode-go` would see
/// every row grouped under a name that is neither gateway — which is exactly the
/// question this dimension exists to answer.
function providerOf(row: UsageRecord) {
  return (row.model && providerInRef(row.model)) || row.agentName || row.frameworkType || "Unknown provider";
}

function rowTokens(row: UsageRecord) {
  return (
    (row.inputTokens ?? 0) +
    (row.outputTokens ?? 0) +
    (row.reasoningTokens ?? 0) +
    (row.cacheReadTokens ?? 0) +
    (row.cacheWriteTokens ?? 0)
  );
}

/// A heading over a list, with the count or the legend that belongs on the same
/// line. No frame around what follows it — see the module note.
function Section({
  title,
  detail,
  aside,
  children,
}: {
  title: string;
  detail?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1 pt-5">
      <h3 className="flex items-baseline gap-2 px-3 text-ui">
        <span className="font-medium text-sidebar-foreground">{title}</span>
        {detail && <span className="min-w-0 truncate text-muted-foreground">{detail}</span>}
        {aside && <span className="ml-auto flex shrink-0 items-center gap-3">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}

/// The empty answer for a whole page: a glyph above one centred sentence, the
/// shape the plugins page fills its own box with.
function Filler({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="flex max-w-72 flex-col items-center gap-2.5 text-center">
          <Activity className="size-6 text-muted-foreground/40" strokeWidth={1.5} />
          <p className="text-balance text-ui text-muted-foreground">{children}</p>
        </div>
      </div>
    </div>
  );
}

/// The one failure surface, in the frame the plugins page and the pull-requests
/// page draw theirs in.
function Problem({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return (
    <div className="mx-1 mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <p>{detail}</p>
        <Button variant="outline" size="sm" className="mt-2 cursor-pointer" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/// The period's total, its split as one bar, and the five parts under it.
///
/// **The total leads and everything else is a step down**, which is the one thing
/// the seven equal tiles this replaced got wrong: every figure had the same
/// weight, so the page read as a wall of numbers with the number it is *for* lost
/// among them.
///
/// No count in the heading: the tab row above already says how many records are
/// behind the window that is open, and the same number twice on one screen is a
/// number the reader has to check against itself.
function TotalsSection({ totals, period }: { totals: Totals; period: Period }) {
  // The share is computed once and carried, rather than recomputed at each of the
  // two places that need it: a zero period would otherwise divide by nothing, and
  // a `NaN` in a `width` is a bar that silently disappears.
  const parts = [
    { ...SERIES[0], value: totals.input },
    { ...SERIES[1], value: totals.output },
    { ...SERIES[2], value: totals.reasoning },
    // Read and write are one series here and in the chart: a reader scanning for
    // "how much of this was cache" wants one run, not two stacked on each other.
    { ...SERIES[3], value: totals.cacheRead + totals.cacheWrite },
  ].map((part) => ({ ...part, percent: totals.total > 0 ? (part.value / totals.total) * 100 : 0 }));
  const details = [
    { label: "Input", value: totals.input },
    { label: "Output", value: totals.output },
    { label: "Reasoning", value: totals.reasoning },
    { label: "Cache read", value: totals.cacheRead },
    { label: "Cache write", value: totals.cacheWrite },
  ];

  return (
    <Section title="Totals" detail={PERIOD_LABEL[period]}>
      <div className="flex flex-col gap-2 px-3">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-lg font-medium tabular-nums text-sidebar-foreground">{compact(totals.total)}</span>
          <span className="text-ui text-muted-foreground">tokens</span>
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <span className="text-lg font-medium tabular-nums text-sidebar-foreground">{money(totals.cost)}</span>
        </div>

        {/* The split as one bar, so the shape of the period is read before the
            five figures under it are: cache is most of a real session's tokens,
            and a strip of numbers alone leaves that to be worked out. The track
            is a share of the foreground rather than `--surface-well` — a black
            scrim is invisible at 4px on a dark page, which is the trap the
            transcription bars already documented. Labelled for a screen reader,
            since the proportion lives in the widths. */}
        <div
          className="flex h-1 overflow-hidden rounded-full bg-foreground/20"
          role="img"
          aria-label={parts.map((part) => `${part.label} ${Math.round(part.percent)}%`).join(", ")}
        >
          {parts.map((part) =>
            part.value > 0 ? (
              <span key={part.label} style={{ width: `${part.percent}%`, background: part.color }} />
            ) : null,
          )}
        </div>

        {/* A `dl`, so a value starts at the same x on every row and the eye can
            run down it — the shape the model list's own facts take. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[0.7rem] sm:grid-cols-5">
          {details.map((detail) => (
            <div key={detail.label} className="min-w-0">
              <dt className="truncate text-muted-foreground/60">{detail.label}</dt>
              <dd className="tabular-nums text-muted-foreground">{compact(detail.value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

/// A day per bar, stacked by series, with the peak as the scale.
///
/// **Calendar days, not a rolling window.** The period filter counts from local
/// midnight, so a chart bucketing by "now minus n × 24h" would draw bars the
/// total beside it does not agree with. The dates are built through `setDate`,
/// which is what keeps the labels right across a DST boundary — subtracting
/// 86_400_000 ms from a local midnight lands an hour off it, on the day before.
function ChartSection({ rows, period }: { rows: UsageRecord[]; period: Period }) {
  const days = PERIOD_DAYS[period];
  const today = new Date();
  const dates = Array.from(
    { length: days },
    (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - index)),
  );
  const keyOf = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

  // No `useMemo`: the only key that would matter is the day, and a fresh `Date`
  // makes that a new number every render, so the memo never hit once. This is one
  // pass over rows the caller already walked.
  const buckets = new Map(dates.map((date) => [keyOf(date), { ...EMPTY_TOTALS }]));
  for (const row of rows) {
    const ts = recordTime(row);
    if (!ts) continue;
    const bucket = buckets.get(keyOf(new Date(ts)));
    if (bucket) addRow(bucket, row);
  }
  const values = dates.map((date) => ({ date, totals: buckets.get(keyOf(date)) ?? EMPTY_TOTALS }));
  const max = Math.max(1, ...values.map((value) => value.totals.total));

  // The drawing is one SVG unit per pixel of the plot box, so the bars fill the
  // box at any width and the labels never stretch with it. `width` used to be the
  // constant 720, which letterboxed the chart on a wide window and pushed the last
  // days off the right edge of a narrow one. A callback ref, not an effect: the
  // box only exists once there are rows to draw.
  const [width, setWidth] = useState(720);
  const observePlot = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const height = 220;
  const baseline = 185;
  const plot = 155;
  // A bar takes a share of its slot rather than a fixed width: this section is
  // anything from a 400px pane to a 700px track, and a bar pinned at 28px is a
  // pin in an empty field at one end and a slab at the other.
  const barWidth = Math.max(3, Math.min(72, (width / days) * 0.62));
  // A day label wants about 56px of slot to itself. Narrower than that the week
  // falls back to its two ends rather than running seven labels into each other.
  const everyDay = days <= 7 && width / days >= 56;

  return (
    <Section
      title="Token activity"
      aside={SERIES.map((series) => (
        <span key={series.label} className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
          <i className="size-2 rounded-sm" style={{ background: series.color }} />
          {series.label.toLowerCase()}
        </span>
      ))}
    >
      <div ref={observePlot} className="px-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ height }}
          className="w-full"
          role="img"
          aria-label={`Tokens per day, ${PERIOD_LABEL[period]}`}
        >
          <line x1="0" x2={width} y1={baseline} y2={baseline} stroke="var(--border)" />
          {/* What a bar is worth, since nothing else on the section says it. The
              tallest bar's top is the plot's own ceiling, so the label sits in
              the margin above every bar rather than over one. */}
          {max > 1 && (
            <>
              <line
                x1="0"
                x2={width}
                y1={baseline - plot}
                y2={baseline - plot}
                stroke="var(--border)"
                strokeDasharray="2 3"
              />
              <text x={width} y={baseline - plot - 6} textAnchor="end" fill="var(--muted-foreground)" fontSize="10">
                {`peak ${compact(max)}`}
              </text>
            </>
          )}
          {values.map(({ date, totals }, index) => {
            const x = (index + 0.5) * (width / days) - barWidth / 2;
            const stack = [totals.input, totals.output, totals.reasoning, totals.cacheRead + totals.cacheWrite];
            let y = baseline;
            return (
              <g key={keyOf(date)}>
                {/* The number behind the shape, on the bar itself: there is no
                    per-day table, and a reader asking "what was Tuesday" is
                    pointing at the answer. */}
                <title>{`${DAY_FORMAT.format(date)} · ${compact(totals.total)} tokens`}</title>
                {stack.map((value, stackIndex) => {
                  const barHeight = Math.max(0, (value / max) * plot);
                  y -= barHeight;
                  return value > 0 ? (
                    <rect
                      key={SERIES[stackIndex].label}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      fill={SERIES[stackIndex].color}
                      rx="2"
                    />
                  ) : null;
                })}
                {/* Every day where there is room for every day, and a handful of
                    ticks past that: a chart whose only marks are its two ends says
                    nothing about the days between them. A month is the other way
                    round — thirty labels do not fit at any width. */}
                {everyDay || index === 0 || index === days - 1 || (days > 14 && index % Math.ceil(days / 6) === 0) ? (
                  // The two end ticks are anchored to the inside: a middle-anchored
                  // label under the last bar runs off the right edge of the plot,
                  // which is how a month came to read `23 de s`.
                  <text
                    x={x + barWidth / 2}
                    y="207"
                    textAnchor={index === 0 ? "start" : index === days - 1 ? "end" : "middle"}
                    fill="var(--muted-foreground)"
                    fontSize="10"
                  >
                    {DAY_FORMAT.format(date)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </Section>
  );
}

/// What each model cost over the period, grouped under the gateway that served it.
///
/// **The gateway is the heading, not a word on every row** — and the heading is
/// drawn **even where there is only one gateway**, against the model picker's own
/// rule. The picker may hide a heading naming what nothing disputes because the
/// model's row there is already under its provider's card; here a model name says
/// nothing about the route it came by, so with the heading gone the gateway is not
/// said anywhere at all. That is the whole question this section answers.
///
/// **Two lines a row, because a model carries two kinds of fact.** The name is
/// what the reader is looking for; how many records and what share of the period
/// are what they read once they have found it. The figures stay on the right, in
/// columns, so the list can be compared down its edge rather than read row by row.
function ModelsSection({
  groups,
  names,
  total,
}: {
  groups: { id: string; models: ModelGroup[] }[];
  names: Record<string, string>;
  total: number;
}) {
  const count = groups.reduce((sum, group) => sum + group.models.length, 0);

  return (
    <Section title="Models & providers" detail={count > 0 ? `${count} in use` : undefined}>
      {groups.length === 0 ? (
        <p className="px-3 py-1 text-ui text-muted-foreground">No models recorded in this window.</p>
      ) : (
        groups.map((group) => (
          <div key={group.id}>
            <h4 className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5 text-ui">
              <span className="min-w-0 truncate font-medium text-sidebar-foreground">
                {providerLabel(group.id, names)}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{group.models.length}</span>
            </h4>
            {group.models.map((model) => (
              <div key={model.model} className={ROW}>
                <ModelMark name={model.model} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="min-w-0 truncate">{model.model}</span>
                  <MetaLine className="overflow-hidden text-[0.7rem] text-muted-foreground/70">
                    <span className="shrink-0 tabular-nums">
                      {model.count} {model.count === 1 ? "record" : "records"}
                    </span>
                    <span className="shrink-0 tabular-nums">{Math.round((model.total / Math.max(1, total)) * 100)}%</span>
                  </MetaLine>
                </span>
                <span className="text-right tabular-nums">{compact(model.total)}</span>
                <span className="text-right tabular-nums text-muted-foreground">{money(model.cost)}</span>
              </div>
            ))}
          </div>
        ))
      )}
    </Section>
  );
}

/// The newest records, one line each.
///
/// **A line, not the two the aggregate above wears.** This is a stream rather than
/// a ranking — nothing here is compared with anything, so the gateway and the
/// session sit on the same line as the name and only the two figures that move
/// keep the right edge.
function RecentSection({
  rows,
  total,
  names,
  narrowed,
}: {
  rows: UsageRecord[];
  total: number;
  names: Record<string, string>;
  /// Whether the page is already narrowed to one gateway: a chip at the top has
  /// named it, and a stream is the wrong place to say the same word twelve times.
  narrowed: boolean;
}) {
  return (
    <Section
      title="Recent activity"
      // The count only where the list is shorter than the window: the period's own
      // figure is on the tab that opened it, and what the reader cannot see here
      // is what the cap left out.
      detail={total > rows.length ? `${rows.length} of ${total}` : undefined}
    >
      {rows.length === 0 ? (
        <p className="px-3 py-1 text-ui text-muted-foreground">Nothing recorded in this window.</p>
      ) : (
        rows.map((row) => (
          <div key={recordKey(row)} className={ROW}>
            <ModelMark name={row.model ?? ""} />
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 truncate">{modelName(row)}</span>
              <MetaLine className="min-w-0 overflow-hidden text-[0.7rem] text-muted-foreground/70">
                {!narrowed && (
                  <span className="min-w-0 truncate">{providerLabel(providerOf(row), names)}</span>
                )}
                {/* Session ids are uuids; eight characters name one without
                    spending the row on the rest of it. */}
                {row.sessionId && <span className="shrink-0 font-mono">{row.sessionId.slice(0, 8)}</span>}
                {/* Only where there is one: a row on a BYOK gateway reports
                    zero, and a column of `$0.00` says nothing six times. */}
                {row.costUsd ? <span className="shrink-0 tabular-nums">{money(row.costUsd)}</span> : null}
              </MetaLine>
            </span>
            <span className="text-right tabular-nums">{compact(rowTokens(row))}</span>
            <span className="text-right tabular-nums text-muted-foreground">{rowStamp(recordTime(row))}</span>
          </div>
        ))
      )}
    </Section>
  );
}

/// The first read draws the page's own boxes, so the wait already occupies the
/// space the numbers will: a centred "Loading…" over an empty pane reads as the
/// page having failed to draw. Ragged, so the block reads as a list of things
/// rather than as a table.
function UsageSkeleton() {
  return (
    <div aria-hidden className="grid items-start gap-x-10 @min-[56rem]:grid-cols-2">
      <div className="flex min-w-0 flex-col">
        {/* Totals: the heading, the headline, the split bar and the five parts. */}
        <div className="flex flex-col gap-1 pt-5">
          <span className="mx-3 h-[1.4em] w-20 animate-pulse rounded bg-muted-foreground/20" />
          <div className="flex flex-col gap-2 px-3 pt-1">
            <span className="h-[1.7em] w-40 animate-pulse rounded bg-muted-foreground/20" />
            <span className="h-1 animate-pulse rounded-full bg-muted-foreground/10" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
              {[0, 1, 2, 3, 4].map((cell) => (
                <span key={cell} className="h-7 animate-pulse rounded bg-muted-foreground/10" />
              ))}
            </div>
          </div>
        </div>

        {/* The plot's own shape rather than a filled box: what lands there is a row
            of ragged bars, and a slab the height of the chart reads as a picture
            that failed to load. */}
        <div className="flex flex-col gap-1 pt-5">
          <span className="mx-3 h-[1.4em] w-28 animate-pulse rounded bg-muted-foreground/20" />
          <div className="flex items-end justify-between px-3 pt-1">
            {["h-16", "h-40", "h-24", "h-32", "h-20", "h-44", "h-28"].map((bar) => (
              <span key={bar} className={cn("w-6 animate-pulse rounded-sm bg-muted-foreground/10", bar)} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 pt-5">
          <span className="mx-3 h-[1.4em] w-32 animate-pulse rounded bg-muted-foreground/20" />
          <div className="flex flex-col gap-0.5 pt-1">
            {/* A group heading and its rows, which is what the section draws
                wherever more than one gateway is behind the window. */}
            <span className="mx-3 mt-1 h-[1.4em] w-24 animate-pulse rounded bg-muted-foreground/10" />
            {["w-44", "w-28"].map((row) => (
              <span key={row} className={ROW}>
                <span className="size-4 animate-pulse rounded bg-muted-foreground/20" />
                <span className={cn("h-[1.4em] animate-pulse rounded bg-muted-foreground/10", row)} />
                <span className="h-[1.4em] w-8 animate-pulse rounded bg-muted-foreground/10" />
                <span className="h-[1.4em] w-10 animate-pulse rounded bg-muted-foreground/10" />
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="flex flex-col gap-1 pt-5">
          <span className="mx-3 h-[1.4em] w-40 animate-pulse rounded bg-muted-foreground/20" />
          <div className="flex flex-col gap-0.5 pt-1">
            {["w-36", "w-44", "w-24", "w-32", "w-28", "w-40"].map((row) => (
              <span key={row} className={ROW}>
                <span className="size-4 animate-pulse rounded bg-muted-foreground/20" />
                <span className={cn("h-[1.4em] animate-pulse rounded bg-muted-foreground/10", row)} />
                <span className="h-[1.4em] w-8 animate-pulse rounded bg-muted-foreground/10" />
                <span className="h-[1.4em] w-10 animate-pulse rounded bg-muted-foreground/10" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UsageView({ active, onClose }: { active: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState<Period>("week");
  const [rows, setRows] = useState<UsageRecord[]>([]);
  /// The gateway the page is narrowed to, or `null` for all of them. Kept as the
  /// id rather than the label: the label is the app's to spell, and a provider the
  /// agent has since renamed would stop matching its own rows.
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The names `provider list` has answered so far. A subscription rather than a
  // read: settings fills this cache one screen away, and a heading that stayed on
  // the id until the page happened to re-render would be the picker's own bug.
  const names = useSyncExternalStore(subscribeProviderNames, knownProviderNames);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const result = await invoke<UsageRecord[]>("usage_records");
      setRows(deduplicate(Array.isArray(result) ? result : []));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Usage records could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    void refresh();
  }, [active, refresh]);

  /// **One windowing pass per period, not a filter per caller.** The tabs count
  /// what is behind each window and the body reads the one that is open, so both
  /// come out of the same walk — two filters would be two answers to "what is in
  /// this week".
  ///
  /// A row the runtime stamped nothing on is **kept**: this is a narrowing, and a
  /// narrowing must not become a way to lose a record nothing is known about. It
  /// lands in no chart bucket, which is where having no date has to show.
  const byPeriod = useMemo(() => {
    const result = {} as Record<Period, UsageRecord[]>;
    for (const value of PERIODS) {
      const cutoff = periodStart(value);
      result[value] = rows.filter((row) => !row.ts || recordTime(row) >= cutoff);
    }
    return result;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!provider) return byPeriod[period];
    return byPeriod[period].filter((row) => providerOf(row) === provider);
  }, [byPeriod, period, provider]);

  /// The gateways the open window holds, heaviest first, with what each one is
  /// worth there — the count on a chip is the same number the tab above it counts,
  /// read one level down.
  ///
  /// **A selected gateway stays listed even where this window holds none of it**,
  /// with a count of zero. Dropping it would switch the filter off under the
  /// reader's hands on a period change, and a page that quietly widened itself is
  /// a page answering a question nobody asked; the empty answer below is where
  /// "none here" gets said out loud instead.
  const providers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of byPeriod[period]) {
      const id = providerOf(row);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (provider && !counts.has(provider)) counts.set(provider, 0);
    return [...counts.entries()]
      .map(([id, count]) => ({ id, label: providerLabel(id, names), count }))
      .sort((a, b) => b.count - a.count);
  }, [byPeriod, period, provider, names]);

  /// What each tab is worth, counted through the same narrowing the body is: a
  /// tab promising six records over a page drawing five is the number the reader
  /// would have to reconcile themselves.
  const counts = useMemo(() => {
    const result = {} as Record<Period, number>;
    for (const value of PERIODS) {
      result[value] = provider
        ? byPeriod[value].filter((row) => providerOf(row) === provider).length
        : byPeriod[value].length;
    }
    return result;
  }, [byPeriod, provider]);

  const totals = useMemo(() => {
    const result = { ...EMPTY_TOTALS };
    filtered.forEach((row) => {
      addRow(result, row);
    });
    return result;
  }, [filtered]);

  const byModel = useMemo(() => {
    const groups = new Map<string, ModelGroup>();
    filtered.forEach((row) => {
      const key = `${providerOf(row)}|${modelName(row)}`;
      const group = groups.get(key) ?? { model: modelName(row), provider: providerOf(row), count: 0, ...EMPTY_TOTALS };
      addRow(group, row);
      group.count += 1;
      groups.set(key, group);
    });
    return [...groups.values()].sort((a, b) => b.total - a.total);
  }, [filtered]);

  /// The same list, gathered under the gateway that served it. Built off
  /// [`byModel`], which is already sorted by weight, so the gateways and the
  /// models inside them both come out heaviest first.
  const byProvider = useMemo(() => {
    const groups = new Map<string, ModelGroup[]>();
    for (const model of byModel) {
      const list = groups.get(model.provider);
      if (list) list.push(model);
      else groups.set(model.provider, [model]);
    }
    return [...groups.entries()].map(([id, models]) => ({ id, models }));
  }, [byModel]);

  // A failed read with rows already on screen keeps the rows: the banner says the
  // refresh missed, and throwing the numbers away would say the page has none.
  const showBody = !error || rows.length > 0;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-ui font-medium">Usage</h2>

          {/* The app's own row, with a count per window — the same control the
              plugins page and the inbox switch their own pages with. The period
              was a segmented well here, which is for a mode inside one surface;
              this is three windows over one page, which is what the row is for. */}
          <TabRow>
            {PERIODS.map((value) => (
              <TabButton
                key={value}
                active={period === value}
                label={PERIOD_WORD[value]}
                count={counts[value]}
                onClick={() => setPeriod(value)}
              />
            ))}
          </TabRow>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh usage"
              disabled={refreshing}
              onClick={() => void refresh()}
              className="cursor-pointer text-muted-foreground"
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} className="cursor-pointer">
              Close
            </Button>
          </div>
        </div>

        {/* The second row, and what it narrows is this page — the frame the issues
            page draws its scopes in. **Drawn even where the window holds one
            gateway**, which is the issues page's own habit rather than a slip: the
            scopes there are drawn whether or not each has anything behind it, and
            a row that appears only once you already have two gateways is a row
            nobody knows exists. The cost is stated: with one gateway `All` and
            that gateway select the same set, which is a true statement about the
            window rather than a control that lies. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[{ id: null, label: "All", count: counts[period] }, ...providers].map((entry) => (
            <button
              key={entry.id ?? "all"}
              type="button"
              onClick={() => setProvider(entry.id)}
              aria-pressed={provider === entry.id}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-ui transition-colors",
                provider === entry.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
              <span className="text-xs tabular-nums opacity-70">{entry.count}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error && <Problem detail={error} onRetry={() => void refresh()} />}

        {showBody &&
          (loading && rows.length === 0 ? (
            <UsageSkeleton />
          ) : filtered.length === 0 ? (
            <Filler>
              {provider
                ? `Nothing recorded from ${providerLabel(provider, names)} ${PERIOD_LABEL[period]}.`
                : `Nothing recorded ${PERIOD_LABEL[period]}.`}
            </Filler>
          ) : (
            // Two columns, and the split is what each side is: the numbers — the
            // total, its split, the activity and the models that made it — on the
            // left, and the stream they came from on the right. The wrappers are
            // what hold the grouping; in one column they simply stack in the same
            // order, which is why they are divs and not a second grid.
            <div className="grid items-start gap-x-10 @min-[56rem]:grid-cols-2">
              <div className="flex min-w-0 flex-col">
                <TotalsSection totals={totals} period={period} />
                <ChartSection rows={filtered} period={period} />
                <ModelsSection groups={byProvider} names={names} total={totals.total} />
              </div>
              <div className="flex min-w-0 flex-col">
                <RecentSection
                  rows={filtered.slice(0, RECENT_ROWS)}
                  total={filtered.length}
                  names={names}
                  narrowed={provider !== null}
                />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
