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
 * The app's detail-page card shell.
 *
 * Five cards — contact, prior insurance, quote summary, sold, household — were
 * each hand-writing the identical header (`flex flex-wrap items-center
 * justify-between gap-2 border-b border-border px-5 py-3` + an `h2`), and had
 * already drifted: two radii, two pill sizes, and the same icon at 12px and 13px
 * inside one card. One shell means fixing the spacing once.
 *
 * It started in `features/lead/` and moved here when the ticket, household and
 * policy pages were brought onto the same design language — those three had
 * grown a third and fourth card idiom of their own (`rounded-lg` + an uppercase
 * micro-label header, and inline `style` objects) rather than reusing this one.
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

/**
 * A label-over-value pair inside a card body — the ticket detail's "Assigned
 * rep", the policy detail's "Carrier", the transfer panel's "Change".
 *
 * Sub-label on top, value below, both on the scale in
 * `styles/TYPOGRAPHY.md`. Three surfaces had written their own version of this
 * with three different label sizes; this is the one.
 */
export function DataRow({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <SectionLabel>{label}</SectionLabel>
      <span className="min-w-0 text-base text-card-foreground">
        {value ?? "—"}
      </span>
    </div>
  );
}
