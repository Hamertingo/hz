import { Plus, X } from "lucide-react";

import AgentTile from "@/components/AgentTile";
import { StatusDot } from "@/components/channel/ChannelRows";
import MeAvatar from "@/components/MeAvatar";
import { toast } from "@/components/ui/toast";
import { setChannelMember } from "@/hooks/useChannels";
import { DragGhost, useDragReorder } from "@/hooks/useDragReorder";
import { TASK_LABEL, sortTasks } from "@/lib/channels";
import { cn } from "@/lib/utils";
import type { RosterAgent } from "@/lib/roster";
import type { Channel, Me, Task } from "@/types/events";

const H4 = "mt-6 mb-2.5 flex items-center text-xs font-medium text-ink3 first:mt-0";

/// The column beside the feed: what the channel is for, who leads, who is in it,
/// its tasks and the rules it runs by.
export default function ChannelAbout({
  channel,
  me,
  members,
  tasks,
  onOpenProfile,
  onAddMember,
  onOpenTask,
  onClose,
}: {
  channel: Channel;
  me: Me;
  members: RosterAgent[];
  tasks: Task[];
  onOpenProfile: (agentId: string) => void;
  onAddMember: () => void;
  onOpenTask: (task: Task) => void;
  onClose: () => void;
}) {
  const lead = members.find((m) => m.id === channel.lead) ?? members[0];
  const ordered = sortTasks(tasks);
  const dnd = useDragReorder();
  /// Dragging a member out of the list takes it out of the channel; Undo puts it back.
  const removeMember = (m: RosterAgent) => {
    void setChannelMember(channel.id, m.id, false)
      .then(() =>
        toast(`${m.name} removed from #${channel.name}`, {
          action: { label: "Undo", onClick: () => void setChannelMember(channel.id, m.id, true).catch((e) => toast(String(e))) },
          ms: 6000,
        }),
      )
      .catch((e) => toast(String(e)));
  };
  return (
    <aside className="scrollbar-overlay hidden w-72 flex-none overflow-y-auto border-l border-line px-[18px] py-5 lg:block">
      <div className="mb-2.5 flex items-center">
        <h4 className={cn(H4, "m-0")}>About</h4>
        <button type="button" onClick={onClose} aria-label="Close channel info" className="ml-auto grid size-6 cursor-pointer place-items-center rounded-(--r1) text-ink3 transition-colors hover:bg-hover hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      <p className="text-[13px] leading-[1.55] text-ink2">{channel.purpose || "No purpose yet."}</p>

      {lead && (
        <>
          <h4 className={H4}>Lead</h4>
          <button
            type="button"
            onClick={() => onOpenProfile(lead.id)}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-(--r2) py-1.5 text-left transition-colors hover:bg-hover"
          >
            <AgentTile id={lead.id} kind={lead.kind} color={lead.color} size={26} />
            <div>
              <div className="text-[13px] font-medium">{lead.name}</div>
              <div className="text-[11.5px] text-ink3">
                {channel.mode === "turns" ? "starts each message" : channel.mode === "lead" ? "decides who answers" : "answers when nobody is named"}
              </div>
            </div>
          </button>
        </>
      )}

      <h4 className={H4}>
        Members · {members.length + 1}
        <button
          type="button"
          onClick={onAddMember}
          aria-label="Add a member"
          className="ml-auto grid size-5 cursor-pointer place-items-center rounded-(--r1) text-ink3 transition-colors hover:bg-hover hover:text-ink"
        >
          <Plus className="size-3" />
        </button>
      </h4>
      <div className="flex items-center gap-2.5 py-1.5 text-[13px]">
        <MeAvatar me={me} size={26} />
        <span>{me.name || "You"}</span>
        <span className="ml-auto text-[11.5px] text-ink4">Owner</span>
      </div>
      <div data-drag-zone="members">
      {members.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onOpenProfile(m.id)}
          data-dragging={dnd.drag?.id === m.id || undefined}
          {...dnd.bind({
            kind: "member",
            id: m.id,
            accepts: [],
            zone: "members",
            ghost: (
              <span className="flex items-center gap-2.5 text-[13px]">
                <AgentTile id={m.id} kind={m.kind} color={m.color} size={26} />
                {m.name}
              </span>
            ),
            onDrop: ({ outside }) => outside && removeMember(m),
          })}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-(--r2) py-1.5 text-left text-[13px] transition-colors hover:bg-hover data-[dragging]:opacity-40"
        >
          <AgentTile id={m.id} kind={m.kind} color={m.color} size={26} />
          <span>{m.name}</span>
          <span className="ml-auto max-w-28 truncate text-[11.5px] text-ink4">{m.role}</span>
        </button>
      ))}
      </div>
      <DragGhost kinds={["member"]} />
      {dnd.drag?.kind === "member" && dnd.drag.outside && (
        <p className="mt-1 text-[11.5px] text-ink3">Release to remove from the channel.</p>
      )}

      <h4 className={H4}>Tasks</h4>
      {ordered.length === 0 && <p className="text-[13px] text-ink4">No open tasks.</p>}
      {ordered.map((t) => {
        const owner = members.find((m) => m.id === t.owner);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpenTask(t)}
            className="flex w-full cursor-pointer gap-2.5 border-t border-line py-2.5 text-left"
          >
            {owner && <AgentTile id={owner.id} kind={owner.kind} color={owner.color} size={22} />}
            <div className="min-w-0">
              <div className="truncate text-[13px]">{t.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink3">
                <StatusDot status={t.status} />
                {TASK_LABEL[t.status]}
              </div>
            </div>
          </button>
        );
      })}

      <h4 className={H4}>Rules</h4>
      <p className="text-xs leading-[1.55] text-ink2">
        Up to {channel.rounds} {channel.rounds === 1 ? "round" : "rounds"} per message. Each agent answers once per
        round. Publishing and merging ask you.
      </p>
    </aside>
  );
}
