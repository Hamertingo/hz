import Mascot from "@/components/Mascot";
import TeamLine from "@/components/chat/TeamLine";
import { useAgentChatActions } from "@/hooks/useAgentChat";
import { openSheet } from "@/lib/chatSheets";
import { useRoster } from "@/lib/roster";
import type { ToolResult } from "@/types/events";
import type { JsonValue } from "@/types/serde_json/JsonValue";

/// One call to the team's own tools, drawn as what it is: an agent speaking to
/// another one, not a tool with arguments. `team_message` is a line naming who it
/// went to; `team_list` is plain text, since looking someone up is not a
/// conversation.
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
  const agent = roster.agents.find((a) => a.name.toLowerCase() === to.toLowerCase());

  const failed = result?.isError === true;
  const asking = tool === "team_ask";
  // The ask's result is "<Name> answered:\n\n<their words>"; the line shows the
  // words, since the name is already in the sentence.
  const reply =
    asking && result && !failed ? result.text.replace(/^[^:\n]+ answered:\n\n/, "") : undefined;
  const lead = failed
    ? "Couldn't ask"
    : asking
      ? result
        ? "Asked"
        : "Waiting on"
      : result
        ? "Message sent to"
        : "Sending to";

  const toName = agent?.name ?? to;
  // In an agent's chat the line is the quiet record and the words open in a sheet.
  const inChat = chat !== null && !failed;

  return (
    <TeamLine
      self={
        inChat && chat && (
          <>
            <Mascot kind={chat.agent.kind} color={chat.agent.color} size={18} />
            <span className="font-medium text-foreground">{chat.agent.name}</span>
          </>
        )
      }
      meta={inChat ? (reply ? "2 messages" : "1 message") : undefined}
      onOpen={
        inChat && chat && text
          ? () =>
              openSheet({
                kind: "exchange",
                from: chat.agent.name,
                to: toName,
                ask: text,
                answer: reply ?? null,
                ts,
              })
          : undefined
      }
      lead={inChat ? (asking ? (result ? "asked" : "is waiting on") : result ? "messaged" : "is sending to") : failed && !asking ? "Couldn't send to" : lead}
      reply={reply}
      face={agent && <Mascot kind={agent.kind} color={agent.color} size={18} />}
      name={agent?.name ?? to}
      ts={ts}
      body={text}
      busy={!result}
      error={failed ? (result?.text ?? "") : null}
    />
  );
}
