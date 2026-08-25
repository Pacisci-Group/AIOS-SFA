import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * ⚠ This file carries local additions — the `success` variant and the whole
 * `size` scale. Re-running `npx shadcn@latest add badge` will drop them.
 * Re-add if that happens. (Same caveat as `button.tsx`'s `brand` variant.)
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        success: "bg-success text-success-foreground [a&]:hover:bg-success/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
      /**
       * Local addition, not stock shadcn.
       *
       * Status pills across Leads and Lead Detail were each hand-rolling
       * `text-[10px] px-2 py-0.5 font-semibold` overrides and drifting apart —
       * the same pill rendered at three sizes on three surfaces. A `cva`
       * variant is what AGENTS.md §11 asks for instead of one-off wrappers.
       *
       * `sm` is the dense in-table/in-list pill; `default` is stock.
       */
      size: {
        sm: "px-2 py-0 text-xs [&>svg]:size-3",
        default: "px-2 py-0.5 text-xs [&>svg]:size-3",
        lg: "px-2.5 py-0.5 text-sm [&>svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      data-size={size}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
