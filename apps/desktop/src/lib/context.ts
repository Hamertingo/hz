import type { AgentEvent } from "@/types/events";

/// How much of the window each part of the *conversation* holds.
///
/// **This is not the agent's own breakdown, and it cannot be.** The panel the CLI
/// draws for itself — System prompt, Tools, Skills, Messages, Memory, Other — is
/// computed inside the agent from state no ACP client is sent: the wire carries
/// `usage_update` with `used`, `size` and a cost, and nothing else (see
/// `harness/mcode/parser.rs`; the agent's extension notifications are goal, queue
/// and delegation). So what a *reader* of hz can be shown is two different kinds
/// of number, and they are kept apart on screen because they are not the same
/// kind:
///
/// - the window's fill, which is the agent's own count and is exact;
/// - these, which are the conversation's own text measured by hz, and are
///   **estimates** — a character count over four, which is the usual rule of
///   thumb and is what every part of this is labelled as.
///
/// The system prompt and the tool schemas are missing from the second set
/// entirely: they are bytes hz has never seen, which is exactly why the parts
/// below do not add up to the window's fill.
export type ContextPart = {
  key: "messages" | "toolOutput" | "reasoning";
  label: string;
  /// Estimated tokens.
  tokens: number;
  /// Share of the *window*, which is what the reader compares against its fill.
  share: number;
};

/// Characters per token, and the whole of the estimate. English prose runs
/// nearer four; code and JSON nearer three, so a transcript of tool output is
/// over-counted by this — which is the safe direction for a number whose job is
/// to say *which* part is eating the window rather than by how much.
const CHARS_PER_TOKEN = 4;

/// What each part of the conversation holds, largest first, with the parts that
/// hold nothing dropped.
///
/// `max` is the window the shares are measured against; `0` leaves every share at
/// zero, which draws no bar rather than a division by nothing.
export function contextParts(events: readonly AgentEvent[], max: number): ContextPart[] {
  const chars = { messages: 0, toolOutput: 0, reasoning: 0 };

  for (const event of events) {
    const payload = event.payload;
    switch (payload.type) {
      case "user_message":
        chars.messages += payload.text.length;
        break;
      case "assistant_text":
        chars.messages += payload.text.length;
        break;
      case "reasoning":
        chars.reasoning += payload.text.length;
        break;
      case "tool_call_started":
        // The arguments the model wrote are context it holds for the rest of the
        // session, so they are counted with what came back — one row, because a
        // reader asking "what is filling this window" is asking about the tool
        // call, not about its two halves.
        chars.toolOutput += JSON.stringify(payload.input ?? {}).length;
        break;
      case "tool_call_completed":
        chars.toolOutput += payload.result.text.length;
        break;
      default:
        break;
    }
  }

  return (
    [
      { key: "toolOutput", label: "Tool output", tokens: estimate(chars.toolOutput) },
      { key: "messages", label: "Messages", tokens: estimate(chars.messages) },
      { key: "reasoning", label: "Reasoning", tokens: estimate(chars.reasoning) },
    ] as ContextPart[]
  )
    .filter((part) => part.tokens > 0)
    .map((part) => ({ ...part, share: max > 0 ? part.tokens / max : 0 }))
    .sort((a, b) => b.tokens - a.tokens);
}

/// Tokens in a character count, rounded up so a part that holds anything holds at
/// least one.
function estimate(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}
