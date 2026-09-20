import { describe, expect, it } from "vitest";

import { clearStash, popStash, stashDraft } from "@/hooks/useStash";
import type { Attachment } from "@/types/events";

const FILE = { path: "/tmp/a.txt", name: "a.txt", isImage: false } as Attachment;

describe("useStash", () => {
  /// An empty box is not a draft. Counting one would put a badge on screen that
  /// restores nothing, and the reader would learn the badge means nothing.
  it("refuses to stash an empty draft", () => {
    expect(stashDraft("empty", { text: "   ", attachments: [] })).toBe(false);
    expect(popStash("empty")).toBeNull();
  });

  /// The newest comes back first: a stash is a pile of things put aside in
  /// order, and the one you put down last is the one you were in the middle of.
  it("hands the newest back first", () => {
    expect(stashDraft("pile", { text: "first", attachments: [] })).toBe(true);
    expect(stashDraft("pile", { text: "second", attachments: [FILE] })).toBe(true);

    expect(popStash("pile")).toEqual({ text: "second", attachments: [FILE] });
    expect(popStash("pile")).toEqual({ text: "first", attachments: [] });
    expect(popStash("pile")).toBeNull();
  });

  /// Two composers, two piles. An attachment path belongs to the session it was
  /// pinned in, so a stash leaking across a switch would hand one session a file
  /// the other was holding.
  it("keeps one composer's pile out of another's", () => {
    stashDraft("a", { text: "for a", attachments: [] });
    stashDraft("b", { text: "for b", attachments: [] });

    expect(popStash("a")).toEqual({ text: "for a", attachments: [] });
    expect(popStash("b")).toEqual({ text: "for b", attachments: [] });
  });

  /// Deleting a session takes its stash with it: the attachments it names are
  /// deleted alongside, so a restored draft would point at files that are gone.
  it("forgets a composer when asked to", () => {
    stashDraft("gone", { text: "text", attachments: [] });
    clearStash("gone");
    expect(popStash("gone")).toBeNull();
  });
});
