import type { LeadDetailHousehold } from "@sfa/shared";
import { Users } from "lucide-react";
import { formatCurrency, formatDate, initials } from "./lead-display";

interface HouseholdCardProps {
  household: LeadDetailHousehold | null;
}

/**
 * The household roster and its policies.
 *
 * ## Policies are household-level, not per-member
 *
 * The mockup shows a strip of small policy icons beside each person — Auto on
 * one member, Home on another. That is **not derivable**: `Policy` links to
 * `Household` and to `Deal`, and never to a `Contact`, so nothing in the system
 * records which member a policy belongs to. Attributing them per person would
 * mean guessing.
 *
 * Policies are therefore summarised once for the household. Same class of gap
 * as the coverage-comparison table in `QuoteRecapCard` — a schema change, not
 * an unfinished port.
 */
export function HouseholdCard({ household }: HouseholdCardProps) {
  if (!household) {
    return (
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Users size={14} className="text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Household
          </h2>
        </div>
        <p className="px-5 py-4 text-sm text-muted-foreground">
          This lead isn’t linked to a household yet.
        </p>
      </section>
    );
  }

  const activePolicies = household.policies.filter((policy) => policy.active);
  const premium = activePolicies.reduce(
    (total, policy) => total + policy.premium,
    0,
  );

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Users size={14} className="shrink-0 text-muted-foreground" />
          <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {household.name ?? "Household"}
          </h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {activePolicies.length || household.totalActivePolicies} active
          {premium > 0 && <> · {formatCurrency(premium)}/yr</>}
        </span>
      </div>

      {household.members.length > 0 ? (
        <ul className="divide-y divide-border">
          {household.members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 px-5 py-3">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-bold text-primary"
              >
                {initials(member.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm text-card-foreground">
                  {member.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    member.isPrimary ? "Primary" : member.role,
                    member.dateOfBirth
                      ? `DOB ${formatDate(member.dateOfBirth)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          No household members on file.
        </p>
      )}

      {household.policies.length > 0 && (
        <div className="border-t border-border px-5 py-3">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Household policies
          </p>
          <ul className="mt-2 space-y-1.5">
            {household.policies.map((policy) => (
              <li
                key={policy.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="text-card-foreground">
                  {policy.policyType || "Policy"}
                  {policy.carrier && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {policy.carrier}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {policy.active ? "Active" : (policy.status ?? "Inactive")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
