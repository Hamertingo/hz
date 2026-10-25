import type { ReplyTo } from "@/types/events";

/// How much of a quoted message the composer, the sent message and the agent's
/// copy carry. One line is enough to recognise the message, and a longer one
/// would make a short answer look smaller than the quote above it.
export const QUOTE_MAX = 110;

/// `text` as the single line a quote shows: whitespace collapsed, cut with an
/// ellipsis at `max`.
export function quoteLine(text: string, max: number = QUOTE_MAX): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 2).trimEnd()}…` : line;
}

/// The Reply target for a message: where it is, what it said and whose it is.
/// `agent` is the roster id of the one who said it, or `"me"`.
export function replyTo(seq: number, text: string, agent: string): ReplyTo {
  return { seq, text: quoteLine(text), agent };
}

/// The agent a reply addresses, or `null` for a reply to the reader's own words.
///
/// This is what lets a reply in a channel go to the agent whose message it
/// quotes: the address is data on the prompt rather than something to parse out
/// of `@name` prose.
export function addressedAgent(reply: ReplyTo | null | undefined): string | null {
  if (!reply || reply.agent === "me") return null;
  return reply.agent;
}

/// The marker `data-msg-seq` that the jump looks a message up by.
export function seqSelector(seq: number): string {
  return `[data-msg-seq="${seq}"]`;
}
