import { FileCheck2 } from "lucide-react";
import { DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  formatDate,
} from "@/features/lead/components/lead-display";
import type { DealAuditReviewPolicy } from "@/lib/deal-audits-api";
import { NOT_AVAILABLE } from "@/lib/not-available";

/**
 * The policies the sale bound, each with its new business application
 * (PAC-106) — the signed form the manager checks the sold date, effective
 * date and coverage against.
 *
 * Every migrated policy predates the application upload (#23), so "No
 * application on file" is common and is said in words, not a disabled button.
 */
export function SoldPoliciesCard({
  policies,
  soldDay,
  onViewApplication,
}: {
  policies: DealAuditReviewPolicy[];
  /** The agency-calendar sold day, `YYYY-MM-DD`. */
  soldDay: string | null;
  onViewApplication: (policy: DealAuditReviewPolicy) => void;
}) {
  return (
    <DetailCard
      title="Sold policies"
      icon={FileCheck2}
      action={
        <span className="text-sm text-muted-foreground">
          Sold {formatDate(soldDay)}
        </span>
      }
      bodyless
    >
      {policies.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          No policies are recorded against this sale.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {policies.map((policy) => (
            <li
              key={policy.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
            >
              <div className="min-w-0">
                <span className="block font-medium text-card-foreground">
                  {policy.policyType || NOT_AVAILABLE}
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {policy.policyNumber ?? NOT_AVAILABLE}
                  </span>
                </span>
                <span className="block text-sm text-muted-foreground">
                  {policy.carrier ?? NOT_AVAILABLE} ·{" "}
                  <span className="tabular-nums">
                    {formatCurrency(policy.premium)}
                  </span>{" "}
                  · effective {formatDate(policy.effectiveDate)}
                </span>
              </div>
              {policy.newBusinessApplication ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onViewApplication(policy)}
                >
                  View application
                </Button>
              ) : (
                <span className="text-sm text-muted-foreground">
                  No application on file
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}
