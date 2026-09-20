import { describe, expect, it } from "vitest";

import {
  hasToken,
  insertToken,
  liveAttachments,
  tokenDeleteRange,
  tokenFor,
  tokenParts,
  tokensToInsert,
} from "@/lib/attachmentToken";
import type { Attachment } from "@/types/events";

function file(name: string): Attachment {
  return { path: `/tmp/${name}`, name, mimeType: null, size: 10, isImage: false, preview: null };
}

describe("hasToken", () => {
  it("finds the token wherever it sits in the draft", () => {
    expect(hasToken("look at 📎 shot.png please", "shot.png")).toBe(true);
    expect(hasToken("📎 shot.png", "shot.png")).toBe(true);
    expect(hasToken("nothing here", "shot.png")).toBe(false);
  });

  /// A name that is a prefix of another must not answer for it, or backspacing
  /// `📎 a.txt` out of `📎 a.txt.bak` would send a file the draft no longer names.
  it("does not read a token out of a longer word", () => {
    expect(hasToken("📎 a.txt.bak", "a.txt")).toBe(false);
    expect(hasToken("📎 a.txts", "a.txt")).toBe(false);
    expect(hasToken("📎 a.txt.", "a.txt")).toBe(true);
    expect(hasToken("📎 a.txt and 📎 a.txt", "a.txt")).toBe(true);
  });
});

describe("insertToken", () => {
  /// At the caret, which is the whole point: the chip lands where the reader is
  /// typing rather than on a row of its own somewhere above the box.
  it("writes at the caret", () => {
    expect(insertToken("hello world", 5, "a.png")).toEqual({
      text: "hello 📎 a.png world",
      caret: 14,
    });
  });

  it("adds only the spaces it needs", () => {
    expect(insertToken("", 0, "a.png")).toEqual({ text: "📎 a.png", caret: 8 });
    expect(insertToken("look ", 5, "a.png")).toEqual({ text: "look 📎 a.png", caret: 13 });
    // The caret lands right after the token — or after the space it brought with
    // it — so the reader keeps typing after the chip rather than into it.
    expect(insertToken(" look", 0, "a.png")).toEqual({ text: "📎 a.png look", caret: 8 });
  });
});

describe("liveAttachments", () => {
  /// **Deleting the chip is detaching the file.** The text is the record; the
  /// store only carries what the token points at.
  it("sends only what the draft still names", () => {
    const attachments = [file("a.png"), file("b.png")];
    expect(liveAttachments("see 📎 a.png and 📎 b.png", attachments)).toEqual(attachments);
    expect(liveAttachments("see 📎 a.png", attachments)).toEqual([file("a.png")]);
    expect(liveAttachments("nothing", attachments)).toEqual([]);
  });
});

describe("tokensToInsert", () => {
  /// One rule for every route in — the `+`, a drop, a paste that became a file —
  /// so a file that is pinned but not yet written into the draft gets its token
  /// exactly once, and a restored attachment does not get a second one.
  it("answers the ones the draft is missing", () => {
    const attachments = [file("a.png"), file("b.png")];
    expect(tokensToInsert("see 📎 a.png", attachments)).toEqual([file("b.png")]);
    expect(tokensToInsert("see 📎 a.png and 📎 b.png", attachments)).toEqual([]);
    expect(tokensToInsert("", attachments)).toEqual(attachments);
  });

  it("spells a token as a mark, a name and a size", () => {
    expect(tokenFor("my file.txt", 1_240_000)).toBe("📎 my file.txt 1.2 MB");
    expect(hasToken("look at 📎 my file.txt 1.2 MB ok", "my file.txt")).toBe(true);
    // A size that moves on the next attach must not orphan the attachment: the
    // name alone is what is matched.
    expect(hasToken("📎 my file.txt 9 KB", "my file.txt")).toBe(true);
  });
});

describe("tokenParts", () => {
  /// Sliced out of the run the reader actually has, so a chip still draws when
  /// the token has been edited — and the mark, the name and the size are the
  /// three things the chip draws differently.
  it("splits a run into the parts a chip draws", () => {
    expect(tokenParts("📎 a.png 12 KB", "a.png")).toEqual({
      mark: "📎",
      name: "a.png",
      size: "12 KB",
    });
    expect(tokenParts("📎 a.png", "a.png")).toEqual({ mark: "📎", name: "a.png", size: "" });
  });
});


describe("tokenDeleteRange", () => {
  const attachments = [file("a.txt"), file("long-name.md")];
  const text = "look 📎 a.txt 12 KB and 📎 long-name.md 4 KB please";

  /// **A chip is one thing, so it deletes as one thing** — from anywhere in the
  /// run, and with the size it carries.
  it("takes the whole token, from anywhere in it", () => {
    const at = text.indexOf("📎 a.txt");
    for (const caret of [at + 1, at + 4, at + "📎 a.txt 12 KB".length]) {
      const range = tokenDeleteRange(text, caret, "back", attachments);
      expect(range).toEqual({ start: at, end: at + "📎 a.txt 12 KB ".length });
    }
  });

  /// Forward deletes the same run, so Delete-from-before behaves like Backspace
  /// from inside.
  it("takes it forwards from in front of it", () => {
    const at = text.indexOf("📎 long-name.md");
    expect(tokenDeleteRange(text, at, "forward", attachments)).toEqual({
      start: at,
      end: at + "📎 long-name.md 4 KB ".length,
    });
  });

  /// Anywhere else the key is the field's, and the caret moves as it always did.
  it("is the field's key everywhere else", () => {
    expect(tokenDeleteRange(text, 2, "back", attachments)).toBeNull();
    expect(tokenDeleteRange(text, text.length, "back", attachments)).toBeNull();
    expect(tokenDeleteRange("", 0, "back", attachments)).toBeNull();
  });
});
