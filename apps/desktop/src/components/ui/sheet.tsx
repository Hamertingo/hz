import { useEffect, useState, type ReactNode } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Maximize2, Minimize2, X } from "lucide-react"

import { cn } from "@/lib/utils"

/// A click on a toast is outside the panel as far as Radix can tell, and would
/// dismiss whatever the toast's Undo was about. Shared with `confirm-dialog`.
export function ignoreToaster(e: Event) {
  const target = (e as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent?.target ?? e.target
  if (target instanceof Element && target.closest("[data-toaster]")) e.preventDefault()
}

const FLOAT_BTN =
  "grid size-[30px] place-items-center rounded-(--r2) text-ink3 transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

/// One panel, two homes. `docked` hangs off the right edge for something read
/// beside the chat; `centered` sits in the middle, wider, with a button to take
/// the whole window, for something configured. `bare` drops the header for a
/// body that brings its own banner and title, leaving the buttons floating
/// over it.
///
/// Radix Dialog underneath, so Escape closes the topmost layer only: a confirm
/// opened from a sheet takes the first Escape and the sheet the second, with no
/// stack of our own to keep in step.
function Sheet({
  open,
  onOpenChange,
  mode = "docked",
  width = 540,
  title,
  sub,
  icon,
  bare = false,
  expandable = true,
  footer,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: "docked" | "centered"
  /// Pixels. Docked fixes the width; centered caps it, and the panel narrows
  /// with the window.
  width?: number
  /// Always required: a bare sheet still names itself to a screen reader.
  title: string
  sub?: string
  icon?: ReactNode
  bare?: boolean
  /// A centered sheet offers a full-screen button unless this is off.
  expandable?: boolean
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  const [full, setFull] = useState(false)
  const centered = mode === "centered"

  // Reopening should not resume in full screen: it is a state of one viewing.
  useEffect(() => {
    if (!open) setFull(false)
  }, [open])

  const buttons = (
    <>
      {centered && expandable && (
        <button
          type="button"
          className={cn(FLOAT_BTN, !bare && "ml-auto")}
          aria-label={full ? "Exit full screen" : "Full screen"}
          onClick={() => setFull((f) => !f)}
        >
          {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      )}
      <DialogPrimitive.Close className={cn(FLOAT_BTN, !bare && !centered && "ml-auto")} aria-label="Close">
        <X className="size-[15px]" />
      </DialogPrimitive.Close>
    </>
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="sheet-overlay"
          className={cn(
            "fixed inset-0 z-60 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            centered ? "bg-black/55 backdrop-blur-[2px]" : "bg-black/35"
          )}
        />
        <DialogPrimitive.Content
          data-slot="sheet"
          data-mode={mode}
          data-full={full || undefined}
          aria-describedby={undefined}
          onInteractOutside={ignoreToaster}
          style={centered && !full ? { width: `min(${width}px, calc(100vw - 48px))` } : !centered ? { width: `min(${width}px, calc(100vw - 24px))` } : undefined}
          className={cn(
            "fixed z-60 flex flex-col overflow-hidden rounded-(--r4) bg-(--sheet) text-ink shadow-(--shadow) ring-1 ring-line2 backdrop-blur-xl outline-none",
            centered
              ? full
                ? "inset-3.5"
                : "top-1/2 left-1/2 max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 data-open:animate-pop-in"
              : "top-3.5 right-3.5 bottom-3.5 data-open:animate-slide-in",
            className
          )}
        >
          {bare ? (
            <>
              <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
              <div className="absolute top-3 right-3 z-10 flex gap-1 [&>button]:bg-black/40 [&>button]:text-white [&>button]:backdrop-blur-md [&>button:hover]:bg-black/60 [&>button:hover]:text-white">
                {buttons}
              </div>
            </>
          ) : (
            <div className="flex h-[58px] flex-none items-center gap-3 border-b border-line pr-3 pl-5">
              {icon}
              <div className="min-w-0">
                <DialogPrimitive.Title className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">
                  {title}
                </DialogPrimitive.Title>
                {sub && <div className="truncate text-xs text-ink3">{sub}</div>}
              </div>
              {buttons}
            </div>
          )}
          <div className={cn("min-h-0 flex-1 overflow-y-auto", !bare && "px-6 pt-[22px] pb-[30px]")}>{children}</div>
          {footer && <div className="flex flex-none items-center justify-end gap-2 border-t border-line px-5 pt-3 pb-4">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export { Sheet }
