import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/// The frame the small sheets share (versions, logins, size, what's new, feedback): a centred card with a
/// title row, a scrolling body and an optional footer of actions. One component so they open, close and
/// space the same way.
export default function Modal({
  open,
  onOpenChange,
  title,
  lead,
  width = 520,
  banner,
  footer,
  children,
  bodyClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /// A face or icon at the left of the title.
  lead?: ReactNode;
  width?: number;
  /// Drawn above the title row, edge to edge.
  banner?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        style={{ width: `min(${width}px, calc(100vw - 48px))` }}
        className="flex max-h-[min(720px,calc(100vh-64px))] max-w-none flex-col gap-0 overflow-hidden rounded-(--r4) bg-(--sheet) p-0"
      >
        <DialogDescription className="sr-only">{title}</DialogDescription>
        {banner}
        <div className="flex shrink-0 items-center gap-3 px-5 pt-[18px] pb-2">
          {lead}
          <DialogTitle className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-[-0.015em]">{title}</DialogTitle>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="grid size-[26px] cursor-pointer place-items-center rounded-md text-ink3 transition-colors hover:bg-hover hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5", bodyClassName)}>{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 pt-3 pb-4">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}

/// A quiet line of explanation over a group.
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("px-1 py-2 text-xs leading-[1.55] text-ink3", className)}>{children}</p>;
}
