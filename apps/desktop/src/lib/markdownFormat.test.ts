import { describe, expect, it } from "vitest";

import { applyFormat } from "./markdownFormat";

describe("applyFormat", () => {
  it("wraps a selection, and a second press takes the marks back off", () => {
    const on = applyFormat("say hello now", 4, 9, "bold");
    expect(on.text).toBe("say **hello** now");
    expect(on.text.slice(on.start, on.end)).toBe("hello");

    const off = applyFormat(on.text, on.start, on.end, "bold");
    expect(off.text).toBe("say hello now");
  });

  it("opens an empty pair with the caret inside when nothing is selected", () => {
    const edit = applyFormat("a ", 2, 2, "code");
    expect(edit.text).toBe("a ``");
    expect(edit.start).toBe(3);
    expect(edit.end).toBe(3);
  });

  it("puts a block of code on its own lines around the selection", () => {
    const edit = applyFormat("run ls", 4, 6, "codeblock");
    expect(edit.text).toBe("run ```\nls\n```");
    expect(edit.text.slice(edit.start, edit.end)).toBe("ls");
  });

  it("makes a link and selects the address to be typed over", () => {
    const edit = applyFormat("see docs", 4, 8, "link");
    expect(edit.text).toBe("see [docs](https://)");
    expect(edit.text.slice(edit.start, edit.end)).toBe("https://");
  });

  it("prefixes every line the selection touches for lists and quotes", () => {
    expect(applyFormat("one\ntwo\nthree", 0, 7, "bullet").text).toBe("- one\n- two\nthree");
    expect(applyFormat("one\ntwo", 0, 7, "numbered").text).toBe("1. one\n2. two");
    expect(applyFormat("first\nsecond", 8, 8, "quote").text).toBe("first\n> second");
  });
});
