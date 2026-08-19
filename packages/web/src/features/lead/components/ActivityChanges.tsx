import type { ActivityChange } from "@sfa/shared";
import { ArrowRight } from "lucide-react";
import { formatCurrencyExact, formatDate } from "./lead-display";

interface ActivityChangesProps {
  changes: ActivityChange[];
}

/**
 * The before/after list on a `field_changed` timeline row (PAC-65 #9).
 *
 * Only owners and managers ever see one — the API omits these rows entirely for
 * anyone without `agency:changelogs:read`, so there is no permission check
 * here. A producer's timeline simply does not contain them.
 *
 * ## The server sends values, not sentences
 *
 * Each change carries a `kind` saying how to read `from`/`to`, and formatting
 * happens here. That is why a stored row can be re-labelled or re-formatted
 * later — the alternative, a pre-rendered `"Premium changed: $1,200 → $1,400"`
 * string, freezes today's wording into the database (which is what
 * `ServiceTicket.timeline` does, and why it cannot be filtered on).
 */
export function ActivityChanges({ changes }: ActivityChangesProps) {
  if (!changes.length) return null;

  return (
    <dl className="mt-1.5 space-y-1 rounded-r-md border-l-2 border-border bg-sunken py-2 pl-3 pr-2">
      {changes.map((change) => (
        <div
          key={change.field}
          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
        >
          <dt className="text-muted-foreground">{change.label}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-1.5 text-card-foreground">
            {/* The old value is struck through rather than merely dimmed: on a
                row of two similar numbers, "which one is current" has to be
                readable at a glance and without relying on colour. */}
            <span className="text-muted-foreground line-through">
              {formatValue(change)}
            </span>
            <ArrowRight
              aria-hidden
              className="size-3 shrink-0 self-center text-muted-foreground"
            />
            <span className="font-medium">{formatValue(change, "to")}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Render one side of a change.
 *
 * `null` means absent or cleared and renders as the house em-dash — the same
 * placeholder every other empty value on this page uses.
 */
function formatValue(change: ActivityChange, side: "from" | "to" = "from") {
  const value = side === "from" ? change.from : change.to;
  if (value === null) return "—";

  switch (change.kind) {
    case "currency":
      // `formatCurrencyExact`, never `formatCurrency` — the latter rounds to
      // whole dollars, which would render a 40-cent correction as no change.
      return typeof value === "number" ? formatCurrencyExact(value) : String(value);
    case "date":
      // Already `YYYY-MM-DD` from the server; `formatDate` splits a date-only
      // string by hand rather than parsing it as UTC midnight, which is what
      // keeps an effective date off the previous day.
      return typeof value === "string" ? formatDate(value) : String(value);
    case "list":
      return Array.isArray(value) ? value.join(", ") || "—" : String(value);
    case "number":
    case "text":
    default:
      return Array.isArray(value) ? value.join(", ") : String(value);
  }
}
