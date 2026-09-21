import { describe, expect, it } from "vitest";

import { HITS_PER_KIND, SCOPES, searchHits, type SearchSources } from "@/lib/search";
import type { ContentMatch, FileMatch, SessionIndexItem, TranscriptMatch } from "@/types/events";

const session = (over: Partial<SessionIndexItem> = {}): SessionIndexItem =>
  ({
    sessionId: "s1",
    title: "Fix the fan-out",
    projectPath: "/Users/h/Coding/hz",
    ...over,
  }) as SessionIndexItem;

const message = (over: Partial<TranscriptMatch> = {}): TranscriptMatch => ({
  sessionId: "s1",
  seq: 4,
  title: "Fix the fan-out",
  snippet: "…the model name shortened the field…",
  ...over,
});

const file = (over: Partial<FileMatch> = {}): FileMatch => ({
  path: "/repo/src/lib/model.ts",
  name: "model.ts",
  dir: "src/lib",
  ...over,
});

const code = (over: Partial<ContentMatch> = {}): ContentMatch => ({
  path: "/repo/src/lib/model.ts",
  relative: "src/lib/model.ts",
  line: 42,
  text: "const slug = publisherless(name)",
  ...over,
});

const sources = (over: Partial<SearchSources> = {}): SearchSources => ({
  sessions: [],
  messages: [],
  files: [],
  code: [],
  ...over,
});

describe("searchHits", () => {
  /// Nothing typed is no search, and `All` is what the reader meets.
  it("is empty for a query that is only space", () => {
    expect(searchHits(sources({ sessions: [session()] }), "   ", "all")).toEqual([]);
    expect(SCOPES[0].id).toBe("all");
  });

  /// **Sessions first, then what was said, then names, then lines** — so switching
  /// a scope never reshuffles the rows a reader was already looking at.
  it("keeps one order across every scope", () => {
    const hits = searchHits(
      sources({
        sessions: [session({ title: "model work" })],
        messages: [message({ snippet: "about the model" })],
        files: [file({ name: "model.ts" })],
        code: [code()],
      }),
      "model",
      "all",
    );
    expect(hits.map((hit) => hit.kind)).toEqual(["session", "message", "file", "code"]);
  });

  it("narrows to one kind, and nothing else", () => {
    const all = sources({
      sessions: [session({ title: "model work" })],
      messages: [message({ snippet: "about the model" })],
      files: [file({ name: "model.ts" })],
      code: [code()],
    });
    expect(searchHits(all, "model", "code").map((h) => h.kind)).toEqual(["code"]);
    expect(searchHits(all, "model", "files").map((h) => h.kind)).toEqual(["file"]);
  });

  /// A session is found by its title *or* by its project, because a reader looking
  /// for "the hz work" types neither the whole path nor the exact title.
  it("finds a session by its project as well as its title", () => {
    const hits = searchHits(sources({ sessions: [session()] }), "hz", "all");
    expect(hits).toHaveLength(1);
    // And the row's meta is the project's last segment, not the whole path.
    expect(hits[0]).toMatchObject({ kind: "session", meta: "hz" });
  });

  it("marks which session a message was said in", () => {
    const [hit] = searchHits(sources({ messages: [message()] }), "model", "all");
    expect(hit).toMatchObject({ kind: "message", meta: "Fix the fan-out" });
    // Two hits in one session are two rows, so the id carries the position too.
    expect(hit.id).toBe("s1:4");
  });

  /// **The row is the line**, and the meta says where that line is.
  it("draws a code hit as the line, with where it is beside it", () => {
    const [hit] = searchHits(sources({ code: [code()] }), "publisher", "all");
    expect(hit).toMatchObject({
      kind: "code",
      title: "const slug = publisherless(name)",
      meta: "src/lib/model.ts:42",
      line: 42,
    });
  });

  /// Per kind, not per list: one word in a lockfile is a thousand lines, and a cap
  /// on the whole list would let it bury the session the reader wanted.
  it("caps each kind on its own", () => {
    const many = Array.from({ length: 40 }, (_, i) => code({ line: i + 1 }));
    const hits = searchHits(sources({ code: many, sessions: [session({ title: "model" })] }), "model", "all");
    expect(hits.filter((hit) => hit.kind === "code")).toHaveLength(HITS_PER_KIND);
    expect(hits.filter((hit) => hit.kind === "session")).toHaveLength(1);
  });
});
