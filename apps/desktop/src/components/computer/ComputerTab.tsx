import { useState } from "react";

import AgentTile from "@/components/AgentTile";
import ComputerViewer from "@/components/computer/ComputerViewer";
import VmScreen, { type VmScreenDesc } from "@/components/computer/VmScreen";
import { useComputer } from "@/components/computer/useComputer";
import ComputerSizeSheet from "@/components/sheets/ComputerSizeSheet";
import type { Pose } from "@/lib/face";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";

const PAGE_OF: Record<string, VmScreenDesc["page"]> = { atlas: "docs", ada: "review", mila: "post", hugo: "sheet" };

/// What the Computer tab shows in place of a screen: the agent's mascot, asleep or busy, with a line under it.
function Mascot({ agent, pose, title, sub, onClick }: { agent: RosterAgent; pose: Pose; title: string; sub: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "flex aspect-[16/10] min-h-[200px] w-full flex-col items-center justify-center gap-1 rounded-(--r3) bg-s1 px-4 text-center shadow-[inset_0_0_0_1px_var(--line)] transition-colors",
        onClick && "cursor-pointer hover:bg-s2",
      )}
    >
      <AgentTile id={agent.id} kind={agent.kind} color={agent.color} shape={agent.shape} look={agent.look} photo={agent.photo} pose={pose} size={92} className="mb-2" />
      <b className="text-[14px] font-semibold">{title}</b>
      <span className="max-w-[240px] text-[12.5px] leading-snug text-ink3">{sub}</span>
    </Tag>
  );
}

/// The Computer tab of an agent's panel: its screen, live, and a click to open it large (taking over and the
/// screen size live there). Asleep, the agent's mascot sleeps in its place; a click wakes it. The computer is never
/// "off": it is made when the agent is, and it rests between uses.
export default function ComputerTab({ agent, screen }: { agent: RosterAgent; screen?: VmScreenDesc }) {
  const computer = useComputer(agent.id, true);
  const { link, shot, control } = computer;
  const shown = screen ?? { page: PAGE_OF[agent.name.toLowerCase()] ?? "search" };
  const [viewing, setViewing] = useState(false);
  const [sizing, setSizing] = useState(false);

  return (
    <div className="mt-3.5">
      {link === "checking" ? (
        <Mascot agent={agent} pose="idle" title={`Looking for ${agent.name}'s computer…`} sub="One moment." />
      ) : link === "absent" ? (
        <Mascot agent={agent} pose="work" title={`Setting up ${agent.name}'s computer…`} sub="This takes about a minute the first time." />
      ) : link === "starting" ? (
        <Mascot agent={agent} pose="idle" title={`Waking ${agent.name} up…`} sub="A few seconds." />
      ) : link === "off" ? (
        <Mascot agent={agent} pose="sleep" title={`${agent.name} is resting`} sub="Click to wake it and see the screen." onClick={() => void computer.start()} />
      ) : (
        <VmScreen
          name={agent.name}
          color={agent.color}
          screen={shown}
          shot={shot}
          live={computer.live}
          status={link === "on" ? (computer.liveError ? { text: `The screen did not start. ${computer.liveError}`, retry: computer.retry } : { text: "Starting the screen…" }) : null}
          control={control}
          onOpen={() => setViewing(true)}
        />
      )}
      <div className="mt-2 text-center text-xs text-ink4">{agent.name}'s screen</div>

      <ComputerViewer agent={agent} open={viewing} onOpenChange={setViewing} computer={computer} screen={shown} onSize={() => setSizing(true)} />
      <ComputerSizeSheet agentId={agent.id} open={sizing} onOpenChange={setSizing} />
    </div>
  );
}
