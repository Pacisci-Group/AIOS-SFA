import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DetailCardProps {
  title: string;
  /** Optional leading glyph, e.g. the emerald check on the Sold card. */
  icon?: LucideIcon;
  /** Tints {@link DetailCardProps.icon}; defaults to muted. */
  iconClassName?: string;
  /** Right-hand slot: status pills, a date, an edit trigger. */
  action?: ReactNode;
  /** Rendered under the title row, inside the header. */
  subheading?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Set when the card lays out its own body padding (lists, tables). */
  bodyless?: boolean;
}

/**
 * The Lead Detail card shell.
 *
 * Five cards — contact, prior insurance, quote summary, sold, household — were
 * each hand-writing the identical header (`flex flex-wrap items-center
 * justify-between gap-2 border-b border-border px-5 py-3` + an `h2`), and had
 * already drifted: two radii, two pill sizes, and the same icon at 12px and 13px
 * inside one card. One shell means fixing the spacing once.
 *
 * The title is a real heading — `text-sm font-semibold` in sentence case, not
 * the 10px uppercase muted micro-label it used to be. That treatment made every
 * card read as a footnote; it survives only for the sub-labels *inside* a card
 * (see {@link SectionLabel}).
 */
export function DetailCard({
  title,
  icon: Icon,
  iconClassName,
  action,
  subheading,
  children,
  className,
  bodyless = false,
}: DetailCardProps) {
  return (
    <section
      className={cn("rounded-xl border border-border bg-card", className)}
    >
      <header className="border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {Icon && (
              <Icon
                aria-hidden
                className={cn(
                  "size-5 shrink-0 text-muted-foreground",
                  iconClassName,
                )}
              />
            )}
            <h2 className="truncate text-sm font-semibold text-card-foreground">
              {title}
            </h2>
          </div>
          {action && (
            <div className="flex shrink-0 items-center gap-2">{action}</div>
          )}
        </div>
        {subheading}
      </header>

      {bodyless ? children : <div className="px-5 py-4">{children}</div>}
    </section>
  );
}

/**
 * A sub-label *within* a card — "Members", "Policies", a field name.
 *
 * The one surviving uppercase tier. It was `text-[10px] tracking-widest`, which
 * at a 15px root rendered at 10px: legible in a mockup, not on a monitor.
 */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-xs font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}
