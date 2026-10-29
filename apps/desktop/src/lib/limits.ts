import type { CliLimits, LimitWindow } from "@/types/events";

/// A window at or past this is drawn in amber, the mockup's "close to the limit".
export const WARN_PCT = 80;

/// `2h 41m`, `35m`, `2d 4h`: how long until a reset, or `null` for one already past.
export function untilReset(atMs: number, now: number = Date.now()): string | null {
  const mins = Math.floor((atMs - now) / 60_000);
  if (mins < 1) return null;
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/// "window resets in 2h 41m" when the reset is within a day, otherwise "resets
/// Friday". Empty where the CLI named no reset.
export function resetNote(windows: readonly LimitWindow[], now: number = Date.now()): string {
  const soonest = windows
    .map((w) => w.resetsAtMs)
    .filter((t): t is number => t !== null && t > now)
    .sort((a, b) => a - b)[0];
  if (soonest === undefined) return "";

  const left = untilReset(soonest, now);
  if (left && soonest - now < 24 * 3_600_000) return `window resets in ${left}`;
  return `resets ${new Date(soonest).toLocaleDateString("en-US", { weekday: "long" })}`;
}

/// `62%`, or `~62%` for a figure hz sized itself, or `—` for a window that
/// named no number. Never `0%` for something nobody measured.
export function pctText(w: LimitWindow): string {
  if (w.usedPct === null) return "—";
  const n = Math.round(w.usedPct);
  return w.estimated ? `~${n}%` : `${n}%`;
}

export function isWarn(w: LimitWindow): boolean {
  return w.usedPct !== null && w.usedPct >= WARN_PCT;
}

/// How many of the bar's `cells` are lit.
export function litCells(pct: number | null, cells = 30): number {
  if (pct === null) return 0;
  return Math.round((Math.max(0, Math.min(100, pct)) / 100) * cells);
}

/// What the header of a CLI's card says after its name: the plan, and whether
/// the bars are measured or sized by hz.
export function sourceNote(l: CliLimits): string {
  if (l.source === "estimate") return "estimated";
  return l.plan ?? "";
}

/// US dollars the way the page writes them.
export function usd(n: number): string {
  return `US$ ${n.toFixed(2)}`;
}

/// A dollar amount typed into a field. `null` for empty or not a positive number.
export function parseUsd(text: string): number | null {
  const n = Number.parseFloat(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/// `hz-usage-2026-10.csv`.
export function csvFileName(date: Date = new Date()): string {
  return `hz-usage-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}.csv`;
}
