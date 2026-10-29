import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/// A page drawn as the mockup's sheet: a veil over whatever the window was showing and a
/// 940x620 card in the middle. Not a Radix dialog on purpose: the views that wear it stay mounted
/// while closed (their reads, filters and scroll survive), and a dialog would unmount them.
/// `active` false renders nothing visible, so the owner keeps the component in the tree.
export function PageSheet({
  active,
  title,
  actions,
  onClose,
  children,
  className,
  width = 940,
  height = 620,
}: {
  active: boolean;
  title: ReactNode;
  /// Drawn between the title and the close button.
  actions?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  width?: number;
  height?: number;
}) {
  useEffect(() => {
    if (!active || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      // A menu or dialog above the sheet takes Escape first; only a bare one closes the sheet.
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[role=dialog],[role=menu]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  return (
    <div
      className={cn("fixed inset-0 z-40 place-items-center bg-black/[0.42] animate-in fade-in-0 duration-200", active ? "grid" : "hidden")}
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        role="region"
        aria-label={typeof title === "string" ? title : undefined}
        style={{ width: `min(${width}px, calc(100vw - 48px))`, height: `min(${height}px, calc(100vh - 48px))` }}
        className={cn(
          "flex flex-col overflow-hidden rounded-(--r4) bg-(--sheet) text-ink shadow-(--shadow) ring-1 ring-line2 animate-in zoom-in-[0.97] fade-in-0 duration-200",
          className,
        )}
      >
        <div className="flex shrink-0 items-center gap-3 px-5 pt-[18px] pb-2">
          <h2 className="flex-1 text-base leading-[1.3] font-semibold tracking-[-0.015em]">{title}</h2>
          {actions}
          {onClose && (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="grid size-[26px] cursor-pointer place-items-center rounded-md text-ink2 transition-colors outline-none hover:bg-s3 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="size-[15px]" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
