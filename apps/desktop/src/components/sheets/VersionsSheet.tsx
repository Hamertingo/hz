import { invoke } from "@tauri-apps/api/core";
import { RotateCcw } from "lucide-react";
import { useState } from "react";

import AgentAvatar from "@/components/AgentAvatar";
import Modal, { Hint } from "@/components/sheets/Modal";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Chip, Group, Row } from "@/components/kit/kit";
import { useVersions } from "@/hooks/useAgentProfile";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";

/// How long ago, at the grain the mockup writes it: minutes, hours, yesterday, then the date.
function agoLabel(ms: number, now = Date.now()): string {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/// Every saved version of an agent's instructions, newest first, as a timeline. Restoring writes the old text
/// back as a new version, so nothing is lost by going back. Memory and chats are not touched.
export default function VersionsSheet({
  agent,
  open,
  onOpenChange,
  onRestored,
}: {
  agent: RosterAgent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /// The roster should take the restored text, since the next briefing is built from it.
  onRestored: (text: string) => void;
}) {
  const { versions, reload } = useVersions(agent.id);
  const [asking, setAsking] = useState<number | null>(null);
  const newest = versions?.[0]?.n;

  const restore = async (n: number) => {
    try {
      const made = await invoke<{ n: number; text: string }>("agent_instr_restore", { agentId: agent.id, n });
      onRestored(made.text);
      await reload();
      toast(`Restored V${n} as V${made.n}`);
    } catch (e) {
      toast(String(e));
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} width={540} title={`${agent.name}'s versions`} lead={<AgentAvatar agent={agent} size={34} />}>
      <Hint>Every change to the instructions is saved. Restoring keeps memory and chats.</Hint>
      {versions === null ? (
        <SkeletonRegion label="Reading versions" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </SkeletonRegion>
      ) : versions.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-ink3">Each save of the instructions becomes a version here.</p>
      ) : (
        <div className="relative pl-[18px] before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-line2">
          <Group>
            {versions.map((v) => {
              const cur = v.n === newest;
              return (
                <Row
                  key={v.n}
                  title={v.summary || "Saved"}
                  sub={`v${v.n} · ${agoLabel(v.atMs)}`}
                  className={cn(
                    "relative after:absolute after:top-5 after:-left-[17px] after:size-[9px] after:rounded-full after:bg-background after:shadow-[inset_0_0_0_1.5px_var(--ink3)]",
                    cur && "after:bg-ink after:shadow-none",
                  )}
                  right={
                    cur ? (
                      <Chip>Current</Chip>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setAsking(v.n)}>
                        <RotateCcw /> Restore
                      </Button>
                    )
                  }
                />
              );
            })}
          </Group>
        </div>
      )}
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(o) => !o && setAsking(null)}
        title={`Restore V${asking}?`}
        description="The instructions go back to that text, as a new version. Memory and chats stay as they are."
        confirmLabel="Restore"
        danger={false}
        onConfirm={() => asking !== null && void restore(asking)}
      />
    </Modal>
  );
}
