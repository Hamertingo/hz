import { describe, expect, it } from "vitest";

import { insertQuote, quoteBlock } from "@/lib/quote";

describe("quoteBlock", () => {
  /// The shape the agent reads and the transcript draws. A blockquote is already
  /// both — nothing here has to teach either end a marker of our own.
  it("draws one quoted line per line", () => {
    expect(quoteBlock("one\ntwo")).toBe("> one\n> two");
  });

  /// A selection out of a *rendered* answer comes back with the layout's own
  /// whitespace: indentation, trailing spaces, and blank lines between blocks.
  /// Carried through, a quote of two paragraphs is four lines of which two are
  /// empty and the composer's box is twice the height it needs to be.
  it("squeezes the whitespace a rendered answer hands back", () => {
    expect(quoteBlock("  the   words  \n\n\n  carry on  ")).toBe("> the words\n> carry on");
  });

  /// A quotation past the cap is a document, and the agent has tools for those.
  /// The ellipsis is there so a clipped quote cannot read as a complete one.
  it("caps a quotation and says it was clipped", () => {
    const block = quoteBlock("x".repeat(5_000));
    expect(block.length).toBeLessThan(5_000);
    expect(block.endsWith("> …")).toBe(true);
  });
});

describe("insertQuote", () => {
  /// At the caret, like an attachment's token: the quote lands where the reader
  /// is writing, which is the whole difference from a chip above the box.
  it("writes the blockquote at the caret", () => {
    expect(insertQuote("then ", 5, "the words")).toEqual({
      text: "then \n\n> the words\n\n",
      caret: 20,
    });
  });

  /// The blank line is where the comment goes — the reader writes it under the
  /// quote, and the caret is already there.
  it("leaves the caret on the line under the quote", () => {
    const written = insertQuote("", 0, "quoted");
    expect(written.text).toBe("> quoted\n\n");
    expect(written.text.slice(0, written.caret)).toBe("> quoted\n\n");
  });

  /// **A `>` only opens a blockquote at the start of a line.** Written inline
  /// after a half-finished sentence it is a quote that is not one — in the
  /// composer, in the transcript and for the agent — so the quote takes its own
  /// paragraph and the reader's sentence stays where it was.
  it("starts its own block rather than fusing with the sentence", () => {
    expect(insertQuote("see", 3, "this")).toEqual({
      text: "see\n\n> this\n\n",
      caret: 13,
    });
    // Already at the start of a line: nothing to break.
    expect(insertQuote("see\n", 4, "this")).toEqual({ text: "see\n> this\n\n", caret: 12 });
  });

  /// The round trip the transcript depends on: what is written has to come back
  /// as quote runs, or a quote sent is drawn as prose with chevrons in it.
  it("survives being read back as segments", () => {
    const written = insertQuote("do this\n", 8, "one\ntwo");
    const quoted = written.text.split("\n").filter((line) => line.startsWith("> "));
    expect(quoted).toEqual(["> one", "> two"]);
  });
});
