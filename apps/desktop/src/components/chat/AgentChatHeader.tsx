import { Bell, BellOff, ChevronRight, Eraser, FileDown, ImageIcon, Monitor, Phone, Pin, PinOff, Trash2, UserRound } from "lucide-react";
import { useState } from "react";

import AgentAvatar from "@/components/AgentAvatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProfileTab } from "@/components/profile/ProfilePanel";
import type { RosterAgent } from "@/lib/roster";
import { type Activity, stateFor } from "@/lib/agentStatus";
import { useMe } from "@/hooks/useMe";
import { cn } from "@/lib/utils";

/// `~` for the home folder, so a path reads the way the reader would type it.
export function homeShort(path: string | null): string {
  if (!path) return "no folder";
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

/// The band over an agent's chat: the name opens the profile beside the chat, a right click on it opens the
/// menu of what can be done to the chat itself, and the icons open the call, its files and its computer.
export default function AgentChatHeader({
  agent,
  onChange,
  onOpenProfile,
  onCall,
  activity,
  who,
  onExport,
  onClear,
  onRemove,
}: {
  agent: RosterAgent;
  onChange: (next: RosterAgent) => void;
  /// Opens the profile; `tab` names the page to land on.
  onOpenProfile: (tab?: ProfileTab) => void;
  onCall: () => void;
  /// What it is doing right now, said beside the name; absent when it is idle.
  activity?: Activity | null;
  /// The teammates a team activity names.
  who?: string;
  onExport: () => void;
  onClear: () => void;
  onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState<"clear" | "remove" | null>(null);
  const me = useMe();

  return (
    <div className="relative z-[2] flex h-full min-w-0 flex-1 items-center justify-center">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${agent.name}: open profile`}
            onClick={() => onOpenProfile()}
            className="group/np inline-flex h-8 cursor-pointer items-center gap-2 rounded-(--r1) pr-2 pl-1.5 text-[13.5px] font-semibold outline-none transition-colors hover:bg-s2 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <AgentAvatar agent={agent} size={22} pose={activity && activity !== "asking" && activity !== "waitingFor" ? "work" : "idle"} />
            <span className="max-w-[260px] truncate">{agent.name}</span>
            {activity && (
              <span
                key={activity}
                className={cn("text-xs font-normal", activity === "asking" || activity === "waitingFor" ? "text-amber" : "row-act-text")}
              >
                · {stateFor(activity, me.language, false, who)}
              </span>
            )}
            <ChevronRight className="size-[13px] text-ink4" />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onSelect={() => onOpenProfile()}>
            <UserRound /> Open profile
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onChange({ ...agent, pinned: !agent.pinned })}>
            {agent.pinned ? <PinOff /> : <Pin />}
            {agent.pinned ? "Unpin from the top" : "Pin to top"}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onChange({ ...agent, muted: !agent.muted })}>
            {agent.muted ? <Bell /> : <BellOff />}
            {agent.muted ? "Unmute" : "Mute"}
          </ContextMenuItem>
          <ContextMenuItem onSelect={onExport}>
            <FileDown /> Export chat to .md
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setConfirm("clear")}>
            <Eraser /> Clear chat
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => setConfirm("remove")}>
            <Trash2 /> Remove agent
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <div className="absolute top-1/2 right-0 flex -translate-y-1/2 gap-0.5">
        {([
          [Phone, "Call", "call"],
          [ImageIcon, "Photos and files", "activity"],
          [Monitor, "Computer", "computer"],
        ] as const).map(([Icon, label, tab]) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                onClick={() => (tab === "call" ? onCall() : onOpenProfile(tab))}
                className="grid size-[30px] cursor-pointer place-items-center rounded-(--r1) text-ink2 transition-colors hover:bg-s3 hover:text-ink active:bg-s3 [&_svg]:size-[17px]"
              >
                <Icon strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <ConfirmDialog
        open={confirm === "clear"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Clear this chat?"
        description={`Starts a fresh page. ${agent.name} keeps its memory and the old messages stay one click away under “Show earlier”.`}
        confirmLabel="Clear chat"
        danger={false}
        onConfirm={onClear}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Remove ${agent.name}?`}
        description="The agent leaves the roster. Its conversation stays on disk; its memory folder is not touched."
        confirmLabel="Remove agent"
        typeToConfirm={agent.name}
        onConfirm={onRemove}
      />
    </div>
  );
}
