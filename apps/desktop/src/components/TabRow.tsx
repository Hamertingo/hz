import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/// A row of tabs, and the button one of them is.
///
/// **One control, so two pages cannot describe the same row two ways.** These
/// were written twice — the plugins page's three sections and the inbox's three
/// sources — and the second copy is the one that drifts: a shape that lives in
/// one file is a shape no other surface can disagree with. Ghost buttons whose
/// active one takes `--sidebar-selected`, the count in a smaller tabular face
/// beside the word, and no track, because a well with a thumb is for a *mode*
/// inside one surface where this is a place to go.
///
/// The mark is optional and the plugins row has none: it is what says *which*
/// half of a two-tracker list you are in before the word is read.
export function TabRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

export function TabButton({
  active,
  label,
  count,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "cursor-pointer gap-1.5",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground",
      )}
    >
      {icon}
      {label}
      <span className="text-xs tabular-nums opacity-70">{count}</span>
    </Button>
  );
}
