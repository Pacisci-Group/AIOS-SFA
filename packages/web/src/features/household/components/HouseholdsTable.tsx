import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { HouseholdListRow } from "@/lib/households-api";
import { formatPhone } from "@/lib/leads-api";
import {
  formatUpdated,
  householdStatusClass,
  matchLabel,
} from "./household-filters";

/** Household · Status · Policies · Contact · Location · Updated · chevron */
const GRID_COLS = "1.9fr 100px 90px 1.5fr 1fr 90px 24px";

/*
 * No "Primary Contact" column, though the API returns the field.
 *
 * In the migrated book it is empty on 99.6% of households — the SmartSuite
 * import never wrote it — and where a primary contact *can* be resolved from
 * `contacts`, their name is the household's name ("Randall Smith" / "Randall
 * Smith"). So the column rendered an em dash on almost every row and duplicated
 * the first one on the rest. `Updated` is populated on 100% and tells the
 * reader something the Household column does not.
 */
const HEADERS = [
  "Household",
  "Status",
  "Policies",
  "Contact",
  "Location",
  "Updated",
  "",
];

interface HouseholdsTableProps {
  households: HouseholdListRow[];
  isPending: boolean;
  pageSize: number;
}

/**
 * Desktop Clients table. CSS-grid rows rather than the `Table` primitive,
 * matching the pattern already established by `LeadsTable` and the Users page.
 *
 * Seven columns need ~960px before the household name and email start
 * truncating, so `HouseholdsListPage` shows this only from `lg` and renders
 * cards below that; the `min-w` + `overflow-x-auto` pair lets it scroll inside
 * its own card on the narrow half of that range rather than crushing columns.
 */
export function HouseholdsTable({
  households,
  isPending,
  pageSize,
}: HouseholdsTableProps) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[960px] rounded-xl overflow-hidden bg-card border border-border">
        <div
          className="grid px-5 py-2.5 gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b border-border"
          style={{ gridTemplateColumns: GRID_COLS }}
        >
          {HEADERS.map((header, i) => (
            <span key={header || `spacer-${i}`}>{header}</span>
          ))}
        </div>

        {isPending
          ? Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
              <div
                key={i}
                className="grid px-5 py-3.5 gap-3 items-center border-b border-border"
                style={{ gridTemplateColumns: GRID_COLS }}
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3 w-6" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-4 justify-self-end" />
              </div>
            ))
          : households.map((household, i) => (
              <div
                key={household.id}
                className={cn(
                  "relative grid px-5 py-3.5 gap-3 items-center transition-colors hover:bg-muted/50",
                  i < households.length - 1 && "border-b border-border",
                )}
                style={{ gridTemplateColumns: GRID_COLS }}
              >
                <span className="min-w-0">
                  {/* Stretched link: the whole row is clickable while the name
                      stays the one real, focusable target. */}
                  <Link
                    to={`/clients/${household.id}`}
                    className="block text-base text-foreground font-medium truncate after:absolute after:inset-0 after:content-['']"
                  >
                    {household.name ?? "Unnamed household"}
                  </Link>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {household.householdRef && (
                      <span className="tabular-nums">
                        {household.householdRef}
                      </span>
                    )}
                    {/* Why this row is here, when its own name isn't the reason
                        — a policy-number search returns households whose names
                        match nothing the user typed. */}
                    {household.matchedOn && (
                      <span className="truncate text-primary">
                        {matchLabel(household.matchedOn)}
                      </span>
                    )}
                  </span>
                </span>

                <Badge
                  size="sm"
                  className={cn(
                    "w-fit font-semibold",
                    householdStatusClass(household.status),
                  )}
                >
                  {household.status ?? "Unknown"}
                </Badge>

                <span className="text-sm text-muted-foreground tabular-nums">
                  {household.totalActivePolicies}
                </span>

                <span className="min-w-0 text-sm text-muted-foreground">
                  <span className="block truncate">
                    {formatPhone(household.primaryPhone)}
                  </span>
                  <span className="block truncate text-xs">
                    {household.primaryEmail ?? "—"}
                  </span>
                </span>

                <span className="text-sm text-muted-foreground truncate">
                  {[household.city, household.state].filter(Boolean).join(", ") ||
                    "—"}
                </span>

                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatUpdated(household.updatedAt)}
                </span>

                <ChevronRight className="size-4 text-muted-foreground justify-self-end" />
              </div>
            ))}
      </div>
    </div>
  );
}
