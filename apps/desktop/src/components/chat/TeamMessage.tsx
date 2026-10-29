import AgentTile from "@/components/AgentTile";
import TeamLine from "@/components/chat/TeamLine";
import { useAgentChatActions } from "@/hooks/useAgentChat";
import { useMe } from "@/hooks/useMe";
import { openSheet } from "@/lib/chatSheets";
import { useRoster } from "@/lib/roster";
import { talkWords } from "@/lib/teamTalk";
import type { ToolResult } from "@/types/events";
import type { JsonValue } from "@/types/serde_json/JsonValue";

/// One call to the team's own tools, drawn as what it is: an agent speaking to
/// another one, not a tool with arguments. `team_message` is "Sent a message to
/// Viktor", which opens their thread; `team_list` is plain text, since looking
/// someone up is not a conversation.
export default function TeamMessage({
  tool,
  input,
  result,
  ts,
}: {
  tool: "team_message" | "team_ask" | "team_list";
  input: JsonValue;
  result: ToolResult | undefined;
  ts: string;
}) {
  const roster = useRoster();
  const chat = useAgentChatActions();
  const words = talkWords(useMe().language);

  if (tool === "team_list") {
    return (
      <p className="my-2 text-center text-ui text-muted-foreground">
        {result ? "Looked up the team" : "Looking up the team…"}
      </p>
    );
  }

  const args = (typeof input === "object" && input !== null && !Array.isArray(input)
    ? input
    : {}) as Record<string, unknown>;
  const to = typeof args.to === "string" ? args.to : "a teammate";
  const text = typeof args.text === "string" ? args.text : "";
  // The backend's own rule (`talk::match_name`): exact first, then a unique start.
  const q = to.trim().replace(/^@/, "").toLowerCase();
  const starts = roster.agents.filter((a) => a.name.toLowerCase().startsWith(q));
  const agent = roster.agents.find((a) => a.name.toLowerCase() === q) ?? (starts.length === 1 ? starts[0] : undefined);

  const failed = result?.isError === true;
  // Only an old log has an answer here: `team_ask` used to wait for one, and its
  // result was "<Name> answered:\n\n<their words>". It returns at once now.
  const reply =
    tool === "team_ask" && result && !failed && /^[^:\n]+ answered:\n\n/.test(result.text)
      ? result.text.replace(/^[^:\n]+ answered:\n\n/, "")
      : undefined;

  const toName = agent?.name ?? to;
  // In an agent's chat the line is the quiet record and the thread opens in a sheet.
  const inChat = chat !== null && !failed;
  const open = !inChat || !chat
    ? undefined
    : reply !== undefined
      ? () => openSheet({ kind: "exchange", from: chat.agent.name, to: toName, ask: text, answer: reply, ts })
      : agent
        ? () => openSheet({ kind: "thread", a: chat.agent.id, b: agent.id })
        : undefined;
  const lead = failed ? words.failed : reply !== undefined ? words.asked : result ? words.sent : words.sending;

  return (
    <TeamLine
      onOpen={open}
      lead={lead}
      reply={reply}
      face={agent && <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={18} />}
      name={toName}
      body={text}
      busy={!result}
      error={failed ? (result?.text ?? "") : null}
    />
  );
}
