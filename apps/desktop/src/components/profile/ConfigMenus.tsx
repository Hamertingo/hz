import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { CLI } from "@/lib/cli";
import type { RosterAgent } from "@/lib/roster";
import type { Model } from "@/types/events";

/// The models this agent's CLI offers, read from the machine rather than from a
/// table: a model shipped after this build still shows up.
export function useModels(harness: RosterAgent["harness"]) {
  const [models, setModels] = useState<Model[] | null>(null);
  useEffect(() => {
    let live = true;
    setModels(null);
    invoke<Model[]>("list_models", { harness })
      .then((list) => live && setModels(list))
      .catch(() => live && setModels([]));
    return () => {
      live = false;
    };
  }, [harness]);
  return models;
}

const EFFORT_HINT: Record<string, string> = {
  low: "fastest",
  medium: "default",
  high: "thinks longer",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/// The model's name as the menus draw it.
export function modelLabel(models: Model[] | null, agent: RosterAgent): string {
  return models?.find((m) => m.id === agent.modelId)?.label ?? agent.modelId ?? "Default model";
}

/// Picks the model. The agent moves onto it at its next message: the roster
/// carries the pick into the send, which switches the running child with
/// `session/set_config_option`. A model has its own effort ladder, so the effort
/// resets to the model's default.
export function ModelMenu({
  agent,
  models,
  onChange,
  children,
  align = "end",
}: {
  agent: RosterAgent;
  models: Model[] | null;
  onChange: (next: RosterAgent) => void;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const cli = CLI[agent.harness]?.label ?? agent.harness;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!models || models.length === 0}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-72 w-60 overflow-y-auto">
        <DropdownMenuLabel className="px-[9px] py-1 text-[11px] font-medium text-ink4">{cli} models</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={agent.modelId ?? ""}
          onValueChange={(id) => {
            const m = models?.find((x) => x.id === id);
            onChange({ ...agent, modelId: id || null, effort: null });
            toast(`${agent.name} uses ${m?.label ?? "its default model"} from the next message`);
          }}
        >
          <DropdownMenuRadioItem value="">Default</DropdownMenuRadioItem>
          {(models ?? []).map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              {m.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/// Picks the effort from the ladder the current model states. Absent for a model
/// that states none.
export function EffortMenu({
  agent,
  models,
  onChange,
  children,
}: {
  agent: RosterAgent;
  models: Model[] | null;
  onChange: (next: RosterAgent) => void;
  children: ReactNode;
}) {
  const efforts = models?.find((m) => m.id === agent.modelId)?.efforts ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={efforts.length === 0}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="px-[9px] py-1 text-[11px] font-medium text-ink4">Effort</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={agent.effort ?? ""}
          onValueChange={(level) => {
            onChange({ ...agent, effort: level || null });
            toast(`${agent.name} thinks at ${level ? cap(level) : "its default"} effort from the next message`);
          }}
        >
          <DropdownMenuRadioItem value="">Default</DropdownMenuRadioItem>
          {efforts.map((level) => (
            <DropdownMenuRadioItem key={level} value={level}>
              {cap(level)}
              {EFFORT_HINT[level] && <span className="ml-auto pl-3 text-ink4">{EFFORT_HINT[level]}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
