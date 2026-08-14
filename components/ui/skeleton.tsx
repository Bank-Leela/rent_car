import * as React from "react"

import { cn } from "@/lib/utils"

// Pulsing placeholder block. Decorative — `aria-hidden`; the surrounding
// loading region carries the screen-reader status. The pulse is neutralised
// under `prefers-reduced-motion` (see globals.css).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-md bg-foreground/[0.07] dark:bg-white/[0.07]", className)}
      {...props}
    />
  )
}

export { Skeleton }
