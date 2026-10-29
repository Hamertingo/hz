import { useState } from "react";

import { ApprovalCard } from "@/components/chat/cards";
import { useAgentChatActions } from "@/hooks/useAgentChat";
import { Button } from "@/components/ui/button";
import type { PermissionOption, PermissionOptionKind } from "@/types/events";

/// Ordered by how much they grant, which is not the order the CLI suggests them
/// in. "Allow once" reads first because it is the answer that commits to
/// nothing, and the session-wide options sit last so a fast click can't land on
/// them.
const KIND_ORDER: Record<PermissionOptionKind, number> = {
  once: 0,
  always_rule: 1,
  always_directory: 2,
  switch_mode: 3,
  deny: 4,
};

/// A tool call waiting on the user. The agent is blocked while this renders, so
/// it is the one row in the transcript that must never be purely informational.
///
/// Rendered below the transcript rather than inside a turn, which is what lets
/// one component serve both threads: a subagent's tool call is filed into the
/// panel and a main-thread one sits in a turn that collapses when it closes, so
/// neither can be relied on to be next to the question.
///
/// That is also why it carries the command itself. Nothing above it is
/// guaranteed to be on screen, and "Create a marker file" with no command under
/// it is a question about something invisible.
///
/// Purely transient: once answered it disappears, either way. The tool call it
/// belongs to reports both outcomes on its own — a refusal as its error, an
/// approval by simply running.
export default function PermissionRequest({
  who: whoGiven,
  description,
  detail,
  time,
  argument,
  options,
  onRespond,
  onAlwaysAllow,
}: {
  who?: string;
  /// The agent's own summary of the call. Filled in upstream when the harness
  /// sends none, so it is never empty.
  description: string;
  /// What the call does, under `description` when that is only its name.
  detail?: string;
  time?: string;
  /// The call's identifying argument — the command, the path. `null` only when
  /// the input carries no conventional field to show.
  argument: string | null;
  options: PermissionOption[];
  onRespond: (optionId: string) => void;
  /// hz's own standing rule for this agent. When given it stands in for the agent's own "always" option, which
  /// would grant the CLI a rule hz's reviewer never sees again.
  /// A refusal puts the buttons back, since the agent is still waiting.
  onAlwaysAllow?: () => Promise<unknown>;
}) {
  // Never cleared: the reply is one-shot in the backend, so a second click has
  // nothing to answer. This keeps the buttons from inviting one during the round
  // trip that mints the decision event.
  const [sent, setSent] = useState<string | null>(null);
  const chatAgent = useAgentChatActions()?.agent.name;
  const who = whoGiven ?? chatAgent ?? "The agent";
  const pick = (id: string) => {
    setSent(id);
    onRespond(id);
  };
  const sorted = [...options].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const once = sorted.find((o) => o.kind === "once");
  const deny = sorted.find((o) => o.kind === "deny");
  const always = sorted.find((o) => o.kind === "always_rule");
  const rest = sorted.filter((o) => o !== once && o !== deny && o !== always);

  return (
    <ApprovalCard
      who={who}
      title={description}
      detail={detail}
      time={time}
      onAlwaysAllow={
        onAlwaysAllow
          ? () => {
              setSent("always");
              onAlwaysAllow().catch(() => setSent(null));
            }
          : always
            ? () => pick(always.id)
            : undefined
      }
      command={argument ?? undefined}
      disabled={sent !== null}
      onApprove={once ? () => pick(once.id) : undefined}
      onDeny={deny ? () => pick(deny.id) : undefined}
      extra={rest.map((o) => (
        <Button key={o.id} variant="ghost" size="sm" disabled={sent !== null} className="text-ink3" onClick={() => pick(o.id)}>
          {o.label}
        </Button>
      ))}
    />
  );
}
