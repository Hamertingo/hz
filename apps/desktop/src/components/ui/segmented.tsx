import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  /// Read out in place of the label when that is only a glyph.
  ariaLabel?: string
}

/// The mockup's `.seg`: a small tray with the current choice lifted out of it.
/// A radio group, so arrows move the choice and one Tab stop reaches it.
function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T
  onChange: (next: T) => void
  options: readonly SegmentedOption<T>[]
  className?: string
  label?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-slot="segmented"
      className={cn("inline-flex gap-px rounded-[8px] bg-s2 p-0.5", className)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
        if (!step) return
        e.preventDefault()
        const at = options.findIndex((o) => o.value === value)
        const next = options[(at + step + options.length) % options.length]
        onChange(next.value)
      }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[6px] px-2.5 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              on
                ? "bg-foreground/12 text-ink"
                : "text-ink2 hover:text-ink"
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export { Segmented }
