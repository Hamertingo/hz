import { Hand, Maximize2 } from "lucide-react";

import AgentAvatar from "@/components/AgentAvatar";
import { Chip } from "@/components/kit/kit";
import VmScreen, { type VmScreenDesc } from "@/components/computer/VmScreen";
import type { Computer } from "@/components/computer/useComputer";
import Modal from "@/components/sheets/Modal";
import { Button } from "@/components/ui/button";
import type { RosterAgent } from "@/lib/roster";

/// The agent's screen enlarged, with the controls under it. Opened from the thumbnail and from Pop out.
export default function ComputerViewer({
  agent,
  open,
  onOpenChange,
  computer,
  screen,
  onSize,
}: {
  agent: RosterAgent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  computer: Computer;
  screen?: VmScreenDesc;
  onSize: () => void;
}) {
  const { control, shot, link } = computer;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${agent.name}'s computer`}
      width={980}
      lead={<AgentAvatar agent={agent} size={32} pose="vm" />}
      footer={
        <>
          <span className="mr-auto text-[12.5px] text-ink3">
            {control ? `${agent.name} waits until you give it back.` : link === "preview" ? "A preview. The computer is not connected yet." : computer.live ? "Watching live" : computer.liveError ? "Not connected" : "Connecting…"}
          </span>
          <Chip dot={control ? "warn" : computer.live ? "go" : computer.liveError ? "bad" : "idle"}>{control ? "You're in control" : computer.live ? "Live" : computer.liveError ? "Offline" : "Starting"}</Chip>
          <Button variant="ghost" onClick={onSize}>
            <Maximize2 /> Screen size
          </Button>
          {control ? (
            <Button variant="solid" onClick={() => void computer.drive(false)}>
              Give it back
            </Button>
          ) : (
            <Button variant="solid" onClick={() => void computer.drive(true)}>
              <Hand /> Take over
            </Button>
          )}
        </>
      }
    >
      <VmScreen name={agent.name} color={agent.color} screen={screen} shot={shot} live={computer.live} status={computer.link === "on" ? (computer.liveError ? { text: `The screen did not start. ${computer.liveError}`, retry: computer.retry } : { text: "Starting the screen…" }) : null} control={control} big />
    </Modal>
  );
}
