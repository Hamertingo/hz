import type * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/// The mockup's `.tog`: a 30x18 pill, green when on. Green is the signal colour
/// for "this is running", the same one the status dot uses, so a switch and a
/// state agree at a glance.
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-[19px] w-8 shrink-0 cursor-pointer items-center rounded-full p-0 transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-green data-[state=unchecked]:bg-foreground/12",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[15px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/30%)] ring-0 transition-transform duration-200 data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
