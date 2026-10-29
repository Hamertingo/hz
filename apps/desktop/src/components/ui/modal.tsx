import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { ignoreToaster } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/// The mockup's `.mdl`: a header with the title and a close button, a body, and a footer split off by
/// a hairline. For the small dialogs that sit over a sheet or the window (Add MCP server, a routine,
/// a key), so each one is the same box instead of drawing its own.
export function Modal({
  open,
  onClose,
  title,
  lead,
  width = 480,
  footer,
  hideClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /// Drawn before the title, e.g. a tile.
  lead?: ReactNode;
  width?: number;
  footer?: ReactNode;
  /// A question is answered by its own buttons, so it carries no dismiss.
  hideClose?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-70 bg-black/[0.42] data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={ignoreToaster}
          style={{ width: `min(${width}px, calc(100vw - 48px))` }}
          className={cn(
            "fixed top-1/2 left-1/2 z-70 flex max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-(--r4) bg-(--sheet) text-ink shadow-(--shadow) ring-1 ring-line2 outline-none data-open:animate-pop-in",
            className,
          )}
        >
          <div className="flex shrink-0 items-center gap-3 px-5 pt-[18px] pb-2">
            {lead}
            <DialogPrimitive.Title className="flex-1 text-base leading-[1.3] font-semibold tracking-[-0.015em]">{title}</DialogPrimitive.Title>
            {!hideClose && (
              <DialogPrimitive.Close
                aria-label="Close"
                className="grid size-[26px] cursor-pointer place-items-center rounded-md text-ink2 transition-colors outline-none hover:bg-s3 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X className="size-[15px]" />
              </DialogPrimitive.Close>
            )}
          </div>
          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5">{children}</div>
          {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 pt-3 pb-4">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/// A field's label: small, quiet, with room above it.
export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-4 mb-[7px] ml-0.5 text-xs leading-normal font-medium text-ink3 first:mt-0.5", className)}>{children}</div>;
}

/// The sentence under a form.
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("px-1 py-2 text-xs leading-[1.55] text-ink3", className)}>{children}</p>;
}
