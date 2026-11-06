import type { ComponentProps, MouseEvent, ReactNode } from "react";
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
 * focusable and announced while `onClick`/`preventDefault` keeps it inert.
 *
 * ## Why the tooltip hangs off a wrapper, not the button
 *
 * An inert button must not react to the pointer, and every variant brings its
 * own `hover:` background. The first attempt cancelled that with
 * `hover:bg-inherit`, which does not mean "keep my background" — it inherits
 * the *parent's*, so the emerald Mark as Sold button went transparent under the
 * pointer and flickered as the transition ran (PAC-148 demo feedback). Naming
 * each variant's resting colour instead would be a list to keep in step with
 * `button.tsx`. So the button takes `pointer-events-none`, which means it never
 * matches `:hover` whatever the variant, and the wrapper is what the pointer
 * hits and what `TooltipTrigger` listens on. The button is still the thing a
 * keyboard focuses; its focus event bubbles to the wrapper, so the tooltip
 * opens for a keyboard user exactly as before.
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
    // Swallowed on both elements: the wrapper takes the pointer's click, the
    // button takes Enter / Space. Stopping propagation keeps the click from
    // falling through to the row link underneath.
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("inline-flex cursor-not-allowed", shared)}
            onClick={swallow}
          >
            <Button
              type="button"
              variant={variant}
              size={size}
              aria-disabled
              aria-label={`${accessibleName} — ${disabledReason}`}
              // Not `disabled`: see the docblock.
              onClick={swallow}
              className="pointer-events-none opacity-50"
            >
              {children}
            </Button>
          </span>
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
