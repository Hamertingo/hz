import type { MessageSender } from "@/types/events";

/// The line `attribute` in `orchestration.rs` puts in front of a relayed
/// prompt, rebuilt verbatim from the sender the event already names.
///
/// Rebuilt, never parsed. A regex over the text would have to guess where the
/// line ends, and a title holding a bracket or a reworded prefix would break it
/// *silently* — taking part of what was actually said with it. Building the
/// exact string from the same `MessageSender` the backend built it from can
/// only fail the safe way: no match, nothing stripped, the line stays drawn.
export function senderPrefix(from: MessageSender): string {
  return `[message from the Hyze Code session "${from.title}" (${from.sessionId})]\n\n`;
}

/// The relayed text as the reader wants it — the sender's line taken off.
///
/// The prefix is for the receiving *agent*, which has no channel but the prompt
/// text. The reader has the `from` field drawn above the bubble instead, so the
/// same fact spelled out again in the first line is noise on their side.
export function stripSenderPrefix(text: string, from: MessageSender | null | undefined): string {
  if (!from) return text;

  const prefix = senderPrefix(from);
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/// What `team_message` wraps a teammate's words in, rebuilt from the sender the
/// event names — the same bargain as [`senderPrefix`], and for the same reason:
/// built, never parsed, so a name holding a bracket can only fail by stripping
/// nothing. The Rust side that writes these is `team.rs`; the two must agree.
export function teamPrefix(from: MessageSender): string {
  return `[message from your teammate ${from.title}]\n\n`;
}

export function teamSuffix(from: MessageSender): string {
  return `\n\n(Answer with team_message to ${from.title} if a reply is needed.)`;
}

/// The wrapper's ending when the teammate *asked* and is waiting on the answer.
export function teamAskSuffix(from: MessageSender): string {
  return `\n\n(Answer directly: your answer goes back to ${from.title}. Do not use team_message to answer.)`;
}

/// The teammate's own words, or `null` when this relayed text is not one of
/// theirs (a `hz send` from another session, say).
export function teamBody(text: string, from: MessageSender | null | undefined): string | null {
  if (!from) return null;

  const prefix = teamPrefix(from);
  if (!text.startsWith(prefix)) return null;

  const rest = text.slice(prefix.length);
  for (const suffix of [teamSuffix(from), teamAskSuffix(from)]) {
    if (rest.endsWith(suffix)) return rest.slice(0, -suffix.length);
  }
  return rest;
}
