import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Bell,
  BellOff,
  ChevronDown,
  Eraser,
  FileDown,
  Folder,
  MoreHorizontal,
  Pin,
  PinOff,
  Shield,
  Terminal,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import AgentAvatar from "@/components/AgentAvatar";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CLI } from "@/lib/cli";
import { MODE_COPY, honouredModes } from "@/lib/permission";
import type { RosterAgent } from "@/lib/roster";
import type { Model } from "@/types/events";

/// `~` for the home folder, so a path reads the way the reader would type it.
export function homeShort(path: string | null): string {
  if (!path) return "no folder";
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

const chip =
  "flex h-[22px] items-center gap-[5px] rounded-[7px] bg-s2 px-[7px] text-[11.5px] text-ink2 shadow-[inset_0_0_0_1px_var(--line)] [&_svg]:size-3";
const chipButton = `${chip} cursor-pointer transition-colors hover:bg-s3 hover:text-ink data-[state=open]:bg-s3`;

/// The band over an agent's chat: who it is, what it runs on, where it works and
/// what it may do — the four chips are the facts a reader checks before they ask
/// for anything — and the menu of what can be done to the chat itself.
///
/// The model and the permission change in place, for the next message; the CLI
/// and the folder are fixed when the agent is made, which is why they are not
/// buttons.
export default function AgentChatHeader({
  agent,
  onChange,
  onOpenProfile,
  onExport,
  onClear,
  onRemove,
}: {
  agent: RosterAgent;
  onChange: (next: RosterAgent) => void;
  /// Opens the profile; `tab` names the page to land on.
  onOpenProfile: (tab?: "access") => void;
  onExport: () => void;
  onClear: () => void;
  onRemove: () => void;
}) {
  const [models, setModels] = useState<Model[] | null>(null);
  const [confirm, setConfirm] = useState<"clear" | "remove" | null>(null);

  useEffect(() => {
    let live = true;
    setModels(null);
    invoke<Model[]>("list_models", { harness: agent.harness })
      .then((list) => live && setModels(list))
      .catch(() => live && setModels([]));
    return () => {
      live = false;
    };
  }, [agent.harness]);

  const cli = CLI[agent.harness];
  const model = models?.find((m) => m.id === agent.modelId);
  const modes = honouredModes(agent.harness);
  const mode = agent.permission ?? "auto";

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3">
      <button
        type="button"
        onClick={() => onOpenProfile()}
        aria-label={`Open ${agent.name}'s profile`}
        className="cursor-pointer rounded-(--r2) outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <AgentAvatar agent={agent} size={34} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
          <span className="truncate">{agent.name}</span>
          {agent.role && (
            <span className="truncate rounded-[5px] bg-s2 px-1.5 py-px text-[11px] font-medium text-ink3">
              {agent.role}
            </span>
          )}
          {agent.pinned && <Pin className="size-3 text-ink4" aria-label="Pinned" />}
          {agent.muted && <BellOff className="size-3 text-ink4" aria-label="Muted" />}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={chip}>
            {cli?.brand ? <BrandMark slug={cli.brand} size={12} bare /> : <Terminal />}
            {cli?.label ?? agent.harness}
          </span>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={chipButton}>
                    {model?.label ?? agent.modelId ?? "Default model"}
                    {agent.effort && <span className="text-ink4">· {agent.effort}</span>}
                    <ChevronDown />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Change model</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="max-h-80 w-64">
              <DropdownMenuLabel>Model</DropdownMenuLabel>
              {models === null && <div className="px-2.5 py-2 text-xs text-ink3">Reading the models…</div>}
              {models?.length === 0 && (
                <div className="px-2.5 py-2 text-xs text-ink3">This CLI listed no models.</div>
              )}
              <DropdownMenuRadioGroup
                value={agent.modelId ?? ""}
                onValueChange={(id) => {
                  const next = models?.find((m) => m.id === id);
                  // An effort from the old model's ladder may not exist on this one.
                  const keeps = next?.efforts.includes(agent.effort as never) ?? false;
                  onChange({ ...agent, modelId: id, effort: keeps ? agent.effort : (next?.defaultEffort ?? null) });
                }}
              >
                {models?.map((m) => (
                  <DropdownMenuRadioItem key={m.id} value={m.id}>
                    {m.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {model && model.efforts.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Effort</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={agent.effort ?? model.defaultEffort ?? ""}
                    onValueChange={(effort) => onChange({ ...agent, effort })}
                  >
                    {model.efforts.map((e) => (
                      <DropdownMenuRadioItem key={e} value={e}>
                        {e}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={chipButton}
                onClick={() => agent.projectPath && void revealItemInDir(agent.projectPath).catch(() => {})}
              >
                <Folder />
                {homeShort(agent.projectPath)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Show in Finder. The folder is fixed when the agent is made.</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={chipButton}>
                    <Shield />
                    {MODE_COPY[mode].label}
                    <ChevronDown />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">What it can do</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>What {agent.name} may do</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={mode}
                onValueChange={(next) => onChange({ ...agent, permission: next as RosterAgent["permission"] })}
              >
                {modes.map((m) => (
                  <DropdownMenuRadioItem key={m} value={m} className="flex-col items-start gap-0">
                    <span>{MODE_COPY[m].label}</span>
                    <span className="text-[11.5px] text-ink3">{MODE_COPY[m].hint}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onOpenProfile("access")}>
                <Shield /> Access settings…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Button variant="outline" size="sm" onClick={() => onOpenProfile()}>
        View profile
      </Button>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => onChange({ ...agent, pinned: !agent.pinned })}>
            {agent.pinned ? <PinOff /> : <Pin />}
            {agent.pinned ? "Unpin from the top" : "Pin to top"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onChange({ ...agent, muted: !agent.muted })}>
            {agent.muted ? <Bell /> : <BellOff />}
            {agent.muted ? "Unmute" : "Mute"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExport}>
            <FileDown /> Export chat to .md
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirm("clear")}>
            <Eraser /> Clear chat
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("remove")}>
            <Trash2 /> Remove agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
