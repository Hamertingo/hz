import { compactTokens } from "@/lib/format";

/// How long a draft may be, and when a paste stops being text.
///
/// The agent's own limit is enforced somewhere below this app; these two are the
/// composer's, and both exist to keep one message from becoming a context window
/// the reader did not choose to spend.
///
/// **A paste becomes a file rather than a draft.** 32KiB of log in the message
/// body is tokens paid on every turn of the session, where the same bytes as a
/// file are a path the agent reads in one tool call — and it arrives in the
/// transcript as something the reader can see they attached, not as a wall of
/// text they have to scroll past to find their own sentence.
export const PASTE_AS_FILE_CHARS = 32_768;

/// The longest draft the composer will send.
///
/// Above this the send button is disabled and the line under the box says how
/// long the draft is and what to do about it. Chosen to leave room under what
/// this harness accepts: a prompt that arrives too long fails in the agent's own
/// words, a turn later, with the draft already gone from the box.
export const MAX_PROMPT_CHARS = 120_000;

/// Whether a paste is too big to become text.
export function pasteBecomesFile(pasted: string): boolean {
  return pasted.length >= PASTE_AS_FILE_CHARS;
}

/// The sentence the composer draws under a draft that is over the limit, or
/// `null` while it is fine. Both figures go through `compactTokens` for the
/// reason the context meter does: a seven-digit count is read as a shape rather
/// than as a number, and `toLocaleString` would spell it differently per machine.
export function overLimitNote(draft: string): string | null {
  if (draft.length <= MAX_PROMPT_CHARS) return null;
  return `${compactTokens(draft.length)} characters — the limit is ${compactTokens(MAX_PROMPT_CHARS)}. Cut it down, or paste the rest as a file.`;
}
