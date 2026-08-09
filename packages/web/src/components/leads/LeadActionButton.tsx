import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface LeadActionButtonProps {
  to: string;
  accessibleName: string;
  children: ReactNode;
  variant: ComponentProps<typeof Button>["variant"];
  size: ComponentProps<typeof Button>["size"];
  className?: string;
  /**
   * Why this action is unavailable. Present ⇒ the button is inert and this is
   * shown on its tooltip. A reason is required rather than a bare boolean: a
   * greyed-out control with no explanation is the thing that generates support
   * questions.
   */
  disabledReason?: string;
  /** Shown on the tooltip when the action *is* available. Icon-only sites. */
  tooltip?: ReactNode;
}

/**
 * The shared shape of the two Lead actions — Quote and Mark as Sold (PAC-56 #17).
 *
 * ## Why the disabled state is not `<Button asChild disabled>`
 *
 * `asChild` spreads props onto a Radix `Slot`, which forwards them to the
 * `<a>`. Anchors have no `disabled` attribute, so React passes it through as an
 * invalid one and the link **still navigates** — a greyed-out button that works
 * is worse than no gate at all.
 *
 * ## Why `aria-disabled` rather than a real `disabled` button
 *
 * A `disabled` button is removed from the tab order, so `TooltipTrigger` never
 * fires for a keyboard user and the reason becomes unreachable — precisely the
 * users for whom "it looks grey" conveys nothing. `aria-disabled` keeps it
 * focusable and announced while `onClick`/`preventDefault` and
 * `pointer-events` on the icon keep it inert.
 */
export function LeadActionButton({
  to,
  accessibleName,
  children,
  variant,
  size,
  className,
  disabledReason,
  tooltip,
}: LeadActionButtonProps) {
  // `relative z-10` lifts it above the stretched row link in LeadsTable /
  // LeadCard, whose ::after covers the whole row.
  const shared = cn("relative z-10", className);

  if (disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            aria-disabled
            aria-label={`${accessibleName} — ${disabledReason}`}
            // Not `disabled`: see the docblock. Both handlers are needed —
            // `onClick` for the pointer, and stopping propagation so the click
            // does not fall through to the row link underneath.
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            className={cn(
              shared,
              "cursor-not-allowed opacity-50 hover:bg-inherit",
            )}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    );
  }

  const button = (
    <Button asChild variant={variant} size={size} className={shared}>
      <Link
        to={to}
        onClick={(e) => e.stopPropagation()}
        aria-label={accessibleName}
      >
        {children}
      </Link>
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
