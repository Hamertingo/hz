import { Clock, Copy, Pencil, Play, SkipForward, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import AgentTile from "@/components/AgentTile";
import Sentence, { type Patch } from "@/components/routines/Sentence";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Switch } from "@/components/ui/switch";
import { clock, lastRun } from "@/lib/routines";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { Routine, Running } from "@/types/events";

/// One routine: its name, its sentence, when it runs next and how the last run
/// went, with Run now, the pause switch and a menu on the right.
export default function RoutineRow({
  routine,
  agent,
  agents,
  running,
  onEdit,
  onPatch,
  onRun,
  onToggle,
  onDuplicate,
  onSkip,
  onDelete,
}: {
  routine: Routine;
  agent: RosterAgent | null;
  agents: RosterAgent[];
  running: Running | undefined;
  onEdit: () => void;
  onPatch: Patch;
  onRun: () => void;
  onToggle: (on: boolean) => void;
  onDuplicate: () => void;
  onSkip: () => void;
  onDelete: () => void;
}) {
  const last = lastRun(routine);
  const color = agent?.color ?? "var(--ink3)";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          style={{ "--c": color } as React.CSSProperties}
          className={cn(
            "group relative flex min-h-11 items-center gap-[11px] overflow-hidden px-3 py-[9px] transition-colors first:rounded-t-[13px] last:rounded-b-[13px]",
            running && "bg-s1",
          )}
        >
          {running && <span className="absolute bottom-0 left-0 h-0.5 w-[30%] animate-routine-scan bg-(--c)" />}
          <span className="flex shrink-0">
            {agent ? (
              <AgentTile id={agent.id} kind={agent.kind} color={agent.color} shape={agent.shape} look={agent.look} photo={agent.photo} size={26} />
            ) : (
              <span className="grid size-[26px] place-items-center rounded-lg bg-s3 text-ink3">
                <Clock className="size-4" />
              </span>
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="text-[13px] leading-[1.55] font-medium">
              <Sentence routine={routine} agent={agent} agents={agents} onPatch={onPatch} onEditPrompt={onEdit} />
            </div>
            <div className="mt-px truncate text-xs leading-[1.45] text-ink3">
              {running ? (
                <Live name={agent?.name ?? "The agent"} color={color} since={running.sinceMs} />
              ) : (
                <>
                  {routine.name}
                  {last?.status === "fail" && <span className="text-red"> · last run failed</span>}
                </>
              )}
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={!!running} onClick={onRun}>
              Run now
            </Button>
            <Button variant="ghost" size="icon" className="size-[26px] rounded-[6px]" aria-label={`Edit ${routine.name}`} onClick={onEdit}>
              <Pencil className="size-[15px]" />
            </Button>
            <Switch
              checked={routine.on}
              onCheckedChange={onToggle}
              aria-label={routine.on ? `Pause ${routine.name}` : `Turn on ${routine.name}`}
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem onSelect={onEdit}>
          <Pencil /> Edit
        </ContextMenuItem>
        <ContextMenuItem disabled={!!running} onSelect={onRun}>
          <Play /> Run now
        </ContextMenuItem>
        <ContextMenuItem onSelect={onDuplicate}>
          <Copy /> Duplicate
        </ContextMenuItem>
        {routine.trigger.kind === "schedule" && routine.on && (
          <ContextMenuItem onSelect={onSkip}>
            <SkipForward /> Skip next run
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/// "Atlas is running this now" with a clock that runs from the real start.
function Live({ name, color, since }: { name: string; color: string; since: number }) {
  const [at, setAt] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setAt(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="flex items-center gap-2 text-ink">
      <span
        className="inline-block size-3 shrink-0 animate-spin rounded-full border-[1.6px]"
        style={{ borderColor: `color-mix(in srgb, ${color} 25%, transparent)`, borderTopColor: color }}
      />
      <span className="shimmer-text">{name} is running this now</span>
      <span className="tabular-nums">{clock(at - since)}</span>
    </span>
  );
}
