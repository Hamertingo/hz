import { useSyncExternalStore, type ReactNode } from "react"

import { cn } from "@/lib/utils"

type ToastItem = {
  id: number
  message: string
  icon?: ReactNode
  action?: { label: string; onClick: () => void }
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

/// Shows a message at the bottom of the window and returns a function that takes
/// it away early. With an `action` the toast waits for a click until `ms` runs
/// out — long enough to reach for Undo, short enough not to pile up.
export function toast(
  message: string,
  opts: { action?: ToastItem["action"]; icon?: ReactNode; ms?: number } = {}
): () => void {
  const id = nextId++
  items = [...items, { id, message, icon: opts.icon, action: opts.action }]
  emit()
  setTimeout(() => dismiss(id), opts.ms ?? 3400)
  return () => dismiss(id)
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/// Mounted once, at the root. `data-toaster` is what the sheet and the dialogs
/// look for so a click here does not count as one outside them.
export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => items
  )
  return (
    <div
      data-toaster
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 z-130 flex -translate-x-1/2 flex-col-reverse items-center gap-1.5"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex animate-pop-in items-center gap-2.5 rounded-full bg-(--pop) py-1.5 pr-1.5 pl-3.5 text-[12.5px] whitespace-nowrap text-ink shadow-(--shadow) ring-1 ring-line2",
            !t.action && "pr-3.5"
          )}
        >
          {t.icon && <span className="text-ink2 [&_svg]:size-[13px]">{t.icon}</span>}
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="cursor-pointer rounded-full bg-s3 px-2.5 py-1 font-medium text-ink transition-colors hover:bg-line3"
              onClick={(e) => {
                e.stopPropagation()
                t.action?.onClick()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
