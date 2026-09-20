/// One line of a run's log: which job it came from, the clock GitHub stamped it
/// with, and its message.
///
/// **The job is the one column worth keeping.** `gh` answers `UNKNOWN STEP` for
/// the step column on every line of a real run, but the job column carries the
/// job's own name — which is how a pane that is showing one job keeps the other
/// job's output out of it.
///
/// **The `##[...]` annotations stay in the text.** They are the log's own
/// structure — a nested group, a command being echoed, an error — written into
/// the message by the runner, and the view is what turns them into anything.
export type LogLine = { job: string; at: string | null; text: string };

/// What a line *is*, once its annotation is read.
export type LogKind =
  | "plain"
  | "group"
  | "endgroup"
  | "error"
  | "warning"
  | "notice"
  | "debug"
  | "command"
  | "section";

const MARKERS: Record<string, LogKind> = {
  "##[group]": "group",
  "##[endgroup]": "endgroup",
  "##[error]": "error",
  "##[warning]": "warning",
  "##[notice]": "notice",
  "##[debug]": "debug",
  "##[command]": "command",
  "##[section]": "section",
};

/// The clock a line carries, and the line without it.
///
/// The stamp is a fixed shape — `2026-09-05T12:02:02.8625270Z` — and it is
/// checked structurally rather than parsed: this runs once per line of a log
/// that can hold hundreds of thousands of them, and a date library would be
/// paying for a fact the format already states.
export function parseLogLine(raw: string, job = ""): LogLine {
  const space = raw.indexOf(" ");
  if (space === -1) return { job, at: null, text: raw };

  const head = raw.slice(0, space);
  if (!isStamp(head)) return { job, at: null, text: raw };
  return { job, at: head, text: raw.slice(space + 1) };
}

function isStamp(token: string): boolean {
  return (
    token.length >= 20 &&
    token.endsWith("Z") &&
    token[4] === "-" &&
    token[7] === "-" &&
    token[10] === "T" &&
    token[13] === ":" &&
    token[16] === ":"
  );
}

/// A line's kind and its words, with the annotation taken off.
export function annotate(text: string): { kind: LogKind; text: string } {
  for (const [marker, kind] of Object.entries(MARKERS)) {
    if (text.startsWith(marker)) return { kind, text: text.slice(marker.length) };
  }
  return { kind: "plain", text };
}

/// A whole `gh run view --log` answer, split into lines.
///
/// **Blank rows are dropped**, and that is `gh`'s own padding rather than the
/// runner's: the log's real spacing is the blank *messages* it writes itself,
/// which arrive here as a line with a stamp and nothing after it.
export function readLog(raw: string): LogLine[] {
  const lines: LogLine[] = [];

  for (const row of raw.split("\n")) {
    if (!row.trim()) continue;

    // `job<TAB>step<TAB>timestamp message`. The step column is deliberately
    // unread: `gh` answers `UNKNOWN STEP` for every line of a real run, which is
    // why the join to a step is the group marker below and not this.
    const parts = row.split("\t");
    const message = parts.length >= 3 ? parts.slice(2).join("\t") : row;
    lines.push(parseLogLine(stripAnsi(message), parts[0] ?? ""));
  }

  return lines;
}

/// The escape sequences a runner writes into its own log, and the reason they
/// never reach the screen.
///
/// `^[[36;1mgit push^[[0m` is a colour for a *terminal*, and this is not one: drawn
/// raw it is a line of punctuation nobody can read, and the app's own tokens are
/// the only colours a surface here has.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the escape is the character this matches
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/// One block of a log: a `##[group]` and its lines, or a run of lines no group
/// claimed.
///
/// **The runner's own structure, which is the only one the wire has.** A step's
/// output is *not* always grouped under the step's name — measured: a step with
/// a `name:` gets a group titled by its **command** (`Run ssh …`) rather than by
/// the name the run's step list carries, and the tail of a job (its cleanup) is
/// grouped by nothing at all. Drawing the blocks is therefore always true, where
/// drawing "the step's log" is true only where the names happen to line up.
/// The lines of one job, or of the whole run where the log does not name it.
///
/// **The job column is the only one worth reading.** `gh` answers `UNKNOWN STEP`
/// for the step column on every line of a real run — which is why a step's output
/// cannot be lifted out by name — but the job column carries the job's own name,
/// and that is what keeps one job's log out of the pane showing another.
///
/// The fallback is stated rather than silent: a job that declared a `name:` may
/// be keyed differently in the log, and a filter matching nothing would leave an
/// empty pane for a log that is right there. Too much of the answer beats none of
/// it, and every heading says which job its block came from.
export function jobLog(lines: LogLine[], job: string): LogLine[] {
  const wanted = lines.filter((line) => line.job === job);
  return wanted.length > 0 ? wanted : lines;
}

/// One `##[group]` and the lines under it, or a run of lines no group claimed.
///
/// `at` is where the block *starts* in the array it was read from, which is what
/// a drawn line number is made of: a collapsed heading shows the number of the
/// first line inside it, so the reader can see how much they are folding away
/// without opening it.
export type LogGroup = { title: string | null; lines: LogLine[]; at: number };

/// The log split into the groups the runner drew.
///
/// **This is what makes a long log navigable**, and it is GitHub's own move: its
/// log view collapses the `##[group]` blocks, so a 900-line step reads as a dozen
/// headings and the one block the reader wants. A group runs to the next group —
/// the log is flat, so there is no nesting to walk (see [`stepLog`]).
export function logGroups(lines: LogLine[]): LogGroup[] {
  const groups: LogGroup[] = [];
  let current: LogGroup | null = null;
  let at = 0;

  for (const line of lines) {
    const { kind, text } = annotate(line.text);

    if (kind === "group") {
      current = { title: text, lines: [], at };
      groups.push(current);
      continue;
    }

    // Lines no group claimed — the runner's own preamble and its tail — gather
    // into a block of their own rather than being thrown away or glued to the
    // group above them.
    if (!current) {
      current = { title: null, lines: [], at };
      groups.push(current);
    }
    current.lines.push(line);
    at += 1;
  }

  // A group that opened and closed with nothing in it is a heading over nothing.
  return groups.filter((group) => group.lines.length > 0);
}

/// The end of a log, and how much was left out.
///
/// **The tail, because the end is where a step went wrong.** A failing `pnpm
/// install` prints its whole dependency tree before the error, and a view that
/// capped the *front* would show the reader everything except the reason.
export function tail(
  lines: LogLine[],
  max: number,
): { lines: LogLine[]; hidden: number; total: number } {
  if (lines.length <= max) return { lines, hidden: 0, total: lines.length };
  return { lines: lines.slice(lines.length - max), hidden: lines.length - max, total: lines.length };
}

/// The whole of a step's log as text, for the clipboard — annotations off, since
/// `##[error]` is the runner talking to the interface rather than to the reader.
export function logText(lines: LogLine[]): string {
  return lines
    .map((line) => {
      const { kind, text } = annotate(line.text);
      return kind === "plain" ? line.text : text;
    })
    .join("\n");
}
