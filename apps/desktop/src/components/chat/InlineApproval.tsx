import PermissionRequest from "@/components/chat/PermissionRequest";
import { toast } from "@/components/ui/toast";
import { kit } from "@/lib/kit";
import { toolArgument } from "@/lib/tools";
import type { RosterAgent } from "@/lib/roster";
import type { PendingAsk } from "@/lib/transcript";

type Permission = Extract<PendingAsk, { type: "permission_requested" }>;

/// A permission request as a card in the chat, where the reader is looking: what the agent wants to run,
/// and the options it offered, carried back whole. The agent is blocked until one is picked.
export default function InlineApproval({
  ask,
  agent,
  sessionId,
  onRespond,
}: {
  ask: Permission;
  agent: RosterAgent;
  /// The chat's session, for hz's own "Always allow this"; without it the card offers the agent's own option.
  sessionId?: string;
  onRespond: (optionId: string) => void;
}) {
  const title = ask.title ?? ask.displayName ?? ask.toolName;
  const said = ask.description && ask.description !== title ? ask.description : undefined;
  // A tripped safety check is asked about every time: no standing rule, hz's or the agent's own, may answer it.
  const floor = ask.decisionReasonType === "safetyCheck";
  const remember =
    sessionId && !floor
      ? () =>
          kit.alwaysAllow(sessionId, ask.requestId).then(
            (label) => toast(`${label} for ${agent.name}`),
            (e) => {
              toast(String(e));
              throw e;
            },
          )
      : undefined;

  return (
    <div className="chat-rise">
      <PermissionRequest
        who={agent.name}
        description={title}
        detail={said}
        argument={toolArgument(ask.input)}
        options={floor ? ask.options.filter((o) => o.kind !== "always_rule") : ask.options}
        onRespond={onRespond}
        onAlwaysAllow={remember}
      />
    </div>
  );
}
