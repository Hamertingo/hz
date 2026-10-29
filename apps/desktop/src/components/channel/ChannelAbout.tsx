import { Bell, Check, Layers, LogOut, MoreHorizontal, Pencil, Send, Share2, Star, Users, X } from "lucide-react";
import { useState } from "react";

import AgentTile from "@/components/AgentTile";
import Dither from "@/components/Dither";
import { Chip, Group, Row, Section, UnderlineTabs, Val } from "@/components/kit/kit";
import { ChannelTile } from "@/components/sidebar/ConvRow";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { setChannelMember, updateChannel } from "@/hooks/useChannels";
import { CLI } from "@/lib/cli";
import { sortTasks } from "@/lib/channels";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { Channel, Me, Task } from "@/types/events";

type Tab = "tasks" | "members" | "about";

const glass = "grid size-[30px] cursor-pointer place-items-center rounded-full bg-black/32 text-white backdrop-blur-[10px] transition-colors hover:bg-black/50 [&_svg]:size-[18px]";

/// A channel's profile docked beside its feed: banner in the lead's colour, the hash tile on its edge, and
/// Tasks, Members and About under the same underline tabs an agent's profile uses.
export default function ChannelAbout({
  channel,
  members,
  tasks,
  onOpenProfile,
  onOpenChat,
  onAddMember,
  onOpenTask,
  onEdit,
  onLeave,
  onClose,
}: {
  channel: Channel;
  me?: Me;
  members: RosterAgent[];
  tasks: Task[];
  onOpenProfile: (agentId: string) => void;
  onOpenChat?: (agentId: string) => void;
  onAddMember: () => void;
  onOpenTask: (task: Task) => void;
  onEdit?: () => void;
  onLeave?: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("tasks");
  const lead = members.find((m) => m.id === channel.lead) ?? members[0];
  const ordered = sortTasks(tasks);
  const done = ordered.filter((t) => t.status === "done").length;
  const color = lead?.color ?? "#a58bfa";
  const fail = (e: unknown) => toast(String(e));

  const remove = (m: RosterAgent) => {
    if (channel.members.length === 1) return toast("A channel needs at least one agent");
    void setChannelMember(channel.id, m.id, false)
      .then(() => toast(`${m.name} left #${channel.name}`, { action: { label: "Undo", onClick: () => void setChannelMember(channel.id, m.id, true).catch(fail) }, ms: 6000 }))
      .catch(fail);
  };

  return (
    <aside className="relative h-full w-[330px] shrink-0 overflow-hidden border-l border-line bg-background max-lg:hidden">
      <div className="relative h-full w-[330px] overflow-y-auto px-4 pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="pointer-events-none sticky top-0 z-[4] -mb-[50px] flex h-[50px] justify-end gap-1 pt-2.5 [&>*]:pointer-events-auto">
          <button
            type="button"
            aria-label="Share"
            className={glass}
            onClick={() => {
              void navigator.clipboard?.writeText(`hz://channel/${channel.id}`).catch(() => {});
              toast("Link copied");
            }}
          >
            <Share2 />
          </button>
          <button type="button" aria-label="Close channel info" className={glass} onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="relative -mx-4 h-24 overflow-hidden">
          <Dither color={color} seed={channel.name} cols={140} rows={34} />
        </div>
        <div className="relative z-[2] -mt-[42px] flex flex-col items-center gap-px text-center">
          <span className="grid rounded-[28px] bg-background p-[5px]">
            <ChannelTile color={color} size={70} lead={lead} className="[&>span]:bg-background" />
          </span>
          <h3 className="mt-[5px] text-[17px] font-semibold tracking-[-0.015em]">#{channel.name}</h3>
          <div className="px-2.5 text-[12.5px] text-ink3">{channel.purpose.length > 70 ? `${channel.purpose.slice(0, 70)}…` : channel.purpose}</div>
        </div>
        <div className="mb-3.5 mt-2.5 flex flex-wrap justify-center gap-1.5">
          <Chip>
            <Users />
            {members.length} {members.length === 1 ? "agent" : "agents"}
          </Chip>
          {lead && <Chip dot="go">{lead.name} leads</Chip>}
        </div>

        <UnderlineTabs
          className="-mx-4 justify-center px-4"
          value={tab}
          onChange={setTab}
          options={[
            { value: "tasks", label: "Tasks" },
            { value: "members", label: "Members" },
            { value: "about", label: "About" },
          ]}
        />

        {tab === "tasks" && (
          <>
            <Section title="Tasks" count={`${done} of ${ordered.length}`} />
            <Group>
              {ordered.map((t) => (
                <button key={t.id} type="button" onClick={() => onOpenTask(t)} className="flex min-h-11 w-full cursor-pointer items-start gap-2.5 px-3 py-[9px] text-left transition-colors hover:bg-s2">
                  <span
                    className={cn(
                      "mt-px grid size-[17px] shrink-0 place-items-center rounded-full",
                      t.status === "done" ? "bg-green text-white" : "border-[1.25px] border-dashed border-ink4",
                    )}
                  >
                    {t.status === "done" && <Check className="size-2.5" strokeWidth={3} />}
                  </span>
                  <span className={cn("min-w-0 flex-1 text-[13px] font-medium leading-snug", t.status === "done" && "text-ink3 line-through decoration-ink4")}>{t.title}</span>
                </button>
              ))}
              {ordered.length === 0 && <div className="px-3 py-2.5 text-[12.5px] text-ink3">No tasks yet. The agents add them as they plan the work.</div>}
            </Group>
          </>
        )}

        {tab === "members" && (
          <>
            <Section title="Agents" count={members.length} action="Add" onAction={onAddMember} />
            <Group>
              {members.map((m) => (
                <Row
                  key={m.id}
                  bareLead
                  lead={<AgentTile id={m.id} kind={m.kind} color={m.color} shape={m.shape} look={m.look} photo={m.photo} size={34} />}
                  title={m.name}
                  sub={`${m.role} · ${CLI[m.harness]?.label ?? m.harness}`}
                  onClick={() => onOpenProfile(m.id)}
                  right={
                    <>
                      {channel.lead === m.id && <span className="rounded-[5px] bg-s3 px-1.5 text-[11px] leading-[18px] font-medium text-ink2">Lead</span>}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button asChild variant="ghost" size="icon-xs" aria-label={`More for ${m.name}`}>
                            <span onClick={(e) => e.stopPropagation()}>
                              <MoreHorizontal />
                            </span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => void updateChannel(channel.id, { lead: m.id }).then(() => toast(`${m.name} leads #${channel.name}`)).catch(fail)}>
                            <Star /> Make lead
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => (onOpenChat ?? onOpenProfile)(m.id)}>
                            <Send /> Open chat
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => remove(m)}>
                            <X /> Remove from channel
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  }
                />
              ))}
            </Group>
          </>
        )}

        {tab === "about" && (
          <>
            <Section title="Purpose" />
            <Group>
              <div className="px-3 py-2.5">
                <p className="text-[13px] leading-[1.55]">{channel.purpose || "No purpose yet."}</p>
              </div>
            </Group>
            <Section title="Settings" />
            <Group>
              <Row lead={<Pencil />} title="Edit channel" right={<Val kind="next" />} onClick={onEdit} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="w-full text-left">
                    <Row lead={<Layers />} title="Rounds" sub="How many times agents answer each other before waiting for you." right={<Val kind="down">{channel.rounds}</Val>} className="hover:bg-s2" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuLabel className="px-[9px] py-1 text-[11px] font-medium text-ink4">Rounds</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={String(channel.rounds)} onValueChange={(v) => void updateChannel(channel.id, { rounds: Number(v) }).catch(fail)}>
                    {[1, 2, 3].map((n) => (
                      <DropdownMenuRadioItem key={n} value={String(n)}>
                        {n}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Row lead={<Bell />} title="Mute" right={<Switch checked={channel.muted} onCheckedChange={(muted) => void updateChannel(channel.id, { muted }).catch(fail)} aria-label="Mute" />} />
              <Row lead={<LogOut />} title="Leave channel" red onClick={onLeave} />
            </Group>
          </>
        )}
      </div>
    </aside>
  );
}
