import { useEffect, useState, type ReactNode } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { ignoreToaster } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"

/// Ask before something that cannot be undone. With `typeToConfirm` the button
/// stays disabled until the reader types that exact text, which is for the few
/// actions (deleting a workspace, an agent with its memory) where a second click
/// is too easy to give.
///
/// A Radix Dialog, so opened from a sheet it is the topmost layer and takes the
/// first Escape.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger = true,
  typeToConfirm,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  danger?: boolean
  typeToConfirm?: string
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState("")
  useEffect(() => {
    if (!open) setTyped("")
  }, [open])
  const ready = typeToConfirm === undefined || typed === typeToConfirm

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-70 bg-black/55 backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={ignoreToaster}
          className="fixed top-1/2 left-1/2 z-70 flex w-[min(470px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[18px] bg-(--pop) px-6 pt-6 pb-[18px] text-ink shadow-(--shadow) ring-1 ring-line2 backdrop-blur-xl outline-none data-open:animate-pop-in"
        >
          <div>
            <DialogPrimitive.Title className="text-[17px] font-semibold tracking-[-0.015em]">
              {title}
            </DialogPrimitive.Title>
            {description && <div className="mt-1 text-[13px] leading-normal text-ink3">{description}</div>}
          </div>
          {typeToConfirm !== undefined && (
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-ink2">Type “{typeToConfirm}” to confirm</span>
              <Input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready) {
                    onConfirm()
                    onOpenChange(false)
                  }
                }}
              />
            </label>
          )}
          <div className="flex justify-end gap-2 pt-0.5">
            <Button variant="outline" className="h-[34px]" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant={danger ? "destructive" : "default"}
              className="h-[34px]"
              disabled={!ready}
              onClick={() => {
                onConfirm()
                onOpenChange(false)
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
