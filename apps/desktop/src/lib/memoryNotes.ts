/// A note's front matter and the profile page's reading of it. The Rust side
/// (`memory_mcp.rs`) writes the same block; the two must agree.

export type NoteTag = "About you" | "Project" | "Decision";
export const NOTE_TAGS: readonly NoteTag[] = ["About you", "Project", "Decision"];

export type TagTab = "all" | "you" | "project" | "decision";
export const TAG_TABS: readonly { key: TagTab; label: string; tag: NoteTag | null }[] = [
  { key: "all", label: "All", tag: null },
  { key: "you", label: "About you", tag: "About you" },
  { key: "project", label: "Projects", tag: "Project" },
  { key: "decision", label: "Decisions", tag: "Decision" },
];

export type ParsedNote = {
  /// Every `key: value` pair of the front matter, in file order.
  front: [string, string][];
  body: string;
};

function unquote(v: string): string {
  const m = /^"(.*)"$/s.exec(v);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : v;
}

/// Splits `---` front matter off a note. A fence around prose with no `key:`
/// lines is a horizontal rule and stays in the body.
export function parseNote(raw: string): ParsedNote {
  if (!raw.startsWith("---\n")) return { front: [], body: raw };
  const rest = raw.slice(4);
  const end = rest.indexOf("\n---");
  if (end < 0) return { front: [], body: raw };
  const front: [string, string][] = [];
  for (const line of rest.slice(0, end).split("\n")) {
    const at = line.indexOf(":");
    if (at < 0) return { front: [], body: raw };
    front.push([line.slice(0, at).trim(), unquote(line.slice(at + 1).trim())]);
  }
  const after = rest.slice(end + 4);
  return { front, body: after.startsWith("\n") ? after.slice(1) : after };
}

export function composeNote(front: readonly [string, string][], body: string): string {
  if (front.length === 0) return body;
  const lines = front.map(([k, v]) => {
    const flat = v.replace(/\n/g, " ");
    return /[:"#]/.test(flat) || flat !== flat.trim()
      ? `${k}: "${flat.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
      : `${k}: ${flat}`;
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

export function frontValue(front: readonly [string, string][], key: string): string | null {
  return front.find(([k]) => k === key)?.[1] ?? null;
}

/// `front` with one key set or, for an empty value, removed.
export function withFront(front: readonly [string, string][], key: string, value: string | null): [string, string][] {
  const rest = front.filter(([k]) => k !== key);
  const had = front.findIndex(([k]) => k === key);
  if (!value) return rest;
  if (had < 0) return [...rest, [key, value]];
  const out = [...rest];
  out.splice(had, 0, [key, value]);
  return out;
}

export type Note = {
  /// File name, ending in `.md`.
  name: string;
  title: string;
  /// The first sentence of the body, for the list.
  summary: string;
  tag: NoteTag | null;
  /// The tag exactly as written, for a note whose tag is not one of the three.
  rawTag: string | null;
  by: string | null;
  learned: string | null;
  source: string | null;
  body: string;
  front: [string, string][];
  modifiedMs: number;
};

export function noteTitle(body: string, name: string): string {
  const h = /^#\s+(.+)$/m.exec(body);
  return h ? h[1].trim() : name.replace(/\.md$/, "").replace(/-/g, " ");
}

export function noteSummary(body: string): string {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    return t.replace(/^[-*]\s+/, "").replace(/[*_`]/g, "").slice(0, 100);
  }
  return "";
}

export function asTag(raw: string | null): NoteTag | null {
  return NOTE_TAGS.find((t) => t.toLowerCase() === raw?.trim().toLowerCase()) ?? null;
}

export function toNote(name: string, raw: string, modifiedMs: number): Note {
  const { front, body } = parseNote(raw);
  const rawTag = frontValue(front, "tag");
  return {
    name,
    title: noteTitle(body, name),
    summary: noteSummary(body),
    tag: asTag(rawTag),
    rawTag,
    by: frontValue(front, "by"),
    learned: frontValue(front, "learned"),
    source: frontValue(front, "source"),
    body,
    front,
    modifiedMs,
  };
}

/// How many notes each tab holds.
export function tagCounts(notes: readonly Note[]): Record<TagTab, number> {
  return {
    all: notes.length,
    you: notes.filter((n) => n.tag === "About you").length,
    project: notes.filter((n) => n.tag === "Project").length,
    decision: notes.filter((n) => n.tag === "Decision").length,
  };
}

/// The notes a tab and a search keep. Search looks at title, summary and body.
export function filterNotes(notes: readonly Note[], tab: TagTab, query: string): Note[] {
  const tag = TAG_TABS.find((t) => t.key === tab)?.tag ?? null;
  const q = query.trim().toLowerCase();
  return notes.filter(
    (n) => (!tag || n.tag === tag) && (!q || `${n.title}\n${n.summary}\n${n.body}`.toLowerCase().includes(q)),
  );
}

/// A file name for a new note from its title.
export function noteFileName(title: string, taken: ReadonlySet<string>): string {
  const slug =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/, "") || "note";
  let name = `${slug}.md`;
  for (let i = 2; taken.has(name); i++) name = `${slug}-${i}.md`;
  return name;
}
