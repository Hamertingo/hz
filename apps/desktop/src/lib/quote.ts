/// The longest quotation kept. Past this the quote is a document, and the agent
/// can read the file it came from in one tool call instead of paying for it in
/// every turn of the session.
export const MAX_QUOTE_CHARS = 4_000;

/// A quoted run as markdown, one `>` line each.
///
/// A blockquote rather than a marker of our own: the agent already reads it as
/// quotation, the transcript already renders it as one, and nothing has to be
/// taught to either end. Blank lines inside the selection are dropped — a quote
/// of code with a gap in it reads as two quotes.
export function quoteBlock(quote: string): string {
  const collapsed = collapse(quote);
  const lines = collapsed
    .slice(0, MAX_QUOTE_CHARS)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const body = lines.length ? lines : [collapsed.trim()];
  const clipped = collapsed.length > MAX_QUOTE_CHARS ? [...body, "…"] : body;
  return clipped.map((line) => `> ${line}`).join("\n");
}

/// Whitespace squeezed: runs of spaces and tabs to one space, three or more
/// newlines to two. What a selection out of a rendered answer looks like — the
/// browser gives the *drawn* text back, indentation and all.
function collapse(text: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/// Writes a quotation into the draft at the caret, as a blockquote, and answers
/// where the caret goes.
///
/// **A quotation is text, not a chip beside the text.** It reads as the words it
/// is — in the composer, in the transcript and to the agent — and the sentence
/// the reader writes underneath it is the comment. A blockquote is the one
/// construct the composer's scanner reads as a block, so the pill the reader sees
/// under the caret is the same run the sent bubble draws.
///
/// **The quote starts its own block.** A `>` only opens a blockquote at the start
/// of a line, so writing one after a half-finished sentence — `see > one` — is a
/// quote that is not one, in the composer and for the agent alike. A paragraph
/// break in front of it costs a blank line and keeps the reader's own sentence
/// where it was.
///
/// And a blank line after it: the comment goes under the quote, which is where
/// the caret is left.
export function insertQuote(
  text: string,
  caret: number,
  quote: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const lead = before && !before.endsWith("\n") ? "\n\n" : "";
  const inserted = `${lead}${quoteBlock(quote)}\n\n`;

  return {
    text: `${before}${inserted}${text.slice(caret)}`,
    caret: before.length + inserted.length,
  };
}
