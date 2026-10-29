import AgentTile from "@/components/AgentTile";
import TeamLine from "@/components/chat/TeamLine";
import { openSheet } from "@/lib/chatSheets";
import { useMe } from "@/hooks/useMe";
import { useRoster } from "@/lib/roster";
import { talkWords, threadLines } from "@/lib/teamTalk";
import type { PairThread } from "@/types/events";

/// "3 messages with Viktor": what this agent and a teammate said in their thread
/// between two points of its chat, one line per thread, opening it read-only.
/// The thread runs in a session of its own, so this line is all of it the chat shows.
export default function ThreadLines({
  pairs,
  agentId,
  from,
  to,
}: {
  pairs: readonly PairThread[];
  agentId: string;
  /// Unix ms, exclusive.
  from: number;
  /// Unix ms, inclusive.
  to: number;
}) {
  const roster = useRoster();
  const words = talkWords(useMe().language);
  const lines = threadLines(pairs, agentId, from, to);
  if (lines.length === 0) return null;

  return (
    <>
      {lines.map((line) => {
        const other = roster.agents.find((a) => a.id === line.other);
        return (
          <TeamLine
            key={`${line.channelId}:${line.latest.seq}`}
            lead={words.with(line.count)}
            face={other && <AgentTile id={other.id} kind={other.kind} color={other.color} size={18} />}
            name={other?.name ?? "a teammate"}
            onOpen={() => openSheet({ kind: "thread", a: agentId, b: line.other })}
          />
        );
      })}
    </>
  );
}
