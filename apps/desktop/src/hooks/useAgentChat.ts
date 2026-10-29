import { createContext, useContext } from "react";

import type { ReplyDraft } from "@/lib/replyDraft";
import type { RosterAgent } from "@/lib/roster";

type AgentChat = {
  agent: RosterAgent;
  /// Keys the reactions, tombstones and reply targets of this chat's messages.
  sessionId: string | null;
  /// Where the agent works; a document card and Take over open here.
  cwd: string | null;
  /// Starts a reply to a message, which is what the hover bar's Reply does.
  onReply: (target: ReplyDraft) => void;
  /// Opens an agent's profile, from its face.
  onOpenProfile: (agentId: string) => void;
  /// Hands words to the routine editor.
  onRoutine: (text: string) => void;
  /// How long each tool call took, for the step list under a message.
  timings: ReadonlyMap<string, number>;
};

/// Whose conversation the transcript on screen is, when it is an agent's, and the
/// actions its messages offer.
///
/// A context for the reason [`ChatSessionContext`](./useChatSession.ts) is one:
/// the readers are leaves — the prompt row and the answer row — with `Chat` and
/// `TurnBlock` between them that would carry a value they never read. `null` is
/// an ordinary session, which keeps its bubbles and its full-width answer.
export const AgentChatContext = createContext<AgentChat | null>(null);

export function useAgentChat(): RosterAgent | null {
  return useContext(AgentChatContext)?.agent ?? null;
}

export function useAgentChatActions(): AgentChat | null {
  return useContext(AgentChatContext);
}
