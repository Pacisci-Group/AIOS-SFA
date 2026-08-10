import type { LeadDetailDeal } from "@sfa/shared";
import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DetailCard, SectionLabel } from "./DetailCard";
import { formatCurrency, formatDate } from "./lead-display";
import { EditPolicyDialog } from "./EditPolicyDialog";
import { PolicyRow } from "./PolicyRow";

interface SoldCardProps {
  deal: LeadDetailDeal;
  /** The edit dialog patches this lead's cached detail. */
  leadId: string;
}

/**
 * The sale — Block D, below the quote summary (PAC-56 #27).
 *
 * David asked for a "Sold card placed below the quote summary, allowing quick
 * edits to sold policies". Position is part of the request: the page reads
 * quoted → sold, so the card that says what was actually bound belongs directly
 * under what was proposed.
 *
 * Each policy carries its own edit dialog rather than one "edit this sale"
 * button, because that is what "quick edits to sold policies" describes — and
 * because a per-policy patch is a correction, whereas an edit of the deal would
 * have to decide what happens to the audit items the sale generated.
 *
 * ## The totals are the deal's own, and are now kept in step (PAC-56 #25)
 *
 * `premium` / `itemCount` / `policyCount` are roll-ups stored on the deal, not
 * summed from the rows below. `PATCH /policies/:id` used to leave them alone, so
 * a premium correction left this footer disagreeing with the row above it; it
 * now recomputes them, and `useUpdatePolicy` invalidates the lead detail so the
 * footer follows.
 *
 * ⚠ Two consequences worth knowing before editing a premium here:
 *   - **It moves reported numbers.** The Sold scorecard sums `deals.premium`
 *     and the leaderboard ranks on it, so a correction here changes a producer's
 *     dashboard figure. Intended — a scorecard built on numbers known to be
 *     wrong is worse — but not a silent side effect.
 *   - **Migrated deals are skipped.** The recompute is gated on
 *     `premiumSource === 'snapshot'`, i.e. deals this app created. A migrated
 *     deal's premium is SmartSuite's rollup over rows we may hold only part of,
 *     so recomputing would overwrite a historical figure with a subset.
 */
export function SoldCard({ deal, leadId }: SoldCardProps) {
  return (
    <DetailCard
      title="Sold"
      icon={CheckCircle2}
      iconClassName="text-emerald-700 dark:text-emerald-500"
      action={
        <>
          {deal.isBundle && (
            <Badge
              size="sm"
              className="bg-emerald-500/12 font-semibold text-emerald-700 dark:text-emerald-500"
            >
              Bundle
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {deal.dealType} · Sold {formatDate(deal.soldDate)}
          </span>
        </>
      }
    >
      <div>
        {deal.policies.length > 0 ? (
          <ul className="divide-y divide-border">
            {deal.policies.map((policy) => (
              <li
                key={policy.id}
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <PolicyRow policy={policy} />
                </div>
                <EditPolicyDialog leadId={leadId} policy={policy} />
              </li>
            ))}
          </ul>
        ) : (
          /*
           * A migrated deal whose policies carry only `legacyDealId` — the
           * migration never linked them back. Saying so beats implying the sale
           * bound nothing, and the policy types the deal *does* record are the
           * next best thing.
           */
          <p className="text-base text-muted-foreground">
            {deal.policyTypes.join(", ") ||
              "No policy detail linked to this sale."}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
          <SectionLabel>
            Total · {deal.itemCount} item{deal.itemCount === 1 ? "" : "s"} ·{" "}
            {deal.policyCount}{" "}
            {deal.policyCount === 1 ? "policy" : "policies"}
          </SectionLabel>
          <span className="text-lg font-semibold tabular-nums text-card-foreground">
            {formatCurrency(deal.premium)}
          </span>
        </div>
      </div>
    </DetailCard>
  );
}
