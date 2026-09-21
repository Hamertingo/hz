import type { ContentMatch, FileMatch, SessionIndexItem, TranscriptMatch } from "@/types/events";

/// What one search turned up, in the four kinds this app can answer with.
///
/// **The kinds are the app's own surfaces**: a session is somewhere to go, a
/// message is something that was said in one, a file is a name the reader
/// half-remembers, and a line of code is where a word actually is. They arrive
/// from three commands and one list that is already in memory, and this is the one
/// place they become one list.
export type SearchHit =
  | { kind: "session"; id: string; sessionId: string; title: string; meta: string }
  | { kind: "message"; id: string; sessionId: string; title: string; meta: string }
  | {
      kind: "file";
      id: string;
      path: string;
      title: string;
      meta: string;
    }
  | { kind: "code"; id: string; path: string; line: number; title: string; meta: string };

/// The scopes the row above the list offers, in the order they are drawn.
///
/// `all` first because it is what the reader gets, and the rest in the order a
/// search usually means them: somewhere to go, something said, a name, a line.
export type SearchScope = "all" | "sessions" | "messages" | "files" | "code";

export const SCOPES: { id: SearchScope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sessions", label: "Sessions" },
  { id: "messages", label: "Messages" },
  { id: "files", label: "Files" },
  { id: "code", label: "Code" },
];

/// What the view reads, gathered into one argument.
export type SearchSources = {
  /// The index as the sidebar holds it — the sessions are already in memory, so a
  /// search over them costs no round trip.
  sessions: readonly SessionIndexItem[];
  messages: readonly TranscriptMatch[];
  files: readonly FileMatch[];
  code: readonly ContentMatch[];
};

/// How many rows of each kind one scope draws.
///
/// Per *kind* rather than per list: a word in a lockfile can be a thousand lines
/// of code, and a cap on the whole list would let it bury the one session the
/// reader was looking for. Eight is more than anybody scrolls in a view that
/// narrows as they type.
export const HITS_PER_KIND = 8;

/// Every hit a query found, narrowed to one scope.
///
/// **Sessions first, then what was said, then names, then lines** — which is
/// `all`'s order and therefore the order the other scopes keep, so switching a
/// scope never reshuffles the rows a reader was already looking at.
///
/// Case-insensitive, like the commands behind the three quarters of it that are
/// reads: one habit, four searches.
export function searchHits(sources: SearchSources, query: string, scope: SearchScope): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const has = (text: string) => text.toLowerCase().includes(needle);
  const hits: SearchHit[] = [];

  if (scope === "all" || scope === "sessions") {
    let shown = 0;
    for (const item of sources.sessions) {
      if (shown >= HITS_PER_KIND) break;
      if (!has(item.title) && !has(item.projectPath)) continue;
      shown += 1;
      // The project as its last segment: the rest of the path is the same on every
      // row when they are all in one repository.
      const parts = item.projectPath.replace(/\/+$/, "").split("/");
      hits.push({
        kind: "session",
        id: item.sessionId,
        sessionId: item.sessionId,
        title: item.title,
        meta: parts[parts.length - 1] || item.projectPath,
      });
    }
  }

  if (scope === "all" || scope === "messages") {
    for (const hit of sources.messages.slice(0, HITS_PER_KIND)) {
      hits.push({
        kind: "message",
        id: `${hit.sessionId}:${hit.seq}`,
        sessionId: hit.sessionId,
        title: hit.snippet,
        // The session it was said in: the row after this one is that session, and
        // this says which one that is.
        meta: hit.title,
      });
    }
  }

  if (scope === "all" || scope === "files") {
    for (const hit of sources.files.slice(0, HITS_PER_KIND)) {
      hits.push({
        kind: "file",
        id: hit.path,
        path: hit.path,
        // The name, because that is what the reader typed; the directory beside it
        // is what tells two files with one basename apart.
        title: hit.name,
        meta: hit.dir,
      });
    }
  }

  if (scope === "all" || scope === "code") {
    for (const hit of sources.code.slice(0, HITS_PER_KIND)) {
      hits.push({
        kind: "code",
        id: `${hit.path}:${hit.line}`,
        path: hit.path,
        line: hit.line,
        // **The row is the line.** A match is a line of a file and a row is a line
        // of text, so the label is the line itself and the meta says where it is.
        title: hit.text,
        meta: `${hit.relative}:${hit.line}`,
      });
    }
  }

  return hits;
}
