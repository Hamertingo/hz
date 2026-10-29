import { Clock, Play, RefreshCw } from "lucide-react";

import AgentTile from "@/components/AgentTile";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { DAY_NAMES, clock, destLabel, dateKeyIn, money, type Channel, type WeekMark } from "@/lib/routines";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { Routine } from "@/types/events";

const Stat = ({ value, label, tone }: { value: string; label: string; tone?: string }) => (
  <div>
    <div className={cn("text-xl font-semibold tracking-[-0.02em]", tone ?? "text-ink")}>{value}</div>
    <div className="mt-0.5 text-xs text-ink3">{label}</div>
  </div>
);

/// What a face on the week strip opens: a run that happened (how long, what it
/// cost, what it posted or what went wrong) or one still to come (what it will
/// do, with the choice to skip it or run it now).
export default function RunSheet({
  mark,
  routine,
  agent,
  channels,
  onClose,
  onSkip,
  onRun,
  onOpenChat,
}: {
  mark: WeekMark | null;
  routine: Routine | undefined;
  agent: RosterAgent | undefined;
  channels: Channel[];
  onClose: () => void;
  onSkip: (routine: Routine, date: string) => void;
  onRun: (routine: Routine) => void;
  onOpenChat: (agentId: string) => void;
}) {
  const open = !!mark && !!routine;
  // The last content stays up while the sheet fades out, so closing does not blank it.
  const at = mark ? new Date(mark.at) : null;
  const next = mark?.state === "next";
  const fail = mark?.state === "fail";
  const run = mark?.run ?? null;
  const name = agent?.name ?? "The agent";
  const time = at ? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` : "";
  const day = at ? DAY_NAMES[(at.getDay() + 6) % 7] : "";
  const tz = routine?.trigger.kind === "schedule" ? routine.trigger.tz : "local";

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      mode="centered"
      width={500}
      title={routine?.name ?? "Run"}
      sub={`${day} at ${time} · ${next ? "scheduled" : fail ? "failed" : "ran"}`}
      icon={agent ? <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={30} /> : undefined}
      footer={
        routine &&
        mark &&
        (next ? (
          <>
            <Button variant="ghost" onClick={() => onSkip(routine, dateKeyIn(tz, mark.at))}>
              Skip this one
            </Button>
            <Button variant="solid" className="ml-auto" onClick={() => onRun(routine)}>
              <Play className="size-[13px]" /> Run now instead
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" disabled={!agent} onClick={() => agent && onOpenChat(agent.id)}>
              Open {name}&apos;s chat
            </Button>
            <Button variant="solid" className="ml-auto" onClick={() => onRun(routine)}>
              <RefreshCw className="size-[13px]" /> Run again
            </Button>
          </>
        ))
      }
    >
      {routine && mark && (
        <>
          {next ? (
            <>
              <div className="flex items-center gap-3 rounded-(--r3) bg-s1 p-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
                <Clock className="size-[18px] text-ink2" />
                <div>
                  <div className="font-medium">
                    Runs {day} at {time}
                  </div>
                  <div className="mt-0.5 text-xs text-ink3">
                    {name} → {destLabel(routine.to, name, channels)}
                  </div>
                </div>
              </div>
              <h4 className="mt-5 mb-2 text-xs font-medium text-ink3">What it will do</h4>
              <div className="leading-[1.65] whitespace-pre-wrap text-ink2">{routine.prompt}</div>
            </>
          ) : (
            <>
              <div className="flex gap-7">
                <Stat value={run ? clock(run.durationMs) : "—"} label="Duration" />
                <Stat value={money(run?.cost ?? null)} label="Cost" />
                <Stat value={fail ? "Failed" : "OK"} label="Result" tone={fail ? "text-red" : "text-green"} />
              </div>
              <h4 className="mt-5 mb-2 text-xs font-medium text-ink3">
                {fail ? "What went wrong" : run?.needsYou ? `${name} needs you` : `What ${name} posted`}
              </h4>
              {fail ? (
                <div className="rounded-(--r2) bg-s2 p-3 font-mono text-xs whitespace-pre-wrap text-red shadow-[inset_0_0_0_1px_var(--line)]">
                  {run?.error ?? "It did not finish."}
                </div>
              ) : (
                <div className="rounded-(--r3) bg-s1 p-3.5 leading-[1.65] whitespace-pre-wrap text-ink2 shadow-[inset_0_0_0_1px_var(--line)]">
                  {run?.outputExcerpt || "Nothing was written."}
                </div>
              )}
              {run && (
                <div className="mt-3 space-y-0.5 text-xs text-ink4">
                  <div>Started by {run.via || "the schedule"}.</div>
                  {run.delivery && <div>{run.delivery}</div>}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
