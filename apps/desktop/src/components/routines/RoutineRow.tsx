import { Clock, Copy, MoreHorizontal, Pencil, Play, SkipForward, Trash2, Webhook } from "lucide-react";
import { useEffect, useState } from "react";

import AgentTile from "@/components/AgentTile";
import Sentence, { type Patch } from "@/components/routines/Sentence";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { clock, lastRun, nextText, type Channel } from "@/lib/routines";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { Routine, Running } from "@/types/events";

/// One routine: its name, its sentence, when it runs next and how the last run
/// went, with Run now, the pause switch and a menu on the right.
export default function RoutineRow({
  routine,
  agent,
  agents,
  channels,
  running,
  now,
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
  channels: Channel[];
  running: Running | undefined;
  now: number;
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
  const webhook = routine.trigger.kind === "webhook";
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onEdit()}
      style={{ "--c": color } as React.CSSProperties}
      className={cn(
        "group relative flex cursor-pointer items-start gap-3.5 overflow-hidden rounded-(--r4) bg-s1 py-4 pr-4 pl-[18px] shadow-[inset_0_0_0_1px_var(--line)] transition-[background,box-shadow] hover:bg-s2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        running && "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--c)_50%,transparent)]",
      )}
    >
      {running && <span className="absolute bottom-0 left-0 h-0.5 w-[30%] animate-routine-scan bg-(--c)" />}
      <span className={cn("mt-px shrink-0", !routine.on && "opacity-50")}>
        {agent ? (
          <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={34} />
        ) : (
          <span className="grid size-[34px] place-items-center rounded-lg bg-s3 text-ink3">
            <Clock className="size-4" />
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-semibold tracking-[-0.01em]", !routine.on && "opacity-50")}>{routine.name}</div>
        <div className={cn("mt-[3px] text-[13px] leading-[1.7] text-ink3", !routine.on && "opacity-50")}>
          <Sentence
            routine={routine}
            agent={agent}
            agents={agents}
            channels={channels}
            onPatch={onPatch}
            onEditPrompt={onEdit}
          />
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-ink4">
          {running ? (
            <Live name={agent?.name ?? "The agent"} color={color} since={running.sinceMs} />
          ) : (
            <>
              {webhook ? <Webhook className="size-[13px]" /> : <Clock className="size-[13px]" />}
              <span>
                {!routine.on
                  ? "Paused"
                  : routine.trigger.kind === "webhook"
                    ? `Runs when ${routine.trigger.source} calls`
                    : routine.legacyEveryMinutes != null
                      ? `Every ${routine.legacyEveryMinutes} min until edited`
                      : `Next ${nextText(routine, now)}`}
              </span>
              {last && (
                <>
                  <span>·</span>
                  <span className={last.status === "fail" ? "text-red" : "text-green"}>
                    {last.status === "fail" ? "last run failed" : "last run ok"}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 pt-px" onClick={stop}>
        <Button
          variant="outline"
          size="sm"
          disabled={!!running}
          onClick={onRun}
          className={cn("transition-opacity", running ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
        >
          <Play /> Run now
        </Button>
        <Switch
          checked={routine.on}
          onCheckedChange={onToggle}
          aria-label={routine.on ? `Pause ${routine.name}` : `Turn on ${routine.name}`}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label={`More for ${routine.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!!running} onSelect={onRun}>
              <Play /> Run now
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            {routine.trigger.kind === "schedule" && routine.on && (
              <DropdownMenuItem onSelect={onSkip}>
                <SkipForward /> Skip next run
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
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
