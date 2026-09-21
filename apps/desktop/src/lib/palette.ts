import type { ShortcutId } from "@/lib/shortcuts";
import type { ContentMatch } from "@/types/events";

/// One row in the palette.
///
/// The `run` is a closure rather than a chord to replay: an action bound to a
/// key that is disabled in the current pane would fire nothing, and a row that
/// looks like it worked and did nothing is the one failure a palette must not
/// have. Every row here is something the shell can actually do right now.
export type PaletteItem = {
  /// `match` is a sentence found inside a session's log rather than a place to
  /// go: the reader typed a word they remember and the row is where it was said.
  /// `content` is the same thing said about a *file* — one line of the project the
  /// session runs in, which is where the work actually is.
  kind: "action" | "session" | "project" | "space" | "match" | "content";
  /// Unique across the list — a session id, a project path, a shortcut id.
  id: string;
  label: string;
  /// The second line: which project a session is in, where a project lives.
  detail?: string;
  /// Drawn as keycaps where the row has one. Read from the registry, so a
  /// rebinding moves the caps without the palette knowing.
  shortcut?: ShortcutId;
  /// What the row does. Called after the palette has closed.
  run: () => void;
};

/// What each kind is called in the row's own marker, plural and lower case so it
/// reads as a tag rather than as a sentence.
const KIND_LABEL: Record<PaletteItem["kind"], string> = {
  action: "action",
  session: "session",
  project: "project",
  space: "space",
  // "message" rather than "match": the row is a sentence somebody wrote, and
  // this is the word the reader has for it.
  match: "message",
  // "code" rather than "line": the reader is looking at a file, and the line is
  // only how the row points at one.
  content: "code",
};

export function kindLabel(kind: PaletteItem["kind"]): string {
  return KIND_LABEL[kind];
}

/// `>` alone narrows the list to actions — the convention t3code and every
/// editor's palette share, and the one thing a reader arriving from another app
/// will try first.
export function isActionMode(query: string): boolean {
  return query.trimStart().startsWith(">");
}

function matches(item: PaletteItem, needle: string): boolean {
  if (!needle) return true;
  return (
    item.label.toLowerCase().includes(needle) || (item.detail?.toLowerCase().includes(needle) ?? false)
  );
}

/// The rows a query leaves, best first.
///
/// Two passes at most: what the label *starts* with, then what it merely
/// contains. A query matching the start of a session's title is nearly always
/// the session somebody meant, and sorting the whole list by a fuzzy score is
/// work this list is far too short to need.
///
/// The order within one pass is the caller's, which is the order the app already
/// draws things in — the sidebar's own sort for sessions — so the palette and
/// the list beside it agree about what is near the top.
export function matchItems(items: PaletteItem[], query: string): PaletteItem[] {
  const raw = query.trim();
  const actionsOnly = isActionMode(raw);
  const needle = (actionsOnly ? raw.slice(1) : raw).trim().toLowerCase();

  const pool = actionsOnly ? items.filter((item) => item.kind === "action") : items;
  if (!needle) return pool;

  const starts: PaletteItem[] = [];
  const contains: PaletteItem[] = [];
  for (const item of pool) {
    if (!matches(item, needle)) continue;
    (item.label.toLowerCase().startsWith(needle) ? starts : contains).push(item);
  }
  return [...starts, ...contains];
}

/// How many file hits the palette draws. More than anybody reads in a menu and few
/// enough that one word does not bury the sessions they might have meant — the two
/// other search boxes narrow by typing, and so does this one.
export const CONTENT_ROWS = 8;

/// The file hits a query found, as palette rows.
///
/// **The row is the line.** A palette row is one line of text and a match is one
/// line of a file, so the label is the line itself and the detail says which file
/// and where in it — the reader recognises the sentence they were looking for, and
/// the path is what tells two files with one basename apart.
///
/// Pure, and `open` is passed in rather than reached for, so what a row *does* is
/// the shell's business: the palette has no idea which session is on screen.
export function contentRows(
  matches: readonly ContentMatch[],
  open: (hit: ContentMatch) => void,
): PaletteItem[] {
  return matches.slice(0, CONTENT_ROWS).map((hit) => ({
    kind: "content",
    // File *and* line: two hits in one file are two rows, and either half alone
    // collides with the other.
    id: `${hit.path}:${hit.line}`,
    label: hit.text,
    detail: `${hit.relative}:${hit.line}`,
    run: () => open(hit),
  }));
}

/// Where a query's own characters sit inside a row, for the run the palette draws
/// in the accent colour.
///
/// Case-insensitive, because the search is: a row that matched `Needle` for
/// `needle` and then drew none of it in the accent would look like a row that had
/// matched some other way.
///
/// `null` where the query is not in the label at all — a row can match on its
/// detail (a session's project, a file's path) and there is nothing to mark in the
/// label then.
export function highlight(
  text: string,
  needle: string,
): { before: string; match: string; after: string } | null {
  const query = needle.trim().toLowerCase();
  if (!query) return null;
  const at = text.toLowerCase().indexOf(query);
  if (at < 0) return null;
  return {
    before: text.slice(0, at),
    // Sliced out of the *original*, so what is drawn is the text as it is written
    // rather than as it was folded to be found.
    match: text.slice(at, at + query.length),
    after: text.slice(at + query.length),
  };
}
