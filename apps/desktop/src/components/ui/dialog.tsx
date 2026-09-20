import type * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

/// The frame's geometry, and the motion it arrives with. Split so a caller can
/// drop the second without re-stating the first — **overriding animation with a
/// later class does not work reliably**: `data-closed:animate-none` beside
/// `data-closed:animate-out` leaves both declarations in the stylesheet and the
/// winner is whichever Tailwind emits last, which is not the same answer for
/// `data-open:` and `data-closed:` (`animate-none` beats `animate-in`, and
/// `animate-out` beats `animate-none` — measured). Leaving the class off is the
/// only version of this that cannot drift.
const FRAME =
  "fixed top-1/2 left-1/2 z-50 grid w-full max-w-100 -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-popover backdrop-blur-xl p-5 text-popover-foreground shadow-lg";
const MOTION =
  "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

/// Frame, overlay and animation match `alert-dialog`'s exactly: to a reader the
/// two are the same object, and they differ only in whether the app is asking a
/// question or the reader opened something.
///
/// That difference is what `showClose` is. An alert is answered by its own
/// buttons, so it carries no dismiss; a dialog the reader opened is dismissed
/// rather than answered, and Escape alone is a way out only for people who
/// already know it is there.
function DialogContent({
  className,
  overlayClassName,
  animated = true,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showClose?: boolean
  /// `false` for a surface that should appear on one frame. A card can afford a
  /// fade — the reader keeps the app behind it, dimmed — and a surface that
  /// *replaces* the window cannot: a fade from zero opacity is the app showing
  /// through it.
  animated?: boolean
  /// The dimming, and it is a prop because a surface that fills the window has
  /// nothing left to dim: an overlay over a full-bleed page darkens the page
  /// itself, which on a see-through column reads as the whole screen going grey.
  /// The element stays either way — it is what tells the browser tab a modal is
  /// over it (`judgeOcclusion`) — so this only ever changes its colour.
  overlayClassName?: string
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn(
          "fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          overlayClassName
        )}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(FRAME, animated && MOTION, className)}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-5 right-5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-ui font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-ui text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
}
