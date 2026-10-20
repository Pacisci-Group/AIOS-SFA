import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, ListChecks, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { DetailCard } from "@/components/common/DetailCard";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuditWorkflowPanel } from "@/features/producer/components/AuditWorkflowPanel";
import { formatDate } from "@/features/lead/components/lead-display";
import {
  dealAuditReviewKey,
  getDealAuditReview,
  type DealAuditReviewPolicy,
} from "@/lib/deal-audits-api";
import { cn } from "@/lib/utils";
import { ChecklistItemRow } from "./components/ChecklistItemRow";
import { QuoteInfoCard } from "./components/QuoteInfoCard";
import {
  ReviewDecisionDialog,
  type ReviewDecision,
} from "./components/ReviewDecisionDialog";
import { ReviewSummaryBar } from "./components/ReviewSummaryBar";
import { SENT_BACK_TEXT, businessDaysLabel } from "./components/review-display";
import { SoldPoliciesCard } from "./components/SoldPoliciesCard";
import { LeadDrawer } from "./drawers/LeadDrawer";
import { NbaDocumentDrawer } from "./drawers/NbaDocumentDrawer";
import { QuoteRecapDrawer } from "./drawers/QuoteRecapDrawer";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * `/deal-audits/:dealId` — the manager verifies a sale's audit, item by item
 * (PAC-106).
 *
 * **A page, not a drawer** — David turned the drawer down twice: the manager
 * reads the application, the quote and the checklist side by side, and a
 * drawer has room for one. 60/40: what was sold and what was claimed on the
 * left; the tally, the decision and the thread on the right, pinned while the
 * checklist scrolls.
 *
 * The manager sees **every** item, including the manager-only checks the
 * producer's drawer leaves out. Each one gets Pass or Fail (and a note);
 * Approve needs every item passed, Send back at least one failed.
 */
export default function DealAuditPage() {
  const { dealId = "" } = useParams<{ dealId: string }>();
  const valid = OBJECT_ID.test(dealId);

  const [drawer, setDrawer] = useState<"lead" | "quote" | null>(null);
  const [application, setApplication] = useState<DealAuditReviewPolicy | null>(
    null,
  );
  const [decision, setDecision] = useState<ReviewDecision | null>(null);

  const query = useQuery({
    queryKey: dealAuditReviewKey(dealId),
    queryFn: () => getDealAuditReview(dealId),
    enabled: valid,
  });

  if (!valid) {
    return <Navigate to="/deal-audits" replace />;
  }

  const view = query.data;
  const failedItems =
    view?.items.filter((item) => item.review.verdict === "fail") ?? [];

  return (
    <AppShell>
      <header className="flex items-center gap-2 border-b border-border px-4 py-4 md:gap-3 md:px-6">
        <MobileNav className="-ml-1" />
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <Link to="/deal-audits" aria-label="Back to deal audits">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {view?.deal.clientName ?? "Deal audit"}
          </h1>
          {view && (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span>
                Sold {formatDate(view.deal.soldDay)}
                {view.deal.producerName ? ` by ${view.deal.producerName}` : ""}
              </span>
              <span
                className={cn(
                  "tabular-nums",
                  view.deal.aging && cn("font-medium", SENT_BACK_TEXT),
                )}
              >
                · {businessDaysLabel(view.deal.businessDaysOpen)}
              </span>
              {view.deal.aging && (
                <Badge
                  size="sm"
                  className={cn("border-transparent bg-red-500/12", SENT_BACK_TEXT)}
                >
                  Aging
                </Badge>
              )}
            </p>
          )}
        </div>
      </header>

      <main className="px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-6xl">
          {query.isPending && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-base text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Loading the audit…
            </div>
          )}

          {query.isError && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center">
              <AlertCircle aria-hidden className="size-5 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {query.error.message || "Couldn't load this audit."}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                  Retry
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/deal-audits">Back to the queue</Link>
                </Button>
              </div>
            </div>
          )}

          {view && (
            <div className="grid gap-4 lg:grid-cols-5 lg:items-start">
              <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
                <QuoteInfoCard
                  quote={view.quoteRecap}
                  lead={view.lead}
                  onViewQuote={() => setDrawer("quote")}
                  onViewLead={() => setDrawer("lead")}
                />
                <SoldPoliciesCard
                  policies={view.policies}
                  soldDay={view.deal.soldDay}
                  onViewApplication={setApplication}
                />
                <DetailCard
                  title="Checklist"
                  icon={ListChecks}
                  subheading={
                    <span className="text-sm text-muted-foreground">
                      Every item, including the checks only a manager makes.
                      {view.audit.canReview
                        ? " Pass or fail each one."
                        : ""}
                    </span>
                  }
                  bodyless
                >
                  {view.items.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-muted-foreground">
                      This audit has no checklist items.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {view.items.map((item) => (
                        <ChecklistItemRow
                          key={item.id}
                          item={item}
                          dealId={dealId}
                          canRule={view.audit.canReview}
                        />
                      ))}
                    </ul>
                  )}
                </DetailCard>
              </div>

              <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:col-span-2">
                <ReviewSummaryBar
                  audit={view.audit}
                  onApprove={() => setDecision("approve")}
                  onSendBack={() => setDecision("send_back")}
                />
                <DetailCard title="Ownership and activity">
                  <AuditWorkflowPanel dealId={dealId} variant="review" />
                </DetailCard>
              </div>
            </div>
          )}
        </div>
      </main>

      {view && (
        <>
          <LeadDrawer
            lead={view.lead}
            open={drawer === "lead"}
            onClose={() => setDrawer(null)}
          />
          <QuoteRecapDrawer
            dealId={dealId}
            quote={view.quoteRecap}
            open={drawer === "quote"}
            onClose={() => setDrawer(null)}
          />
          <NbaDocumentDrawer
            policy={application}
            soldDay={view.deal.soldDay}
            onClose={() => setApplication(null)}
          />
          <ReviewDecisionDialog
            dealId={dealId}
            clientName={view.deal.clientName}
            decision={decision}
            failedItems={failedItems}
            onClose={() => setDecision(null)}
          />
        </>
      )}
    </AppShell>
  );
}
