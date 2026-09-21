import { useMemo } from "react";

import Chat from "@/components/Chat";
import type { QueuedPrompt, Working } from "@/hooks/useSessions";
import type { AgentEvent, SessionSnapshot } from "@/types/events";

/// A child cannot be sent into, so there is never a held prompt to draw — and a
/// fresh `[]` per render would be a new prop on every event of the parent's turn.
const NO_PROMPTS: QueuedPrompt[] = [];

/// A child's thinking is read whole by the poll rather than streamed a delta at a
/// time, so nothing here can count its tokens. Zero is what the parent's chat
/// shows until the first usage update lands, which is the same reading.
const NO_TOKENS: Working = { tokens: 0 };

/// A delegated child's conversation, drawn by the chat that draws every other
/// conversation.
///
/// **Nothing here is bespoke, and that is the whole of it.** This is the main
/// chat pointed at a child — same rows, same groups, same diffs, same markdown,
/// same checkpoint rail, same backfill — because it *is* `Chat`, handed a session
/// shaped out of the child's own events. A second renderer drifts from the first
/// the day either moves, which is what the panel this replaced had done.
///
/// What makes it read-only is what is *not* given to it: there is no composer, so
/// an ask a child could raise is drawn in the transcript rather than beside a
/// composer — `active` false, the branch an unfocused split pane takes. The
/// chat's own chords go with it, since a view that cannot send, stop or answer is
/// not one to bind them from.
type SubagentChatProps = {
  /// The session the child belongs to. A child has no `cwd` and no project of its
  /// own, so the parent's are what a file link in the child's answer resolves
  /// against.
  parent: SessionSnapshot;
  /// The child's own session on the agent's side, which is what every read and
  /// every cache behind this view is keyed by.
  memberSessionId: string;
  /// The child's own events, read while it runs.
  events: AgentEvent[];
  /// Still going, per the roster. Decides the pending-ness of its open calls and
  /// whether the working indicator draws.
  live: boolean;
  /// The brief the spawning call carried, drawn only where there is no transcript
  /// to draw instead — a child with nothing read yet, or one this build cannot
  /// read at all.
  brief: string | null;
  /// The rail dims when the panes have taken the width, the same reading the
  /// transcript takes.
  crowded: boolean;
  onOpenSession: (sessionId: string) => void;
};

export default function SubagentChat({
  parent,
  memberSessionId,
  events,
  live,
  brief,
  crowded,
  onOpenSession,
}: SubagentChatProps) {
  // The parent's own record with the child's two fields swapped in — the id it is
  // keyed by and the events it is drawn from. `Chat` reads no other field off a
  // session, so what travels along is the parent's because the child has none of
  // its own: it is not a session this app made, it is one the agent did.
  const session = useMemo(
    () => ({ ...parent, sessionId: memberSessionId, events }),
    [parent, memberSessionId, events],
  );

  // A child with nothing read yet has no turn to draw, and the brief is the whole
  // of what the reader opened this to read in that window.
  if (events.length === 0) return <Nothing brief={brief} live={live} />;

  return (
    <Chat
      session={session}
      // Deltas never reach here: a child's work is read by the poll, whole.
      streamingBlock={null}
      // A child's own subagents are not addressable from here — the roster that
      // names them belongs to the session that delegated this one, and a guess
      // would open somebody else's work.
      onOpenSubagent={() => {}}
      onOpenSession={onOpenSession}
      // A delegated child's asks are not answerable from here: the request lived
      // on the child's own connection and this app holds no way to reply to it.
      // Drawn anyway — a blocked child with nothing on screen would be worse — and
      // the sidebar row is where its standing is read.
      onRespondPermission={() => {}}
      onAnswerQuestions={() => {}}
      onCancelQuestion={() => {}}
      busy={live}
      working={live ? NO_TOKENS : null}
      backgroundTaskCount={0}
      compacting={false}
      apiRetry={null}
      queuedMessages={NO_PROMPTS}
      crowded={crowded}
      active={false}
    />
  );
}

/// What is on screen before the first read lands.
///
/// The brief where the spawning call carried one, and otherwise one sentence
/// saying which of the two waits this is: a child being read, or a child whose
/// work this build cannot see.
function Nothing({ brief, live }: { brief: string | null; live: boolean }) {
  return (
    // The transcript's own measure and padding, so the first read landing does
    // not move the text sideways.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        {brief ? (
          <p className="whitespace-pre-wrap text-chat text-sidebar-foreground">{brief}</p>
        ) : (
          <p className="text-chat text-muted-foreground/70">
            {live ? "Reading what it is working on…" : "Nothing was recorded for this subagent."}
          </p>
        )}
      </div>
    </div>
  );
}
