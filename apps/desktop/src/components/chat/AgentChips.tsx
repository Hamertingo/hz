import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Shield } from "lucide-react";
import { useEffect, useState } from "react";

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
import BrandMark from "@/components/BrandMark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MODE_COPY, honouredModes } from "@/lib/permission";
import type { RosterAgent } from "@/lib/roster";
import type { Model } from "@/types/events";

const chipButton =
  "ml-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-[9px] text-[12px] font-medium text-ink3 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-s3 hover:text-ink data-[state=open]:bg-s3 data-[state=open]:text-ink [&_svg]:size-3";

const markOf = (harness: string) => (harness.startsWith("codex") ? "openai" : "claude");

/// The model and the access menus that sit in the tool row under the composer. Both change in place,
/// for the next message; the CLI and the folder are fixed when the agent is made.
export default function AgentChips({
  agent,
  onChange,
  onOpenProfile,
}: {
  agent: RosterAgent;
  onChange: (next: RosterAgent) => void;
  onOpenProfile: (tab?: "access") => void;
}) {
  const [models, setModels] = useState<Model[] | null>(null);

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

  const model = models?.find((m) => m.id === agent.modelId);
  const modes = honouredModes(agent.harness);
  const mode = agent.permission ?? "auto";

  return (
    <>
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" className={chipButton}>
              <BrandMark slug={markOf(agent.harness)} size={12} bare />
              {model?.label ?? agent.modelId ?? "Default model"}
              {agent.effort && <span className="text-ink4">· {agent.effort}</span>}
              <ChevronDown />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Change model</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" className="max-h-80 w-64">
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
        <DropdownMenuSeparator />
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

    </>
  );
}
