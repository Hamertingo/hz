import { useEffect, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { fieldClassName } from "@/components/ui/input"
import { FieldLabel, Modal } from "@/components/ui/modal"

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

  const go = () => {
    onConfirm()
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title={title}
      width={440}
      hideClose
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "solid"} disabled={!ready} onClick={go}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="text-sm leading-[1.55] text-ink2">{description}</div>}
      {typeToConfirm !== undefined && (
        <label className="block">
          <FieldLabel>Type “{typeToConfirm}” to confirm</FieldLabel>
          <input
            autoFocus
            className={fieldClassName}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready) go()
            }}
          />
        </label>
      )}
    </Modal>
  )
}
