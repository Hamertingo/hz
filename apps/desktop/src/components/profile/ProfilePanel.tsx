import { Share2, X } from "lucide-react";

import AgentTile from "@/components/AgentTile";
import ComputerTab from "@/components/computer/ComputerTab";
import EngineMark from "@/components/EngineMark";
import Dither from "@/components/Dither";
import { Chip, UnderlineTabs } from "@/components/kit/kit";
import ProfileDetails from "@/components/profile/ProfileDetails";
import ProfileLibrary from "@/components/profile/ProfileLibrary";
import { toast } from "@/components/ui/toast";
import { useActivity } from "@/hooks/useAgentProfile";
import { CLI } from "@/lib/cli";
import type { RosterAgent } from "@/lib/roster";

type Tab = "details" | "library" | "computer";

/// Where a caller opens the profile: the page it came from, mapped onto the panel's tabs by App.
export type ProfileTab = "overview" | "memory" | "access" | "activity" | "computer";

const glass = "grid size-[30px] cursor-pointer place-items-center rounded-full bg-black/32 text-white backdrop-blur-[10px] transition-colors hover:bg-black/50 [&_svg]:size-[18px]";

/// An agent's profile docked beside its chat: banner, face, engine, then Details, Library and Computer.
/// Every control writes the same roster entry the rest of the app reads.
export default function ProfilePanel({
  agent,
  working,
  tab,
  onTab,
  onChange,
  onClose,
  onEditLook,
  onEdit,
  onRoutines,
  onOpenChat,
}: {
  agent: RosterAgent;
  working: boolean;
  tab: Tab;
  onTab: (t: Tab) => void;
  onChange: (next: RosterAgent) => void;
  onClose: () => void;
  onEditLook: () => void;
  onEdit: () => void;
  onRoutines?: () => void;
  onOpenChat?: () => void;
}) {
  const scan = useActivity(agent.id, null);
  const cli = CLI[agent.harness];

  return (
    <aside className="relative h-full w-[330px] shrink-0 overflow-hidden border-l border-line bg-background" style={{ ["--tint" as string]: agent.color }}>
      <div key={agent.id} className="relative h-full w-[330px] overflow-y-auto px-4 pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="pointer-events-none sticky top-0 z-[4] -mb-[50px] flex h-[50px] justify-end gap-1 pt-2.5 [&>*]:pointer-events-auto">
          <button
            type="button"
            aria-label="Share"
            className={glass}
            onClick={() => {
              void navigator.clipboard?.writeText(`hz://agent/${agent.id}`).catch(() => {});
              toast("Link copied");
            }}
          >
            <Share2 />
          </button>
          <button type="button" aria-label="Close" className={glass} onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="relative -mx-4 h-24 overflow-hidden">
          <Dither color={agent.color} seed={agent.id} cols={140} rows={34} />
        </div>
        <div className="relative z-[2] -mt-[42px] flex flex-col items-center gap-px text-center">
          <button type="button" onClick={onEditLook} aria-label="Edit look" className="grid cursor-pointer place-items-center rounded-[28px] bg-background p-[5px] outline-none">
            <AgentTile id={agent.id} kind={agent.kind} color={agent.color} shape={agent.shape} look={agent.look} photo={agent.photo} pose={working ? "work" : "idle"} size={70} />
          </button>
          <h3 className="mt-[5px] text-[17px] font-semibold tracking-[-0.015em]">{agent.name}</h3>
          {agent.role && <div className="text-[12.5px] text-ink3">{agent.role}</div>}
        </div>
        <div className="mb-3.5 mt-2.5 flex flex-wrap justify-center gap-1.5">
          <Chip>
            <EngineMark harness={agent.harness} />
            {cli?.label ?? agent.harness}
          </Chip>
          <Chip dot="go">{working ? "Working" : "Free"}</Chip>
        </div>

        <UnderlineTabs
          className="-mx-4 justify-center px-4"
          value={tab}
          onChange={onTab}
          options={[
            { value: "details", label: "Details" },
            { value: "library", label: "Library" },
            { value: "computer", label: "Computer" },
          ]}
        />

        {tab === "details" && <ProfileDetails agent={agent} scan={scan} onChange={onChange} onEdit={onEdit} onRoutines={onRoutines} />}
        {tab === "library" && <ProfileLibrary agent={agent} scan={scan} onOpenNote={() => {}} onChat={onOpenChat ?? onClose} />}
        {tab === "computer" && <ComputerTab agent={agent} />}
      </div>
    </aside>
  );
}
