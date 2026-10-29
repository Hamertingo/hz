import type { ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import ActivityProp from "@/components/chat/ActivityProp";
import { useMe } from "@/hooks/useMe";
import { type Activity, verbFor } from "@/lib/agentStatus";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";

/// While an agent answers: its mascot, moving the way the work looks (eyes wandering while it thinks, a quick bob
/// while it writes, scanning a screen at a computer), and one line saying what it is doing, in the reader's
/// language. A press shows the steps under it.
export default function AgentStatus({
  agent,
  activity,
  open,
  onToggle,
  children,
}: {
  agent: RosterAgent;
  activity: Activity;
  open: boolean;
  onToggle: () => void;
  /// The steps so far, shown when open.
  children?: ReactNode;
}) {
  const me = useMe();

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-steps-pill
        className="-ml-1.5 flex h-8 w-fit cursor-pointer items-center gap-2.5 rounded-full pr-2.5 pl-1.5 transition-colors hover:bg-s1"
      >
        <span className={cn("astat relative grid size-[22px] shrink-0 place-items-center", `astat-${activity}`)}>
          <AgentTile id={agent.id} kind={agent.kind} color={agent.color} shape={agent.shape} look={agent.look} photo={agent.photo} pose="idle" size={22} />
          <span key={activity} className="astat-hold">
            <ActivityProp activity={activity} />
          </span>
        </span>
        <span key={activity} className="astat-line text-[13px] leading-5">
          <span className="astat-shine">
            <b className="font-medium">{agent.name}</b> {verbFor(activity, me.language)}
          </span>
          <span className="astat-ellipsis" aria-hidden>
            <i>.</i>
            <i>.</i>
            <i>.</i>
          </span>
        </span>
      </button>
      {open && children}
    </div>
  );
}
