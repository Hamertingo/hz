import type * as React from "react"

import { cn } from "@/lib/utils"

/// The box alone, for a control that wants to look like an input while holding
/// more than one thing — a number with its unit beside it, say.
const inputClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"

/// The Studio field (`.fld` in the mockup): a faint fill with a hairline inside
/// it that brightens on focus. For the new screens; `inputClassName` is the
/// older box the rest of the app still draws.
const fieldClassName =
  "w-full min-w-0 rounded-(--r2) bg-s2 px-3 py-[9px] text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow placeholder:text-ink4 focus:shadow-[inset_0_0_0_1px_var(--line3)] disabled:opacity-50"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputClassName, className)}
      {...props}
    />
  )
}

export { Input, fieldClassName, inputClassName }
