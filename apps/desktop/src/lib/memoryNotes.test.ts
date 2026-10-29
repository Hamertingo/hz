import { describe, expect, it } from "vitest";

import {
  composeNote,
  filterNotes,
  noteFileName,
  parseNote,
  tagCounts,
  toNote,
  withFront,
} from "./memoryNotes";

const raw = `---
tag: Decision
by: agent
learned: 2026-10-23
source: "Fechado: R$ 89"
---
# Pricing — plano Pro

R$ 89 com teto de 100h.
`;

describe("note front matter", () => {
  it("reads the pairs and leaves the body", () => {
    const { front, body } = parseNote(raw);
    expect(front).toEqual([
      ["tag", "Decision"],
      ["by", "agent"],
      ["learned", "2026-10-23"],
      ["source", "Fechado: R$ 89"],
    ]);
    expect(body.startsWith("# Pricing")).toBe(true);
  });

  it("round-trips through compose", () => {
    const { front, body } = parseNote(raw);
    expect(composeNote(front, body)).toBe(raw);
  });

  it("leaves a plain note, and a fence around prose, alone", () => {
    expect(parseNote("# Plain\n\ntext")).toEqual({ front: [], body: "# Plain\n\ntext" });
    const rule = "---\nsome prose\n---\nrest";
    expect(parseNote(rule).front).toEqual([]);
  });

  it("sets and removes one key without moving the others", () => {
    const { front } = parseNote(raw);
    const retagged = withFront(front, "tag", "Project");
    expect(retagged[0]).toEqual(["tag", "Project"]);
    expect(withFront(front, "tag", null).some(([k]) => k === "tag")).toBe(false);
    expect(withFront([], "by", "you")).toEqual([["by", "you"]]);
  });
});

describe("note tabs", () => {
  const note = (name: string, tag: string | null, body = "text") =>
    toNote(name, tag ? `---\ntag: ${tag}\n---\n# ${name}\n\n${body}` : `# ${name}\n\n${body}`, 1);
  const notes = [note("a.md", "Decision"), note("b.md", "About you", "números antes de opinião"), note("c.md", "Project"), note("d.md", null), note("e.md", "Project")];

  it("counts each tag, and an untagged note only under All", () => {
    expect(tagCounts(notes)).toEqual({ all: 5, you: 1, project: 2, decision: 1 });
  });

  it("filters by tab and by search over title, summary and body", () => {
    expect(filterNotes(notes, "project", "").map((n) => n.name)).toEqual(["c.md", "e.md"]);
    expect(filterNotes(notes, "all", "OPINIÃO").map((n) => n.name)).toEqual(["b.md"]);
    expect(filterNotes(notes, "decision", "opinião")).toEqual([]);
  });

  it("takes a title and a summary from the body", () => {
    const n = toNote("x.md", "# Como o Gabriel decide\n\n- Quer **números** antes de opinião.\n", 5);
    expect(n.title).toBe("Como o Gabriel decide");
    expect(n.summary).toBe("Quer números antes de opinião.");
    expect(n.tag).toBeNull();
  });

  it("finds a free file name", () => {
    expect(noteFileName("New note", new Set())).toBe("new-note.md");
    expect(noteFileName("New note", new Set(["new-note.md", "new-note-2.md"]))).toBe("new-note-3.md");
    expect(noteFileName("Preço — Pro!", new Set())).toBe("preco-pro.md");
  });
});
