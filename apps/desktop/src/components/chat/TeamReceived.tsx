import Mascot from "@/components/Mascot";
import TeamLine from "@/components/chat/TeamLine";
import { useAgentChatActions } from "@/hooks/useAgentChat";
import { openSheet } from "@/lib/chatSheets";
import { useRoster } from "@/lib/roster";
import type { MessageSender } from "@/types/events";

/// A teammate's message, as the agent that received it sees it in the
/// transcript: the same line the sender draws, from the other end.
export default function TeamReceived({
  from,
  text,
  ts,
}: {
  from: MessageSender;
  text: string;
  ts: string;
}) {
  const roster = useRoster();
  const chat = useAgentChatActions();
  const sender =
    roster.agents.find((a) => a.sessionId === from.sessionId) ??
    roster.agents.find((a) => a.name === from.title);

  return (
    <TeamLine
      onOpen={
        chat
          ? () =>
              openSheet({
                kind: "exchange",
                from: from.title,
                to: chat.agent.name,
                ask: text,
                answer: null,
                ts,
              })
          : undefined
      }
      lead="Message from"
      face={sender && <Mascot kind={sender.kind} color={sender.color} size={18} />}
      name={from.title}
      ts={ts}
      body={text}
    />
  );
}
