import type { ActivityScan } from "@/types/events";

const DAY = 86_400_000;

/// `2026-10-23` in the reader's own time zone: the day a moment belongs to for
/// them, not for UTC.
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/// The local midnight at the start of the day `ms` falls on.
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/// Counts per local day, keyed by [`dayKey`].
export function countByDay(stamps: readonly number[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const ms of stamps) out.set(dayKey(ms), (out.get(dayKey(ms)) ?? 0) + 1);
  return out;
}

/// The last `days` days, oldest first, ending today. A day with nothing is a 0,
/// so the bars keep their places.
export function lastDays(stamps: readonly number[], days: number, now: number): number[] {
  const counts = countByDay(stamps);
  const today = startOfDay(now);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(today);
    day.setDate(day.getDate() - (days - 1 - i));
    return counts.get(dayKey(day.getTime())) ?? 0;
  });
}

type HeatCell = {
  key: string;
  /// Midnight of that day.
  ms: number;
  count: number;
  /// 0 is nothing, 4 is the busiest band. -1 is a day that has not happened.
  level: -1 | 0 | 1 | 2 | 3 | 4;
};

/// The band a day's count falls in, relative to the busiest day shown, so a quiet
/// agent still has a readable map. Quartiles of the busiest day.
export function levelOf(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const share = count / max;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}

/// `weeks` columns of seven days, Monday first, the last column holding today.
/// Days after today are present (so every column is full) and marked -1.
export function buildHeatmap(stamps: readonly number[], weeks: number, now: number): HeatCell[][] {
  const counts = countByDay(stamps);
  const today = startOfDay(now);
  const todayDow = (new Date(today).getDay() + 6) % 7; // Monday = 0
  const first = new Date(today);
  first.setDate(first.getDate() - todayDow - (weeks - 1) * 7);

  const cells: HeatCell[][] = [];
  let max = 0;
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(first);
      day.setDate(day.getDate() + w * 7 + d);
      const key = dayKey(day.getTime());
      const ms = day.getTime();
      const count = ms > today ? 0 : (counts.get(key) ?? 0);
      max = Math.max(max, count);
      col.push({ key, ms, count, level: ms > today ? -1 : 0 });
    }
    cells.push(col);
  }
  for (const col of cells) {
    for (const c of col) if (c.level !== -1) c.level = levelOf(c.count, max);
  }
  return cells;
}

/// Month names under the columns where a month begins.
export function monthLabels(cells: readonly HeatCell[][]): { col: number; label: string }[] {
  const out: { col: number; label: string }[] = [];
  let last = -1;
  cells.forEach((col, i) => {
    const m = new Date(col[0].ms).getMonth();
    if (m !== last) {
      // A month that starts a column or two after the last would print on top of
      // it; the later one is the whole month on screen, so it wins.
      if (out.length > 0 && i - out[out.length - 1].col < 3) out.pop();
      out.push({ col: i, label: new Date(col[0].ms).toLocaleString("en-US", { month: "short" }) });
      last = m;
    }
  });
  return out;
}

export type Numbers = {
  /// Messages in the last 14 days, per day, oldest first.
  days: number[];
  messages14: number;
  tasksThisMonth: number;
  /// Seconds of turns that finished this calendar month.
  workSecsThisMonth: number;
};

/// The hero's tiles, from the log's own stamps.
export function heroNumbers(scan: Pick<ActivityScan, "messages" | "tasks">, now: number): Numbers {
  const days = lastDays(scan.messages, 14, now);
  const d = new Date(now);
  const month = (ms: number) => {
    const x = new Date(ms);
    return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth();
  };
  const tasks = scan.tasks.filter((t) => month(t.endMs));
  return {
    days,
    messages14: days.reduce((a, b) => a + b, 0),
    tasksThisMonth: tasks.filter((t) => t.ok).length,
    workSecsThisMonth: tasks.reduce((a, t) => a + t.secs, 0),
  };
}

function workClock(secs: number): { h: number; m: number } {
  return { h: Math.floor(secs / 3600), m: Math.floor((secs % 3600) / 60) };
}

/// "18h 40m", "12m", "40s": the time of work at the grain it is read at.
export function workLabel(secs: number): string {
  const { h, m } = workClock(secs);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${Math.max(0, Math.round(secs))}s`;
}

/// A day's heading in the feed: Today, Yesterday, then the date.
export function dayHeading(ms: number, now: number): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: diff > 300 ? "numeric" : undefined });
}

