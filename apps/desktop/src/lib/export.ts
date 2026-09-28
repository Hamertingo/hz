/// A session, written out.
///
/// **The second consumer of the transcript walk**, and that is the whole reason
/// the shape is cheap: `buildTranscript` already turns the event log into turns,
/// groups and a final answer for the screen, and this reads the same structure
/// rather than walking the log again. One walk, two renderers — the same bargain
/// `pendingAsksOf` was split out on, and it is what keeps the file and the window
/// from disagreeing about what a session said.
///
/// **Deterministic, and that is a requirement rather than a nicety.** The same
/// session in, the same bytes out: object keys are sorted, and the only stamps in
/// the document are the ones the events already carry — never `Date.now()`. An
/// export that cannot be diffed against yesterday's is an export nobody can use to
/// answer "what changed", which is most of what an export is for.

import { buildTranscript, isToolGroup, type Turn } from "@/lib/transcript";
import type { AgentEvent, SessionIndexItem } from "@/types/events";

/// What the frontmatter says about the session the events came from.
///
/// Supplied rather than read here: none of it is in the log — a title the app
/// derived, the project it belongs to, the branch and tree it ran in, the model it
/// ran on — and this module walks events, not the index.
export type SessionExportMeta = {
  title: string;
  project: string | null;
  branch: string | null;
  worktree: string | null;
  model: string | null;
};

/// Keys a tool call names its subject with, most specific first.
///
/// Read off `input` rather than inferred from the tool's name: the same tool
/// spells the same thing the same way across every harness this app has spoken to,
/// and a table keyed by tool name would have to be extended by whoever adds the
/// next one. A tool that names nothing gets a bare name, which is still true.
const TARGET_KEYS = [
  "file_path",
  "path",
  "command",
  "pattern",
  "url",
  "query",
  "notebook_path",
] as const;

/// The one line a tool call is worth in a document.
function toolTarget(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  for (const key of TARGET_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/// Object keys in a stable order, at every depth.
///
/// `JSON.stringify` emits keys in insertion order, and that order is whatever the
/// runtime happened to build the object in — so two runs over the same log can
/// differ. Sorting is what makes the output diffable.
function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, held]) => [key, withSortedKeys(held)]),
  );
}

/// The event log itself, as JSON Lines.
///
/// **One event per line, because that is the shape the log is written in.** It is
/// also the only shape worth calling an export: the parser on the other side reads
/// JSONL, so this round-trips — a session handed over as a bug report is one
/// somebody can open, not one they have to reshape first. A pretty JSON array
/// reads better to a human and is useless to the reader whose problem it describes.
///
/// Keys are sorted, line by line, so the output still diffs.
export function sessionToJson(events: readonly AgentEvent[]): string {
  if (events.length === 0) return "";

  return `${events.map((event) => JSON.stringify(withSortedKeys(event))).join("\n")}\n`;
}

/// The text of a prompt, where the event is one.
function promptText(turn: Turn): string | null {
  const payload = turn.prompt?.payload;
  if (payload?.type !== "user_message") return null;
  return payload.text;
}

/// A fenced block, given content that may hold its own fences.
function fenced(body: string, language = ""): string {
  // One longer than the longest run inside, so a transcript quoting markdown — an
  // agent showing a diff of a README, say — cannot close the block early.
  const longest = [...body.matchAll(/^`{3,}/gm)].reduce(
    (most, match) => Math.max(most, match[0].length),
    2,
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${body.replace(/\n$/, "")}\n${fence}`;
}

/// One turn's work, as the lines it would collapse to on screen.
///
/// Groups first, because that is what they are: a run of same-tool calls is one
/// fact about the turn, and the row that collapses on screen says so in one line.
function workLines(turn: Turn): string[] {
  const lines: string[] = [];

  for (const item of turn.work) {
    if (isToolGroup(item)) {
      const subject = item.target ?? `${item.targets}`;
      lines.push(`- \`${item.name}\` · ${subject}`);
      continue;
    }

    const payload = item.payload;
    if (payload.type === "tool_call_started") {
      const target = toolTarget(payload.input);
      lines.push(`- \`${payload.name}\`${target ? ` · ${target}` : ""}`);
      continue;
    }
    // Intermediate narration: what the agent said on the way, which a collapsed
    // turn hides but a document should not lose.
    if (payload.type === "assistant_text" && payload.text.trim()) {
      lines.push(payload.text.trim());
    }
  }

  return lines;
}

/// The whole session, as Markdown.
///
/// Turns in order: the prompt, the work, the answer. A turn that never closed —
/// an interrupt, or the last turn of a session still running — simply has no
/// answer, and the frontmatter says how many turns closed, so a reader can tell a
/// missing answer from an unfinished one.
export function sessionToMarkdown(
  events: readonly AgentEvent[],
  meta: SessionExportMeta,
): string {
  const { turns } = buildTranscript([...events], false);

  const first = events[0]?.ts ?? null;
  const last = events[events.length - 1]?.ts ?? null;

  const front = [
    "---",
    `title: ${meta.title}`,
    meta.project && `project: ${meta.project}`,
    meta.branch && `branch: ${meta.branch}`,
    meta.worktree && `worktree: ${meta.worktree}`,
    meta.model && `model: ${meta.model}`,
    `turns: ${turns.length}`,
    first && `from: ${first}`,
    last && `to: ${last}`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const body: string[] = [`# ${meta.title}`];

  turns.forEach((turn, index) => {
    body.push("", `## Turn ${index + 1}`);

    const prompt = promptText(turn);
    if (prompt) body.push("", `### You`, "", prompt.trim());

    const work = workLines(turn);
    if (work.length > 0) body.push("", "### Work", "", work.join("\n"));

    if (turn.finalText?.trim()) body.push("", "### Answer", "", turn.finalText.trim());
  });

  return `${front}\n\n${body.join("\n").trim()}\n`;
}

/// The markdown, fenced — for a caller that wants to paste it into something that
/// only takes text.
export { fenced as fenceForEmbedding };

/// The frontmatter's facts, read off the session's index entry.
///
/// The entry is where every one of them lives — the title the app derived, the
/// project and the tree the session ran in, the model it ran on — and none of it
/// is in the event log, which is why the walk cannot supply it and why this is a
/// parameter rather than something read here.
export function sessionExportMeta(item: SessionIndexItem): SessionExportMeta {
  return {
    // A session with no title yet is one the app has not named, and the id is a
    // worse name than nothing — but a `title:` line has to say something.
    title: item.title || item.sessionId,
    project: item.projectPath || null,
    branch: item.branch,
    worktree: item.worktreeName,
    model: item.model || null,
  };
}

/// What an export's file is called.
///
/// **From the session's own title, because a reader with six of these in a folder
/// is reading their names** — and sanitised, because that title is prose an agent
/// wrote. A slash in it would put the file in a directory that is not there, a
/// colon is refused outright on one platform, and a newline makes a name no
/// dialog can show. A leading dot hides the file; a trailing one is refused.
///
/// Capped, since a title may be a paragraph. Falls back to `session` where
/// sanitising left nothing — a title of pure punctuation is not a filename.
export function exportFileName(title: string, extension: "md" | "json"): string {
  const cleaned = title
    // Separators and the characters a filesystem refuses or hides behind.
    .replace(/[/\\:*?"<>|]/g, " ")
    // Control characters, newlines among them. Written as a Unicode category
    // rather than a `\u0000-\u001f` range, which a linter reads as a typo.
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .trim();

  return `${cleaned.slice(0, 80).trim() || "session"}.${extension}`;
}
