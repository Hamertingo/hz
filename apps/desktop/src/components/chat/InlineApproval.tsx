import { Shield } from "lucide-react";
import { useState } from "react";

import { AgentFace } from "@/components/chat/MessageShell";
import { Button } from "@/components/ui/button";
import { openSheet } from "@/lib/chatSheets";
import type { RosterAgent } from "@/lib/roster";
import type { PendingAsk } from "@/lib/transcript";
import { approveOption, declineOption } from "@/lib/approval";
import type { PermissionOption } from "@/types/events";

type Permission = Extract<PendingAsk, { type: "permission_requested" }>;

/// A permission request as a message from the agent: it is waiting on the reader,
/// and the three answers sit in the chat where the reader is looking. Approve and
/// Not now answer the agent's own request; Open shows everything it asked.
///
/// The card in the composer's dock stays: it carries every option the agent
/// offered, and this one is the quick way to the two that matter.
export default function InlineApproval({
  ask,
  agent,
  onRespond,
}: {
  ask: Permission;
  agent: RosterAgent;
  onRespond: (optionId: string) => void;
}) {
  const [sent, setSent] = useState(false);
  const approve = approveOption(ask.options);
  const decline = declineOption(ask.options);
  const answer = (option: PermissionOption) => {
    setSent(true);
    onRespond(option.id);
  };

  return (
    <div className="-mx-3 flex gap-3 px-3 py-2.5">
      <div className="pt-0.5">
        <AgentFace agent={agent} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[13.5px] font-semibold">{agent.name}</div>
        <div className="max-w-[600px] rounded-(--r3) bg-amber/5 px-3.5 py-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--amber)_22%,transparent)]">
          <div className="flex items-center gap-2 text-[12.5px] text-ink2">
            <Shield className="size-3 text-amber" />
            <span className="min-w-0 truncate">
              Waiting for you · {ask.description ?? ask.title ?? ask.displayName ?? ask.toolName}
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {approve && (
              <Button size="sm" disabled={sent} onClick={() => answer(approve)}>
                Approve
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "approval", ask })}>
              Open
            </Button>
            {decline && (
              <Button
                size="sm"
                variant="outline"
                className="text-red"
                disabled={sent}
                onClick={() => answer(decline)}
              >
                Not now
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
