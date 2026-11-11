import { FileText, UserRound } from "lucide-react";
import { DataRow, DetailCard, SectionLabel } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  formatDate,
} from "@/features/lead/components/lead-display";
import type {
  DealAuditReviewLead,
  DealAuditReviewQuoteRecap,
} from "@/lib/deal-audits-api";

/**
 * What was quoted, beside what was sold (PAC-106) — the first thing the
 * manager checks the sale against.
 *
 * The recap is the one the sale names, else the lead's latest before the sale
 * (the API decides). With none, the card says so rather than rendering a grid
 * of N/A: most migrated sales name no recap, and an empty grid would read as a
 * recap with nothing in it.
 */
export function QuoteInfoCard({
  quote,
  lead,
  onViewQuote,
  onViewLead,
}: {
  quote: DealAuditReviewQuoteRecap | null;
  lead: DealAuditReviewLead | null;
  onViewQuote: () => void;
  onViewLead: () => void;
}) {
  return (
    <DetailCard
      title="Quote information"
      icon={FileText}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onViewQuote}
            disabled={!quote}
          >
            View quote recap
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onViewLead}
            disabled={!lead}
          >
            <UserRound />
            View lead
          </Button>
        </div>
      }
    >
      {quote ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <DataRow label="Quoted" value={formatDate(quote.quoteDate)} />
            <DataRow
              label="Premium"
              value={
                <span className="tabular-nums">
                  {formatCurrency(quote.premium)}
                </span>
              }
            />
            <DataRow
              label="Items"
              value={<span className="tabular-nums">{quote.itemCount}</span>}
            />
            <DataRow label="Quoted by" value={quote.producerName} />
          </div>

          {quote.policies.length > 0 && (
            <div>
              <SectionLabel className="mb-1.5">Quoted lines</SectionLabel>
              <ul className="flex flex-col gap-1 text-sm">
                {quote.policies.map((line, index) => (
                  <li
                    key={`${line.policyType}-${index}`}
                    className="flex justify-between gap-3"
                  >
                    <span className="text-card-foreground">
                      {line.policyType}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatCurrency(line.premium)} · {line.itemCount}{" "}
                      {line.itemCount === 1 ? "item" : "items"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!quote.document && (
            <p className="text-sm text-muted-foreground">
              No quote document was uploaded with this recap.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No quote recap on file for this sale.
        </p>
      )}
    </DetailCard>
  );
}
