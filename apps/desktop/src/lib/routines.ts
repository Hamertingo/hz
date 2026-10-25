import type { Routine, RoutineInput, RunRecord } from "@/types/events";

/// The pure half of the Routines page: sentences, schedules and the week strip.
/// Nothing here reads the clock or the backend; `now` is always passed in, so the
/// same input draws the same page in a test as on screen.

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [0, 1, 2, 3, 4];

/// What each service can call about, as the editor and the event menu offer it.
export const SOURCES: Record<string, string[]> = {
  GitHub: ["pull_request.opened", "issues.opened", "push", "release.published"],
  Stripe: ["charge.dispute.created", "invoice.payment_failed", "customer.subscription.deleted"],
  Linear: ["issue.created", "issue.updated"],
  Sentry: ["issue.created", "alert.triggered"],
  Custom: ["POST /hooks/your-name"],
};

/// The BrandMark slug of a source; `Custom` has none and draws a plain mark.
export const SOURCE_BRAND: Record<string, string> = {
  GitHub: "github",
  Stripe: "stripe",
  Linear: "linear",
  Sentry: "sentry",
};

export const TIME_PRESETS = ["06:00", "08:00", "09:00", "12:00", "16:00", "18:00", "22:00"];

/// Where a result goes, as the menus list it. Channels are the workspace's own.
export type Channel = { id: string; name: string };

export type Template = {
  name: string;
  icon: "bell" | "usage" | "bolt" | "moon";
  description: string;
  set: Partial<Pick<RoutineInput, "name" | "act" | "to" | "trigger">>;
};

export const TEMPLATES: Template[] = [
  {
    name: "Morning digest",
    icon: "bell",
    description: "Weekdays at 08:00, what changed overnight.",
    set: {
      name: "Morning digest",
      act: "sums up what changed overnight",
      to: "inbox",
      trigger: { kind: "schedule", days: WEEKDAYS, time: "08:00", tz: "local" },
    },
  },
  {
    name: "Weekly report",
    icon: "usage",
    description: "Mondays at 09:00, numbers against last week.",
    set: {
      name: "Weekly report",
      act: "writes the weekly report",
      to: "agent_chat",
      trigger: { kind: "schedule", days: [0], time: "09:00", tz: "local" },
    },
  },
  {
    name: "Watch a webhook",
    icon: "bolt",
    description: "Runs when GitHub, Stripe or Sentry calls.",
    set: {
      name: "Review PRs",
      act: "reviews the pull request",
      to: "pr_comment",
      trigger: { kind: "webhook", source: "GitHub", event: "pull_request.opened" },
    },
  },
  {
    name: "Nightly cleanup",
    icon: "moon",
    description: "Every night, tidy memory and stale tasks.",
    set: {
      name: "Nightly cleanup",
      act: "tidies its memory and closes stale tasks",
      to: "inbox",
      trigger: { kind: "schedule", days: ALL_DAYS, time: "03:00", tz: "local" },
    },
  },
];

/// A blank routine for the editor. `id` is minted here so the webhook address the
/// editor prints is the one the saved routine answers on.
export function blankRoutine(agentId: string, id: string, secret: string): RoutineInput {
  return {
    id,
    name: "",
    agentId,
    trigger: { kind: "schedule", days: WEEKDAYS, time: "09:00", tz: "local" },
    act: "",
    prompt: "",
    to: "agent_chat",
    quiet: true,
    on: true,
    secret,
  };
}

/// The editor's fields from a saved routine.
export function inputOf(r: Routine): RoutineInput {
  return {
    id: r.id,
    name: r.name,
    agentId: r.agentId,
    trigger: r.trigger,
    act: r.act,
    prompt: r.prompt,
    to: r.to,
    quiet: r.quiet,
    on: r.on,
    secret: r.secret,
  };
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/// "every day", "every weekday", "every Monday", "on Mon, Wed".
export function whenText(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  const key = d.join();
  if (d.length === 7) return "every day";
  if (key === "0,1,2,3,4") return "every weekday";
  if (key === "5,6") return "every weekend";
  if (d.length === 1) return `every ${DAY_NAMES[d[0]]}`;
  return `on ${d.map((x) => DAY_NAMES[x].slice(0, 3)).join(", ")}`;
}

/// Where a result goes, in the words the sentence uses.
export function destLabel(to: string, agentName: string, channels: Channel[] = []): string {
  if (to === "agent_chat") return `${agentName}'s chat`;
  if (to === "inbox") return "Inbox";
  if (to === "pr_comment") return "a PR comment";
  if (to.startsWith("channel:")) {
    const id = to.slice("channel:".length);
    return `#${channels.find((c) => c.id === id)?.name ?? id}`;
  }
  return to;
}

/// Which word of a sentence opens which menu.
export type Chip = "days" | "time" | "agent" | "act" | "to" | "src" | "ev";

export type SentencePart = { text: string; chip?: Chip };

/// The one sentence a routine is, split so each underlined word knows its menu.
/// "Every weekday at 09:00, Atlas pulls the numbers and posts it in Atlas's chat."
export function sentenceParts(
  r: Pick<RoutineInput, "trigger" | "act" | "to">,
  agentName: string,
  channels: Channel[] = [],
): SentencePart[] {
  const act = r.act.trim() || "does something";
  const to = destLabel(r.to, agentName, channels);
  const t = r.trigger;
  if (t.kind === "schedule") {
    return [
      { text: cap(whenText(t.days)), chip: "days" },
      { text: " at " },
      { text: t.time, chip: "time" },
      { text: ", " },
      { text: agentName, chip: "agent" },
      { text: " " },
      { text: act, chip: "act" },
      { text: " and posts it in " },
      { text: to, chip: "to" },
      { text: "." },
    ];
  }
  return [
    { text: "When " },
    { text: t.source, chip: "src" },
    { text: " sends " },
    { text: t.event, chip: "ev" },
    { text: ", " },
    { text: agentName, chip: "agent" },
    { text: " " },
    { text: act, chip: "act" },
    { text: " and puts it in " },
    { text: to, chip: "to" },
    { text: "." },
  ];
}

export function sentenceText(
  r: Pick<RoutineInput, "trigger" | "act" | "to">,
  agentName: string,
  channels: Channel[] = [],
): string {
  return sentenceParts(r, agentName, channels)
    .map((p) => p.text)
    .join("");
}

const pad = (n: number) => String(n).padStart(2, "0");

/// A local date as `YYYY-MM-DD`, the spelling the backend's `skipped` uses.
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/// The minutes east of UTC a schedule's `tz` names, or null for the machine's own.
function offsetMinutes(tz: string): number | null {
  const t = tz.trim();
  if (t.toLowerCase() === "utc" || t === "Z") return 0;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/// The instant a clock reading on a date happens in a schedule's zone.
function instantIn(tz: string, date: string, time: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const off = offsetMinutes(tz);
  return off === null ? new Date(y, mo - 1, d, h, mi).getTime() : Date.UTC(y, mo - 1, d, h, mi) - off * 60_000;
}

/// The date in a schedule's zone that an instant falls on.
export function dateKeyIn(tz: string, ms: number): string {
  const off = offsetMinutes(tz);
  if (off === null) return dateKey(new Date(ms));
  const shifted = new Date(ms + off * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/// Monday = 0, of a `YYYY-MM-DD` date.
function weekdayOf(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
}

function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const out = new Date(Date.UTC(y, mo - 1, d + n));
  return `${out.getUTCFullYear()}-${pad(out.getUTCMonth() + 1)}-${pad(out.getUTCDate())}`;
}

/// When a schedule next fires after `afterMs`, skipped dates passed over. The same
/// rule the backend's clock applies, so a page drawn before the first poll agrees.
export function occurrences(r: Routine, fromMs: number, toMs: number): number[] {
  const t = r.trigger;
  // A routine from before day-and-time schedules still runs on its interval, which
  // has no days to draw.
  if (t.kind !== "schedule" || !r.on || r.legacyEveryMinutes != null) return [];
  const out: number[] = [];
  const first = addDays(dateKeyIn(t.tz, fromMs), -1);
  for (let i = 0; i < 16; i++) {
    const date = addDays(first, i);
    if (!t.days.includes(weekdayOf(date)) || r.skipped.includes(date)) continue;
    const at = instantIn(t.tz, date, t.time);
    if (at >= fromMs && at <= toMs) out.push(at);
  }
  return out;
}

/// When the routine will next run, as a sentence-sized phrase.
export function nextText(r: Routine, now: number): string {
  if (!r.on) return "paused";
  if (r.trigger.kind === "webhook") return "on event";
  const at = r.nextRunAt ? Date.parse(r.nextRunAt) : (occurrences(r, now, now + 8 * 86_400_000)[0] ?? NaN);
  if (!Number.isFinite(at)) return "—";
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = dateKey(new Date(now));
  const tomorrow = dateKey(new Date(now + 86_400_000));
  const day = dateKey(d);
  if (day === today) return `today ${time}`;
  if (day === tomorrow) return `tomorrow ${time}`;
  return `${DAY_NAMES[(d.getDay() + 6) % 7].slice(0, 3)} ${time}`;
}

/// The last run's verdict, for the row's meta line.
export function lastRun(r: Routine): RunRecord | null {
  return r.runs.length ? r.runs[r.runs.length - 1] : null;
}

/// One face on the week strip.
export type WeekMark = {
  routineId: string;
  agentId: string;
  at: number;
  /// `next` is a run still to come, drawn faded.
  state: "ok" | "fail" | "next";
  /// The run that just finished, which pops in.
  fresh: boolean;
  /// The run this mark opens, or null for one still to come.
  run: RunRecord | null;
};

export type WeekDay = { date: string; label: string; day: number; today: boolean; marks: WeekMark[] };

/// How long a finished run counts as "just ran" and pops in.
export const FRESH_MS = 20_000;

/// Monday of the week `now` falls in, as a local date.
export function weekStartOf(now: number): string {
  const d = new Date(now);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return dateKey(monday);
}

/// The seven days, each holding the faces of the runs that happened on it and the
/// ones still to come. Runs are real records; upcoming marks come from the clock.
export function weekBuckets(routines: Routine[], now: number): WeekDay[] {
  const start = weekStartOf(now);
  const today = dateKey(new Date(now));
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return { date, label: DAY_NAMES[i].slice(0, 3), day: Number(date.slice(8)), today: date === today, marks: [] };
  });
  const byDate = new Map(days.map((d) => [d.date, d]));
  const startMs = instantIn("local", start, "00:00");
  const endMs = instantIn("local", addDays(start, 7), "00:00") - 1;

  for (const r of routines) {
    for (const run of r.runs) {
      const at = Date.parse(run.at);
      if (!Number.isFinite(at) || at < startMs || at > endMs) continue;
      byDate.get(dateKey(new Date(at)))?.marks.push({
        routineId: r.id,
        agentId: r.agentId,
        at,
        state: run.status === "fail" ? "fail" : "ok",
        fresh: now - at < FRESH_MS && now >= at,
        run,
      });
    }
    for (const at of occurrences(r, now, endMs)) {
      // Not the run that just happened: a record at the same minute covers it.
      if (r.runs.some((run) => Math.abs(Date.parse(run.at) - at) < 60_000)) continue;
      byDate.get(dateKey(new Date(at)))?.marks.push({
        routineId: r.id,
        agentId: r.agentId,
        at,
        state: "next",
        fresh: false,
        run: null,
      });
    }
  }
  for (const d of days) d.marks.sort((a, b) => a.at - b.at);
  return days;
}

export type Filter = "all" | "schedule" | "webhook";

export function counts(routines: Routine[]): Record<Filter, number> {
  return {
    all: routines.length,
    schedule: routines.filter((r) => r.trigger.kind === "schedule").length,
    webhook: routines.filter((r) => r.trigger.kind === "webhook").length,
  };
}

export function filterRoutines(routines: Routine[], filter: Filter): Routine[] {
  return filter === "all" ? routines : routines.filter((r) => r.trigger.kind === filter);
}

/// `12:34` for a duration in milliseconds, `0:07` under a minute.
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function money(cost: number | null): string {
  if (cost == null) return "—";
  return `US$ ${cost < 0.01 && cost > 0 ? cost.toFixed(3) : cost.toFixed(2)}`;
}

/// A signing secret the editor shows before the routine exists. 32 random bytes.
export function newSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `whsec_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/// The address a service is pointed at. `workspace` is the agent's, `_` for none.
export function hookUrl(base: string, workspaceId: string | null, routineId: string): string {
  return `${base || "http://127.0.0.1:…"}/hooks/${workspaceId ?? "_"}/${routineId}`;
}

