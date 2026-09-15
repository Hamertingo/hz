import AgentTrace from "@/components/chat/AgentTrace";

/// Thinking text, folded behind a trace header. Encrypted reasoning carries no
/// readable text at all, so it renders nothing rather than an empty block.
///
/// The live preview and the committed block wear the same shape, differing only
/// in tense — "Thinking" while it grows, "Thought" once it lands. That is the
/// one honest thing to say about a reasoning block: nobody reads it while it
/// types, and everybody wants it gone once the answer arrives.
export default function Reasoning({
  text,
  encrypted,
  streaming = false,
}: {
  text: string;
  encrypted: boolean;
  streaming?: boolean;
}) {
  const trimmed = text.trim();
  if (encrypted || !trimmed) return null;

  return (
    <AgentTrace
      active="Thinking"
      done="Thought"
      working={streaming}
      rows={[
        // Italic and dimmer than a message: this is the agent talking to itself,
        // and the moment it reads as an answer the reader has been lied to.
        <p className="whitespace-pre-wrap wrap-anywhere text-chat text-muted-foreground italic">
          {trimmed}
        </p>,
      ]}
    />
  );
}
