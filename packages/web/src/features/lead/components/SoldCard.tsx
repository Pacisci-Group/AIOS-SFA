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
 * ## The totals are the deal's own, not a sum of the rows
 *
 * `premium` / `itemCount` / `policyCount` are roll-ups the Sold form derived at
 * submission and stored on the deal. `PATCH /policies/:id` does not touch them,
 * so after a premium correction the total below can disagree with the rows above
 * it until the deal is recomputed. That is deliberate — silently rewriting a
 * deal's premium from the Lead Detail page would move the producer's Sold
 * scorecard and the leaderboard, which is a bigger decision than a typo fix.
 * Recomputing deal roll-ups belongs with the wider sold-edit work in PAC-56 #25.
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
