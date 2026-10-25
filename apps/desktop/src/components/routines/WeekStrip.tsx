import { Clock } from "lucide-react";

import AgentTile from "@/components/AgentTile";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { Routine } from "@/types/events";
import type { WeekDay, WeekMark } from "@/lib/routines";

/// One face on a day: the agent that ran, or will run. Faded ones are still to
/// come, a red dot marks a failure, and a run that just finished pops in.
function Mark({
  mark,
  routine,
  agent,
  onOpen,
}: {
  mark: WeekMark;
  routine: Routine | undefined;
  agent: RosterAgent | undefined;
  onOpen: (mark: WeekMark) => void;
}) {
  const time = new Date(mark.at);
  const hhmm = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
  return (
    <button
      type="button"
      title={`${routine?.name ?? "Routine"} · ${hhmm}`}
      aria-label={`${routine?.name ?? "Routine"} at ${hhmm}, ${mark.state === "next" ? "coming up" : mark.state === "fail" ? "failed" : "ran"}`}
      onClick={() => onOpen(mark)}
      className={cn(
        "relative grid size-5 cursor-pointer place-items-center rounded-md transition-transform hover:scale-115 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        mark.state === "next" && "opacity-40",
        mark.fresh && "animate-routine-pop",
      )}
    >
      {agent ? (
        <AgentTile id={agent.id} kind={agent.kind} color={agent.color} size={20} />
      ) : (
        <span className="grid size-5 place-items-center rounded-md bg-s3 text-ink3">
          <Clock className="size-3" />
        </span>
      )}
      {mark.state === "fail" && (
        <span className="absolute -top-0.5 -right-0.5 size-[7px] rounded-full bg-red shadow-[0_0_0_2px_var(--background)]" />
      )}
    </button>
  );
}

/// The week as seven days, each holding the faces of the runs that happened and
/// the ones still to come.
export default function WeekStrip({
  days,
  routines,
  agents,
  onOpen,
}: {
  days: WeekDay[];
  routines: Routine[];
  agents: RosterAgent[];
  onOpen: (mark: WeekMark) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => (
          <div
            key={d.date}
            className={cn(
              "relative min-h-24 rounded-(--r3) px-2.5 pt-2.5 pb-3 shadow-[inset_0_0_0_1px_var(--line)]",
              d.today ? "bg-s2 shadow-[inset_0_0_0_1px_var(--line3)]" : "bg-s1",
            )}
          >
            <div className="flex items-baseline gap-1.5 text-[11.5px] font-medium text-ink3">
              {d.label}
              <b className={cn("text-[15px] font-semibold tracking-[-0.01em]", d.today ? "text-ink" : "text-ink2")}>{d.day}</b>
              {d.today && <span className="ml-auto rounded-full bg-s3 px-1.5 text-[10.5px] font-normal text-ink">Today</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {d.marks.map((m, i) => (
                <Mark
                  key={`${m.routineId}-${m.at}-${i}`}
                  mark={m}
                  routine={routines.find((r) => r.id === m.routineId)}
                  agent={agents.find((a) => a.id === m.agentId)}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex gap-3.5 text-xs text-ink4">
        <span>Each face is a run</span>
        <span>Faded ones are coming up</span>
        <span className="flex items-center gap-1.5">
          <i className="size-1.5 rounded-full bg-red" />
          failed
        </span>
      </div>
    </>
  );
}
