import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/// A page's lead sentence, under the title the settings rail already draws.
export function Lead({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[13px] leading-normal text-ink3">{children}</p>;
}

/// The row's box, shared with the dialog's own `SettingRow` so both draw the same hairlines.
export const ROW_BOX =
  "relative min-h-11 border-x border-line bg-s1 px-[11px] py-[9px] first:rounded-t-[13px] first:border-t last:rounded-b-[13px] last:border-b not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3 not-first:before:h-px not-first:before:bg-line";

/// One setting: the label and its reason on the left, the control on the right. Siblings share
/// hairlines (`-mt-px`) and the first and last round the box, so a run of them reads as the kit's
/// `Group` without every page wrapping its rows. `stack` puts the control under the label at full
/// width, for a picker too wide to share a line; `column` is the same with several things inside.
export function StudioRow({
  label,
  hint,
  column,
  stack,
  children,
}: {
  label: string;
  hint?: ReactNode;
  column?: boolean;
  stack?: boolean;
  children: ReactNode;
}) {
  const stacked = stack || column;
  return (
    <div
      className={cn(
        ROW_BOX,
        stacked ? "flex flex-col gap-2.5" : "flex items-center gap-[11px]",
      )}
    >
      <div className={cn("min-w-0", !stacked && "flex-1")}>
        <span className="block text-[13px] leading-[1.4] font-medium text-ink">{label}</span>
        {hint && <span className="mt-px block text-xs leading-[1.45] text-ink3">{hint}</span>}
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-wrap gap-1.5",
          stacked ? (column ? "flex-col items-stretch" : "items-center") : "shrink-0 items-center justify-end",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/// A quiet heading that starts a group of rows.
export function SetHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("mt-3 px-1 text-xs leading-normal font-medium text-ink3 first:mt-5", className)}>{children}</h3>;
}

/// A hairline card with a lead glyph, a title and sentence, and actions on the right; the page's
/// first-class switches and statuses (Advanced mode, Pause all, end-to-end) sit in these.
export function Card1({
  lead,
  title,
  sub,
  children,
}: {
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[13px] bg-s1 px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
      {lead}
      <span className="min-w-0 flex-1">
        <b className="block text-[13.5px] font-medium">{title}</b>
        {sub && <span className="mt-px block text-xs leading-[1.45] text-ink3">{sub}</span>}
      </span>
      {children && <span className="flex shrink-0 items-center gap-2">{children}</span>}
    </div>
  );
}
