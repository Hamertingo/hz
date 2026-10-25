import { readStudio } from "@/lib/studio";

/// A time of day in the reader's clock pick: `18:05`, or `6:05 PM`.
export function formatClock(at: Date, twelveHour: boolean = readStudio().clock === "12h"): string {
  return twelveHour
    ? at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/// A row's time the way the mockup writes it: "now" inside a minute, the clock
/// time today, a weekday inside the week, a date after that.
export function sidebarTime(atMs: number | null, now: number = Date.now()): string {
  if (atMs === null) return "";
  const diff = now - atMs;
  if (diff < 60_000) return "now";
  const at = new Date(atMs);
  const today = new Date(now);
  if (at.toDateString() === today.toDateString()) return formatClock(at);
  if (diff < 6 * 86_400_000) return at.toLocaleDateString("en-US", { weekday: "short" });
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
