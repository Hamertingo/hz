import { formatBytes } from "@/lib/format";
import type { Attachment } from "@/types/events";

/// The glyph that marks an attachment in the draft. A paperclip, and it is a
/// *character in the text* rather than a drawn icon — which is the only kind of
/// icon a textarea can hold, and the reason the whole chip is a run of text
/// rather than an element beside it.
export const ATTACHMENT_MARK = "📎";

/// An attachment is a **word in the draft**, and this is its spelling.
///
/// A chip drawn beside the text is a second thing next to the message; a chip
/// *in* the text is part of the message, which is what t3code's composer does and
/// what yours should feel like. The textarea cannot hold a picture, so what goes
/// in is a token — a paperclip, the file's name, and its size — and the pill is
/// painted around it by the composer's mirror.
///
/// **The size rides in the text, and that is a choice.** t3's chip shows it, and
/// the only place a textarea can show it is the token. It costs a few characters
/// of the prompt the model reads, which is the right price for a chip that says
/// what it holds — and `hasToken` matches the name alone, so a size that changes
/// on the next attach cannot orphan the attachment.
///
/// **The name, not the path, and no `@`.** The `@` it started with read as a
/// mention — a path you can open — which an attachment's chip is not; and the
/// payload still travels as an `@path`/`Attached file:` line the way it always
/// has, so what the model receives is byte-for-byte what it received before this
/// existed, plus one size.
export function tokenFor(name: string, size?: number): string {
  return `${ATTACHMENT_MARK} ${name}${size === undefined ? "" : ` ${formatBytes(size)}`}`;
}

/// Whether a character extends a filename past the token: `a.txt` must not be
/// read out of `a.txt.bak`, and `a.txtb` is another name entirely.
///
/// **A trailing dot does not extend it**, and that is the case that matters: a
/// sentence ending in an attachment is written `📎 a.txt.`, and reading that as a
/// file called `a.txt.` would detach the attachment the moment the reader finished
/// their sentence. So a dot counts only when a name character follows it.
function extendsName(next: string | undefined, after: string | undefined): boolean {
  if (next === undefined) return false;
  if (/[\w-]/.test(next)) return true;
  return next === "." && after !== undefined && /[\w-]/.test(after);
}

/// Whether the draft still spells this attachment's token.
///
/// This is what decides whether it is sent. Deleting the chip in the text is
/// therefore *the* way to detach a file — one gesture, in the place the reader is
/// already looking, rather than a second × on a chip somewhere else.
export function hasToken(text: string, name: string): boolean {
  const token = tokenFor(name);

  for (let from = 0; ; ) {
    const at = text.indexOf(token, from);
    if (at === -1) return false;

    const end = at + token.length;
    if (!extendsName(text[end], text[end + 1])) return true;
    from = end;
  }
}

/// The attachments the draft still names. Everything the composer sends goes
/// through here, so a token the reader backspaced cannot ride along.
export function liveAttachments(text: string, attachments: readonly Attachment[]): Attachment[] {
  return attachments.filter((attachment) => hasToken(text, attachment.name));
}

/// Writes a token in at the caret and answers where the caret goes.
///
/// Spaces are added only where they are needed, so a token dropped into the
/// middle of a sentence does not fuse with the words either side of it.
export function insertToken(
  text: string,
  caret: number,
  name: string,
  size?: number,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const after = text.slice(caret);

  const lead = before && !/\s$/.test(before) ? " " : "";
  const tail = after && !/^\s/.test(after) ? " " : "";
  const inserted = `${lead}${tokenFor(name, size)}${tail}`;

  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

/// The attachment a `📎 …` run belongs to, by the name the run starts with.
///
/// **By prefix, not equality**, because the run carries the size after the name —
/// and because the reader can edit either part. The longest name wins, so a file
/// called `a.txt` never answers for a run naming `a.txt.bak`.
export function attachmentOf(
  run: string,
  attachments: readonly Attachment[],
): Attachment | null {
  const rest = run.slice(ATTACHMENT_MARK.length + 1);

  let best: Attachment | null = null;
  for (const attachment of attachments) {
    if (rest !== attachment.name && !rest.startsWith(`${attachment.name} `)) continue;
    if (!best || attachment.name.length > best.name.length) best = attachment;
  }
  return best;
}

/// The token's own text, split into the parts a chip draws differently: the
/// placeholder the file's mark is painted over, the name, and the size.
///
/// Sliced rather than re-derived, so a token the reader has edited still draws
/// from the characters that are really there.
export function tokenParts(run: string, name: string) {
  const mark = ATTACHMENT_MARK.length;
  const head = mark + 1 + name.length;
  return {
    mark: run.slice(0, mark),
    name: run.slice(mark + 1, head),
    size: run.slice(head).trim(),
  };
}

/// The attachments whose token the draft is still missing, in the order they were
/// attached. The composer inserts one for each, so every route that pins a file —
/// the `+`, a drop, a paste too large to be text — ends up in the same place: in
/// the message, at the caret.
export function tokensToInsert(text: string, attachments: readonly Attachment[]): Attachment[] {
  return attachments.filter((attachment) => !hasToken(text, attachment.name));
}

/// The size `formatBytes` writes, as it sits after an attachment's name.
///
/// Shared with the segment scanner, which is what decides how much of the draft
/// a chip covers — the two cannot disagree about where a token ends, or the chip
/// draws one thing and backspace deletes another.
export const ATTACHMENT_SIZE = /^ [\d.]+ ?(?:B|KB|MB|GB)\b/;

/// Every attachment's token in the draft, with where it sits.
///
/// Scanned by name rather than parsed, so a name with a space in it is found like
/// any other, and the size after it is taken as part of the run.
export function tokenRuns(
  text: string,
  attachments: readonly Attachment[],
): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];

  for (const attachment of attachments) {
    const token = tokenFor(attachment.name);
    for (let from = 0; ; ) {
      const at = text.indexOf(token, from);
      if (at === -1) break;

      const end = at + token.length;
      if (extendsName(text[end], text[end + 1])) {
        from = end;
        continue;
      }

      const size = ATTACHMENT_SIZE.exec(text.slice(end));
      runs.push({ start: at, end: end + (size ? size[0].length : 0) });
      from = end;
    }
  }

  return runs.sort((a, b) => a.start - b.start);
}

/// What Backspace or Delete should take out, when the caret is at an attachment.
///
/// **A chip is one thing, so it deletes as one thing.** Left as plain text, a
/// backspace took a letter off the filename and left a chip that still looked
/// attached — the reader pressed once, saw a letter go, and had to hold the key
/// down. The token goes whole, and the space it brought with it, so the sentence
/// it was written into does not close up around a gap.
///
/// `null` means the key is the field's: there is no chip here to take out.
export function tokenDeleteRange(
  text: string,
  caret: number,
  direction: "back" | "forward",
  attachments: readonly Attachment[],
): { start: number; end: number } | null {
  for (const run of tokenRuns(text, attachments)) {
    const inside =
      direction === "back"
        ? caret > run.start && caret <= run.end
        : caret >= run.start && caret < run.end;
    if (!inside) continue;

    // The space after it, where there is one: the token was written with a
    // trailing space, and leaving it behind puts two where there was one.
    const end = text[run.end] === " " ? run.end + 1 : run.end;
    return { start: run.start, end };
  }

  return null;
}

