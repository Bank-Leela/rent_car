import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Buttons are pills, and rank by HOW FILLED they are — not by how many colours
 * are in play. Modelled on YouTube's action row: one saturated solid for the
 * single real action, everything beside it a flat tonal capsule with no border,
 * and a plain ghost for the rest. Because only one button on a screen is
 * saturated, that button is unmissable without anything else being shouted at.
 *
 * The tonal fill is a TRANSLUCENT overlay (`bg-foreground/8`), not a solid token
 * like `bg-secondary`, and that is load-bearing rather than stylistic. This
 * app's light theme puts near-white cards (--card 1.0) on a grey ground
 * (--background 0.965), while --secondary is 0.95 — a flat secondary fill
 * differs from the page ground by ~1.5% lightness and effectively disappears on
 * it, while reading fine on a card. An overlay instead darkens (light theme) or
 * lightens (dark theme) whatever is actually behind it, so one class is correct
 * on the ground, on a card, and on a popover. `--foreground` flips with the
 * theme, so the same utility does both.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // hover:bg-primary/90 is not redundant with the [a]: rule below it: that
        // one only matches when the button renders as an anchor, so an actual
        // <button variant="default"> — every submit button in the app — had no
        // hover state whatsoever. "Hover gives visual feedback" is the rule it
        // was failing.
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 [a]:hover:bg-primary/80",
        // The tonal capsule — the workhorse beside the primary. Borderless on
        // purpose: the fill alone separates it, the way Share/Save/Ask do. It
        // keeps the name `outline` because that is what ~40 call sites ask for,
        // and every one of them wants "the secondary action", not literally an
        // outline. Still a FILL and not `ghost`: sitting between two filled
        // buttons with nothing but text, it read as disabled label rather than
        // as the third choice (see approver-queue-actions' force-approve).
        outline:
          "bg-foreground/[0.07] text-foreground hover:bg-foreground/[0.12] aria-expanded:bg-foreground/[0.12] dark:bg-foreground/[0.10] dark:hover:bg-foreground/[0.16] dark:aria-expanded:bg-foreground/[0.16]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        // No per-size radius any more: every size is a pill, so the corner is
        // the one thing that never changes between a filter chip and the submit
        // button. The `in-data-[slot=button-group]` overrides went with them —
        // nothing in the app has ever set that slot.
        xs: "h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1 px-3.5 text-[0.8rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        // The primary-action size. Every size is a pill now, so this one is no
        // longer distinguished by its corner — it is distinguished by mass:
        // 48px tall with generous padding, against a 40px default. It also
        // clears the 44px touch minimum, which `default` does not. Pair it with
        // `variant="default"` and nothing else saturated on the screen, and it
        // is the one thing a page unmistakably asks you to do.
        xl: "h-12 gap-2 rounded-full px-7 text-base has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5 [&_svg:not([class*='size-'])]:size-[18px]",
        // Circular, now that the base radius is a pill — the same shape as
        // YouTube's search/mic controls.
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
