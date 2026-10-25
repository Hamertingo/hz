/// The edits the composer's formatting row makes to a draft, as one pure function
/// so the arithmetic is tested without a textarea.

export type FormatKind =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "codeblock"
  | "link"
  | "bullet"
  | "numbered"
  | "quote";

export type Edit = { text: string; start: number; end: number };

/// `text` with `kind` applied to the selection `[start, end)`, and where the
/// selection should sit afterwards.
///
/// **Inline marks wrap, and a selection already wrapped comes back off** — the
/// second press of Bold is undo, which is what every editor teaches. Line marks
/// (lists, quote) act on every line the selection touches. With nothing selected
/// an inline mark opens an empty pair with the caret between, ready to type in.
export function applyFormat(text: string, start: number, end: number, kind: FormatKind): Edit {
  const wraps: Partial<Record<FormatKind, [string, string]>> = {
    bold: ["**", "**"],
    italic: ["*", "*"],
    strike: ["~~", "~~"],
    code: ["`", "`"],
  };

  const pair = wraps[kind];
  if (pair) {
    const [open, close] = pair;
    const before = text.slice(0, start);
    const chosen = text.slice(start, end);
    const after = text.slice(end);

    if (before.endsWith(open) && after.startsWith(close)) {
      return {
        text: before.slice(0, -open.length) + chosen + after.slice(close.length),
        start: start - open.length,
        end: end - open.length,
      };
    }
    return {
      text: before + open + chosen + close + after,
      start: start + open.length,
      end: end + open.length,
    };
  }

  if (kind === "codeblock") {
    const chosen = text.slice(start, end);
    const block = `\`\`\`\n${chosen}\n\`\`\``;
    return {
      text: text.slice(0, start) + block + text.slice(end),
      start: start + 4,
      end: start + 4 + chosen.length,
    };
  }

  if (kind === "link") {
    const chosen = text.slice(start, end) || "text";
    const link = `[${chosen}](https://)`;
    const urlAt = start + chosen.length + 3;
    return {
      text: text.slice(0, start) + link + text.slice(end),
      start: urlAt,
      end: urlAt + "https://".length,
    };
  }

  // A line mark: from the start of the first line touched to the end of the last.
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEndAt = text.indexOf("\n", end);
  const lineEnd = lineEndAt === -1 ? text.length : lineEndAt;
  const lines = text.slice(lineStart, lineEnd).split("\n");

  const prefixed = lines.map((line, i) => {
    if (kind === "bullet") return `- ${line}`;
    if (kind === "numbered") return `${i + 1}. ${line}`;
    return `> ${line}`;
  });
  const block = prefixed.join("\n");

  return {
    text: text.slice(0, lineStart) + block + text.slice(lineEnd),
    start: lineStart,
    end: lineStart + block.length,
  };
}
