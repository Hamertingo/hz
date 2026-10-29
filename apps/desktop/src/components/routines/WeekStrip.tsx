import { cn } from "@/lib/utils";
import type { Routine } from "@/types/events";
import type { WeekDay, WeekMark } from "@/lib/routines";

/// The week as seven days, each a date with a dot for every run that happened or is still to
/// come. A day selects the routines that touch it; a dot opens that run.
export default function WeekStrip({
  days,
  routines,
  selected,
  onSelect,
  onOpen,
}: {
  days: WeekDay[];
  routines: Routine[];
  selected: string | null;
  onSelect: (date: string | null) => void;
  onOpen: (mark: WeekMark) => void;
}) {
  return (
    <div className="mb-3.5 grid grid-cols-7 gap-1.5">
      {days.map((d) => {
        const on = selected === d.date;
        return (
          <div
            key={d.date}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            onClick={() => onSelect(on ? null : d.date)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(on ? null : d.date)}
            className={cn(
              "cursor-pointer rounded-(--r2) py-2 text-center text-[11.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              on ? "bg-ink text-background" : "text-ink3 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-s1",
            )}
          >
            <span className={cn("leading-normal", d.today && (on ? "text-background" : "font-medium text-ink"))}>{d.today ? "Today" : d.label}</span>
            <b className={cn("mt-px block text-base leading-normal font-medium", on ? "text-background" : "text-ink")}>{d.day}</b>
            <div className="mt-1 flex h-1 justify-center gap-0.5">
              {d.marks.slice(0, 4).map((m, i) => (
                <button
                  key={`${m.routineId}-${m.at}-${i}`}
                  type="button"
                  aria-label={`${routines.find((r) => r.id === m.routineId)?.name ?? "Routine"}, ${m.state === "next" ? "coming up" : m.state === "fail" ? "failed" : "ran"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(m);
                  }}
                  className={cn(
                    "size-1 cursor-pointer rounded-full p-0 outline-none",
                    m.state === "fail" ? "bg-red" : on ? "bg-background" : "bg-ink3",
                    m.state === "next" && "opacity-50",
                  )}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
