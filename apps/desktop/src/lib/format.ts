/// Compact relative time for session rows — "now", "4m", "3h", "2d", then a date.
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`;

  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/// Whether a timestamp falls on the local calendar day. Calendar days, not a
/// 24-hour window: something touched at 11pm last night is yesterday's work by
/// 1am, which is the reading the sidebar wants.
export function isToday(iso: string): boolean {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  return daysApart(new Date(), new Date(at)) === 0;
}

/// A future clock time, qualified by day only when it needs to be.
///
/// A five-hour limit usually resets later today, where a bare time reads
/// fastest. But hit one late in the evening and it rolls over past midnight —
/// and "resets at 1:00" then means tomorrow, which is the one reading a bare
/// time gets wrong. Longer windows land days out and get a date outright.
export function resetTime(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";

  const time = new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  // Compared as calendar days rather than as a 24-hour distance: 11pm to 1am
  // is two hours away and still needs "tomorrow" on it.
  const days = daysApart(new Date(), new Date(at));
  if (days <= 0) return time;
  if (days === 1) return `${time} tomorrow`;

  const date = new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${time} on ${date}`;
}

/// Calendar days for a list you read down rather than watch — "Today",
/// "Yesterday", then "Aug 23".
///
/// Deliberately not [relativeTime]. That one counts elapsed time, which is the
/// right reading for a session that moved four minutes ago and the wrong one
/// for an issue: "20m" and "1d" invite arithmetic, and nobody looking at a
/// backlog wants to work out which afternoon "2d" was. A calendar day is the
/// unit the tracker itself uses and the unit the reader thinks in.
export function calendarDay(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";

  const days = daysApart(new Date(at), new Date());
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";

  const date = new Date(at);
  // The year only once it stops being obvious. Within this year it is noise on
  // every row; across one it is the only thing that tells them apart.
  const sameYear = date.getFullYear() === new Date().getFullYear();

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function daysApart(from: Date, to: Date): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(to) - midnight(from)) / 86_400_000);
}

/// A token count at a glance — "847", "30.6k", "1.2M". The exact figure is
/// never the point here; the order of magnitude is.
export function compactTokens(n: number): string {
  if (n < 1_000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/// A file size at a glance — "812 B", "1.4 KB", "2.3 MB". Decimal units, which
/// is what the OS file picker beside it reports.
export function formatBytes(n: number): string {
  if (n < 1_000) return `${n} B`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
}

/// Cuts `s` to `max` chars with an ellipsis, or returns it whole.
export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/// Trailing path segment, for showing a project as its folder name.
/// **Windows canonicalizes with `\\` and a `\\?\\` prefix, and neither is a
/// path a reader wrote.** `\\?\C:\Users\me\Downloads` holds no `/` at all, so
/// splitting on that alone returned the whole string — and a project's header
/// drew `\\?\C:\Users\Dashi\Downloads…` where its folder name belongs. The
/// Rust side states the same rule in `projects::basename`, and the two agree.
export function basename(path: string): string {
  const trimmed = stripVerbatim(path).replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed;
}

/// Windows' verbatim path prefix, which names no folder and hides the ones after it.
function stripVerbatim(path: string): string {
  return path.replace(/^\\\\\?\\UNC\\/i, "").replace(/^\\\\\?\\/, "");
}

/// How long a turn took, for the line under it.
///
/// **One decimal under a minute, because the small end is the point.** A 2.3s
/// turn and a 2.8s one are different experiences and rounding both to "2s"
/// hides exactly the difference a reader is looking at this to see. Past a
/// minute nobody reads a tenth, so that is where the decimal goes.
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/// How long the wait has been so far, for the row that is still waiting.
///
/// **No decimal, unlike [`formatDuration`].** The settled line is read once, and
/// a tenth is worth having there because that is where 2.3s and 2.8s differ.
/// This one is redrawn every second, so a tenth would only ever be `.0` — a
/// digit that changes under the reader's eye and never says anything.
///
/// Rounds **down**, so the number is time actually spent: a wait of 59.9s reads
/// `59s` rather than promising a minute it has not reached.
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/// The wall clock a stamp fell at, local and 24-hour: `14:32`.
///
/// Beside the duration under a turn, which answers "how long" and leaves "when"
/// unsaid — the same pair every chat bubble carries. **Read off the Date's own
/// local components rather than `toLocaleTimeString`**, or the shape would
/// follow the machine's ICU data: an en-US box would draw `2:32 PM` where the
/// column beside it is already a fixed-width figure, and no test could pin what
/// this returns on anybody else's laptop. `null` for a stamp that cannot be
/// read, which is the caller's cue to draw nothing.
export function clockTime(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
