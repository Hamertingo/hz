import AgentTile from "@/components/AgentTile";
import TeamLine from "@/components/chat/TeamLine";
import { useAgentChatActions } from "@/hooks/useAgentChat";
import { useMe } from "@/hooks/useMe";
import { openSheet } from "@/lib/chatSheets";
import { useRoster } from "@/lib/roster";
import { talkWords } from "@/lib/teamTalk";
import type { MessageSender } from "@/types/events";

/// A teammate's words arriving in this chat: an answer to a message sent from
/// here ("Answer from Viktor"), or, in an old log, a message relayed straight in.
/// Both open the thread the two keep.
export default function TeamReceived({
  from,
  text,
  ts,
  answer = false,
}: {
  from: MessageSender;
  text: string;
  ts: string;
  answer?: boolean;
}) {
  const roster = useRoster();
  const chat = useAgentChatActions();
  const words = talkWords(useMe().language);
  const sender =
    roster.agents.find((a) => a.sessionId === from.sessionId) ??
    roster.agents.find((a) => a.name === from.title);

  const open = !chat
    ? undefined
    : answer && sender
      ? () => openSheet({ kind: "thread", a: chat.agent.id, b: sender.id })
      : () => openSheet({ kind: "exchange", from: from.title, to: chat.agent.name, ask: text, answer: null, ts });

  return (
    <TeamLine
      onOpen={open}
      lead={answer ? words.answer : words.message}
      face={sender && <AgentTile id={sender.id} kind={sender.kind} color={sender.color} size={18} />}
      name={from.title}
      body={text}
    />
  );
}
