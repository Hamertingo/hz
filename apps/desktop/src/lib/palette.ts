import type { ReactNode } from "react";

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
  /// `content` is the same thing said about a *file* — one line of the project the
  /// session runs in, which is where the work actually is.
  kind:
    | "action"
    | "session"
    | "channel"
    | "project"
    | "space"
    | "match"
    | "content"
    | "agent"
    | "inbox"
    | "memory"
    | "routine"
    | "plugin";
  /// Unique across the list — a session id, a project path, a shortcut id.
  id: string;
  label: string;
  /// The second line: which project a session is in, where a project lives.
  detail?: string;
  /// Drawn as keycaps where the row has one. Read from the registry, so a
  /// rebinding moves the caps without the palette knowing.
  shortcut?: ShortcutId;
  /// The row's leading mark: an agent's face, a plugin's brand, a glyph.
  icon?: ReactNode;
  /// What the row does. Called after the palette has closed.
  run: () => void;
};

/// What each kind is called in the row's own marker, plural and lower case so it
/// reads as a tag rather than as a sentence.
const KIND_LABEL: Record<PaletteItem["kind"], string> = {
  action: "action",
  session: "session",
  channel: "channel",
  project: "project",
  space: "space",
  // "message" rather than "match": the row is a sentence somebody wrote, and
  // this is the word the reader has for it.
  match: "message",
  // "code" rather than "line": the reader is looking at a file, and the line is
  // only how the row points at one.
  content: "code",
  agent: "agent",
  inbox: "needs you",
  memory: "note",
  routine: "routine",
  plugin: "plugin",
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

/// The groups Jump to draws, in the order the mockup lists them, and then the
/// ones the older palette had that still make sense.
export const GROUPS = [
  "Agents",
  "Channels",
  "Needs you",
  "In memory",
  "Routines",
  "Plugins",
  "Do",
  "Sessions",
  "Messages",
  "Code",
  "Projects",
  "Workspaces",
] as const;

export type PaletteGroup = (typeof GROUPS)[number];

const GROUP_OF: Record<PaletteItem["kind"], PaletteGroup> = {
  agent: "Agents",
  channel: "Channels",
  inbox: "Needs you",
  memory: "In memory",
  routine: "Routines",
  plugin: "Plugins",
  action: "Do",
  session: "Sessions",
  match: "Messages",
  content: "Code",
  project: "Projects",
  space: "Workspaces",
};

export function groupOf(item: PaletteItem): PaletteGroup {
  return GROUP_OF[item.kind];
}

/// How many rows of a group show before the reader types anything.
export const PER_GROUP = 4;

/// The rows to draw: filtered by the query, then gathered under their group in
/// the fixed order, and with nothing typed only the first few of each group so
/// the box opens on a map of what is here rather than on a wall.
export function arrange(items: PaletteItem[], query: string): PaletteItem[] {
  const rows = matchItems(items, query);
  const rank = (item: PaletteItem) => GROUPS.indexOf(groupOf(item));
  // Array#sort is stable, so within a group the caller's order survives.
  const grouped = [...rows].sort((a, b) => rank(a) - rank(b));
  if (query.trim()) return grouped;

  const seen = new Map<PaletteGroup, number>();
  return grouped.filter((item) => {
    const group = groupOf(item);
    const n = (seen.get(group) ?? 0) + 1;
    seen.set(group, n);
    return n <= PER_GROUP;
  });
}

/// The name "Create an agent called …" would use for a query that matched
/// nothing, or `null` for a query that is not a name (empty, or `>` actions mode).
export function suggestedName(query: string): string | null {
  const name = query.trim();
  if (!name || isActionMode(name)) return null;
  return name.slice(0, 60);
}

/// A note's file name as a title: `pricing-pro.md` is "Pricing pro".
export function noteTitle(file: string): string {
  const words = file.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : file;
}
