import type { ShortcutId } from "@/lib/shortcuts";

/// One row in the palette.
///
/// The `run` is a closure rather than a chord to replay: an action bound to a
/// key that is disabled in the current pane would fire nothing, and a row that
/// looks like it worked and did nothing is the one failure a palette must not
/// have. Every row here is something the shell can actually do right now.
export type PaletteItem = {
  /// `match` is a sentence found inside a session's log rather than a place to
  /// go: the reader typed a word they remember and the row is where it was said.
  kind: "action" | "session" | "project" | "space" | "match";
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
