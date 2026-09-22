import { parseSlashCommand } from "@/lib/slash";
import type { SessionSnapshot } from "@/types/events";

/// Whether the CLI is rewriting the conversation into a summary right now.
///
/// **Derived from the prompt this app sent, because the wire carries nothing for
/// it.** mcode's ACP vocabulary is twelve `sessionUpdate` kinds — message and
/// thought chunks, tool calls, plans, usage, modes, commands — and a compaction
/// is not among them. Measured against the shipped agent, not assumed: its whole
/// ACP package emits those twelve and no more, and the internal
/// `session.compaction.completed` bus event it does have is projected onto the
/// wire as a plain `usage_update`, which is what moves the context ring.
///
/// What the wire *does* carry is the result. `/compact` is one of the CLI's own
/// commands, the runtime answers it with the counts as text —
/// `Compaction completed.` / `Messages: 42 → 11` / `Tokens: 310,442 → 12,004` —
/// and that lands in the transcript as ordinary assistant prose. So the numbers
/// need nothing from the app; the *wait* is what does. It is seconds on a small
/// conversation and minutes on a full one, and until this it drew nothing.
///
/// A module of its own rather than a helper inside `useSessions`, so the rule can
/// be driven by a test — this app's tests run without a DOM, and `useSessions`
/// reaches for `document` on the way in.

/// True while the newest prompt named the command and the turn is still open.
///
/// `/compact` is a prompt like any other — the turn stays open until the CLI has
/// finished rewriting — so "the newest prompt is that command and the session is
/// busy" is exactly that window. Reading the app's own record of what it sent is
/// the same move `UserMessage` makes to draw a command's chip, for the same
/// reason: the CLI never echoes a prompt back, so this is the only account there
/// is.
///
/// Two things this cannot see. The compaction the runtime runs **by itself**
/// before an LLM call, which happens inside an ordinary turn where the working
/// indicator is already up; and a `/compact` typed into a *queued* prompt, which
/// is not sent yet and so is nobody's wait.
export function compactingOf(session: SessionSnapshot | null, busy: boolean): boolean {
  if (!busy || !session) return false;
  for (let i = session.events.length - 1; i >= 0; i--) {
    const p = session.events[i].payload;
    if (p.type === "user_message") return parseSlashCommand(p.text)?.name === "compact";
  }
  return false;
}
