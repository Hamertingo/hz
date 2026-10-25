import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/// A page's lead sentence, under the title the settings rail already draws.
export function Lead({ children }: { children: ReactNode }) {
  return <p className="-mt-4 text-[13px] leading-normal text-ink3">{children}</p>;
}

/// The mockup's `.prow`: the label and its reason on the left at a fixed width,
/// the control filling the rest. `column` stacks several things in the control.
export function StudioRow({
  label,
  hint,
  column,
  children,
}: {
  label: string;
  hint?: ReactNode;
  column?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-6 border-b border-line py-4">
      <div className="w-[210px] shrink-0">
        <span className="block text-[13px] font-[550] text-ink">{label}</span>
        {hint && <span className="mt-[3px] block text-xs leading-[1.45] text-ink3">{hint}</span>}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-wrap gap-2.5", column ? "flex-col items-stretch" : "items-center")}>
        {children}
      </div>
    </div>
  );
}

/// The mockup's `.set h5`: a quiet heading that starts a group of rows.
export function SetHeading({ children }: { children: ReactNode }) {
  return <h3 className="-mb-3.5 text-xs font-medium text-ink3">{children}</h3>;
}
