import { ChevronRight, Mail, MapPin, Phone, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HouseholdListRow } from "@/lib/households-api";
import { formatPhone } from "@/lib/leads-api";
import { householdStatusClass, matchLabel } from "./household-filters";

/**
 * Phone and tablet Clients row. Below `lg` the table's 7 columns don't fit, so
 * each household becomes a stacked card — the same information, laid out
 * vertically.
 */
export function HouseholdCard({ household }: { household: HouseholdListRow }) {
  const location = [household.city, household.state].filter(Boolean).join(", ");

  return (
    <div className="relative flex items-center gap-3 px-4 py-3.5 rounded-xl bg-card border border-border transition-colors hover:bg-muted/50 active:scale-[0.99]">
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to={`/clients/${household.id}`}
            className="text-base text-foreground font-medium truncate after:absolute after:inset-0 after:content-['']"
          >
            {household.name ?? "Unnamed household"}
          </Link>
          <Badge
            size="sm"
            className={cn(
              "shrink-0 font-semibold",
              householdStatusClass(household.status),
            )}
          >
            {household.status ?? "Unknown"}
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {household.householdRef && (
            <span className="tabular-nums">{household.householdRef}</span>
          )}
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 shrink-0" />
            <span className="tabular-nums">{household.totalActivePolicies}</span>
          </span>
        </div>

        {/* Why this row is here, when its own name isn't the reason. */}
        {household.matchedOn && (
          <p className="text-sm text-primary truncate">
            {matchLabel(household.matchedOn)}
          </p>
        )}

        {household.primaryPhone && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Phone className="size-4 shrink-0" />
            {formatPhone(household.primaryPhone)}
          </p>
        )}
        {household.primaryEmail && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground truncate">
            <Mail className="size-4 shrink-0" />
            <span className="truncate">{household.primaryEmail}</span>
          </p>
        )}
        {location && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground truncate">
            <MapPin className="size-4 shrink-0" />
            <span className="truncate">{location}</span>
          </p>
        )}
      </div>

      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
    </div>
  );
}
