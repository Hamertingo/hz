import { describe, expect, it } from "vitest";

import {
  exportFileName,
  fenceForEmbedding,
  sessionExportMeta,
  sessionToJson,
  sessionToMarkdown,
} from "./export";
import type { AgentEvent, AgentEventPayload, SessionIndexItem } from "@/types/events";

/// A minimal event.
///
/// **The payload is typed `object`, not the union it becomes.** These tests are
/// about what the export does with an event, and spelling out every field a
/// variant requires would make this factory fail on each addition to the wire
/// instead of testing anything — which is the same reason the cast is here once
/// rather than at every call.
function event(seq: number, payload: object, over: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: `e${seq}`,
    sessionId: "s",
    harness: "mcode",
    seq,
    ts: `2026-09-27T00:00:0${seq}.000Z`,
    turnId: null,
    subagent: null,
    payload: payload as AgentEventPayload,
    ...over,
  } as AgentEvent;
}

const PROMPT = event(1, {
  type: "user_message",
  text: "fix the thing",
  images: [],
  issues: [],
});

const CALL = event(2, {
  type: "tool_call_started",
  callId: "c1",
  name: "Edit",
  toolType: "file_edit",
  input: { file_path: "src/lib/x.ts" },
});

const DONE = event(3, {
  type: "turn_completed",
  status: "completed",
  stopReason: "end_turn",
  finalText: "Done.",
  usage: null,
  durationMs: 1_200,
  authFailed: false,
});

const META = {
  title: "A session",
  project: "/repo",
  branch: "feat/x",
  worktree: null,
  model: "MiniMax-M2.7",
};

describe("sessionToJson", () => {
  it("is byte-identical across two runs over the same log", () => {
    // The requirement the format exists for: an export is something a reader
    // diffs against yesterday's.
    const events = [PROMPT, CALL, DONE];
    expect(sessionToJson(events)).toBe(sessionToJson(events));
  });

  it("sorts object keys, so insertion order cannot leak into the bytes", () => {
    const a = event(1, { type: "user_message", text: "t", images: [], issues: [] });
    const b = event(1, { issues: [], images: [], text: "t", type: "user_message" });

    expect(sessionToJson([a])).toBe(sessionToJson([b]));
  });

  it("ends on a newline, so a shell prompt does not land on the last line", () => {
    expect(sessionToJson([PROMPT]).endsWith("}\n")).toBe(true);
  });

  it("writes one line per event, which is what the parser reads", () => {
    // The property the whole format exists for: every line parses on its own, so
    // a session exported from here can be read back by the app that wrote it.
    const lines = sessionToJson([PROMPT, CALL, DONE]).trimEnd().split("\n");

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("writes nothing at all for a session with no events", () => {
    // An empty file rather than a line reading `[]`: there is no such event, and
    // a parser would have to have a case for one.
    expect(sessionToJson([])).toBe("");
  });
});

describe("sessionToMarkdown", () => {
  it("carries the session's own stamps and no wall clock", () => {
    const out = sessionToMarkdown([PROMPT, CALL, DONE], META);

    expect(out).toContain("title: A session");
    expect(out).toContain("branch: feat/x");
    expect(out).toContain("from: 2026-09-27T00:00:01.000Z");
    expect(out).toContain("to: 2026-09-27T00:00:03.000Z");
    // The property a wall clock would break, and the only one worth asserting:
    // every stamp in here comes from the log, so two exports of one session are
    // the same bytes.
    expect(sessionToMarkdown([PROMPT, CALL, DONE], META)).toBe(out);
  });

  it("leaves out a fact it was not given rather than writing an empty one", () => {
    const out = sessionToMarkdown([PROMPT], { ...META, worktree: null, model: null });

    expect(out).not.toContain("worktree:");
    expect(out).not.toContain("model:");
  });

  it("names the prompt, the work and the answer", () => {
    const out = sessionToMarkdown([PROMPT, CALL, DONE], META);

    expect(out).toContain("fix the thing");
    expect(out).toContain("`Edit` · src/lib/x.ts");
    expect(out).toContain("Done.");
  });
});

describe("fenceForEmbedding", () => {
  it("uses three backticks for ordinary content", () => {
    expect(fenceForEmbedding("plain")).toBe("```\nplain\n```");
  });

  it("outgrows a fence inside the content, so the block cannot close early", () => {
    // An agent quoting markdown — a diff of a README — is an ordinary thing to
    // export, and a three-backtick wrapper would end at its first line.
    const out = fenceForEmbedding("```\ninner\n```");
    expect(out.startsWith("````\n")).toBe(true);
    expect(out.endsWith("\n````")).toBe(true);
  });
});

/// An index entry with only the fields the frontmatter reads. Cast, for the
/// factory's own reason: this file tests the export, not the index's shape.
function item(over: Partial<SessionIndexItem> = {}): SessionIndexItem {
  return {
    sessionId: "s1",
    title: "Fix the thing",
    projectPath: "/repo",
    branch: "feat/x",
    worktreeName: null,
    model: "MiniMax-M2.7",
    ...over,
  } as SessionIndexItem;
}

describe("sessionExportMeta", () => {
  it("reads every fact off the entry", () => {
    expect(sessionExportMeta(item({ worktreeName: "keen-jade" }))).toEqual({
      title: "Fix the thing",
      project: "/repo",
      branch: "feat/x",
      worktree: "keen-jade",
      model: "MiniMax-M2.7",
    });
  });

  it("falls back to the id for a session the app has not named", () => {
    expect(sessionExportMeta(item({ title: "" })).title).toBe("s1");
  });

  it("says nothing where the entry knows nothing", () => {
    // An empty string would print `project:` with a blank after it, which reads
    // as a fact that failed rather than one that is not there.
    const meta = sessionExportMeta(item({ projectPath: "", model: "" }));
    expect(meta.project).toBeNull();
    expect(meta.model).toBeNull();
  });
});

describe("exportFileName", () => {
  it("names the file after the session", () => {
    expect(exportFileName("Fix the thing", "md")).toBe("Fix the thing.md");
  });

  it("replaces what a filesystem refuses", () => {
    // A slash would put the file in a directory that is not there.
    expect(exportFileName("a/b:c*d?e", "json")).toBe("a b c d e.json");
  });

  it("flattens a newline, which no dialog can show", () => {
    expect(exportFileName("first\nsecond", "md")).toBe("first second.md");
  });

  it("drops a leading dot, which would hide the file", () => {
    expect(exportFileName("...secret", "md")).toBe("secret.md");
  });

  it("falls back where sanitising left nothing", () => {
    // A title of pure punctuation is not a filename.
    expect(exportFileName("///", "md")).toBe("session.md");
    expect(exportFileName("   ", "md")).toBe("session.md");
  });

  it("caps a title that is a paragraph", () => {
    const name = exportFileName("x".repeat(300), "md");
    expect(name.length).toBeLessThanOrEqual(83);
    expect(name.endsWith(".md")).toBe(true);
  });
});
