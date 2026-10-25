import { Check, X } from "lucide-react";

import { stepTime, type TraceStep } from "@/lib/steps";
import { cn } from "@/lib/utils";

/// What an agent did in a turn, one line per call with how long it took — the
/// panel under "See what it did". A failed call reads in red; the rest are the
/// quiet record they should be.
export default function StepTrace({ steps }: { steps: TraceStep[] }) {
  if (steps.length === 0) {
    return <p className="px-3 py-2 text-[12.5px] text-ink3">It only wrote, no tools used.</p>;
  }

  return (
    <div className="flex flex-col py-1.5">
      {steps.map((step) => (
        <div key={step.key} className="flex items-center gap-2.5 px-3.5 py-[5px] text-[12.5px] text-ink2">
          {step.failed ? (
            <X className="size-3 shrink-0 text-red" />
          ) : (
            <Check className="size-3 shrink-0 text-green" />
          )}
          <span className="min-w-0 truncate">
            {step.verb}
            {step.target && (
              <>
                {" "}
                <code className={cn("font-mono text-[11.5px] text-ink3", step.failed && "text-red/80")}>
                  {step.target}
                </code>
              </>
            )}
          </span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink4">{stepTime(step.ms)}</span>
        </div>
      ))}
    </div>
  );
}
