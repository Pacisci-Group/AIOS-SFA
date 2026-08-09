import type { LeadDetailQuoteRecap } from "@sfa/shared";
import { ChevronDown, Home, MessageSquare } from "lucide-react";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { EditQuoteRecapAction } from "@/components/leads/EditQuoteRecapAction";
import { cn } from "@/lib/utils";
import { DetailCard, SectionLabel } from "./DetailCard";
import { QuoteDocumentLink } from "./QuoteDocumentLink";
import {
  formatAddress,
  formatCurrency,
  formatDate,
  statusBadgeClass,
} from "./lead-display";

interface QuoteRecapCardProps {
  latest: LeadDetailQuoteRecap;
  earlier: LeadDetailQuoteRecap[];
}

/**
 * The headline figure, above the rows that make it up.
 *
 * The total used to sit *below* the policy list, which is the wrong way round
 * for the question this card exists to answer. "What did we quote them?" is a
 * number; the breakdown is the supporting detail. Putting the number last meant
 * the reader assembled it themselves from the rows and then found the answer
 * after they no longer needed it — and "Total · 2 items" immediately under a
 * list of per-policy item counts read as one more row rather than a sum.
 */
function QuoteTotals({ recap }: { recap: LeadDetailQuoteRecap }) {
  const policyCount = recap.policies.length || recap.productsQuoted.length;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p className="text-2xl font-semibold tabular-nums text-card-foreground">
        {formatCurrency(recap.premium)}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          /yr
        </span>
      </p>
      <p className="text-sm tabular-nums text-muted-foreground">
        {policyCount > 0 && (
          <>
            {policyCount} {policyCount === 1 ? "policy" : "policies"}
            {" · "}
          </>
        )}
        {recap.itemCount} item{recap.itemCount === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/**
 * The producer's own words, marked as such.
 *
 * Notes rendered as a bare paragraph of muted text directly under
 * system-derived totals, so there was no way to tell whether a line was
 * something a person wrote or something the app computed. It now carries a
 * label, a rule and an attribution — the same treatment `ActivityTimeline` uses
 * for notes on this page (PAC-56 #29), which PAC-56 #13 names as the reference.
 */
function QuoteNotes({ recap }: { recap: LeadDetailQuoteRecap }) {
  if (!recap.notes) return null;

  const attribution = [recap.producerName, formatDate(recap.createdAt)]
    .filter((part) => part && part !== "—")
    .join(" · ");

  return (
    <div className="rounded-lg border-l-2 border-primary/50 bg-sunken py-2.5 pl-3 pr-3">
      <div className="flex items-center gap-1.5">
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
        <SectionLabel>Producer notes</SectionLabel>
      </div>
      <p className="mt-1.5 whitespace-pre-line text-base text-card-foreground">
        {recap.notes}
      </p>
      {attribution && (
        <p className="mt-1.5 text-sm text-muted-foreground">{attribution}</p>
      )}
    </div>
  );
}

/**
 * One recap's contents, shared by the current recap and each earlier one.
 *
 * Extracted so the expander shows the *same* thing the top of the card does —
 * an earlier recap that renders differently from the current one cannot be
 * compared against it, which is the only reason to open the expander at all.
 */
function QuoteRecapBody({ recap }: { recap: LeadDetailQuoteRecap }) {
  return (
    <div className="space-y-4">
      <QuoteTotals recap={recap} />

      {recap.policies.length > 0 ? (
        <ul className="divide-y divide-border border-y border-border">
          {recap.policies.map((policy, index) => (
            <li
              key={`${policy.policyType}-${index}`}
              className="flex items-start justify-between gap-3 py-2.5"
            >
              <span className="min-w-0">
                <span className="block text-base text-card-foreground">
                  {policy.policyType}
                </span>
                {/*
                  Each property policy names the building it insures
                  (PAC-56 #14). Recaps written before that carry one address
                  for the whole proposal — rendered below the list instead.
                */}
                {policy.propertyAddress && (
                  <span className="mt-0.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                    <Home className="mt-0.5 size-4 shrink-0" />
                    <span className="break-words">
                      {formatAddress(policy.propertyAddress)}
                    </span>
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-sm tabular-nums text-muted-foreground">
                  {policy.itemCount} item{policy.itemCount === 1 ? "" : "s"}
                </span>
                <span className="text-base font-medium tabular-nums text-card-foreground">
                  {formatCurrency(policy.premium)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        // Migrated recaps carry the totals but not the per-policy rows.
        <p className="text-base text-muted-foreground">
          {recap.productsQuoted.join(", ") || "No policy detail recorded."}
        </p>
      )}

      {/*
        Pre-PAC-56-#14 recaps only: one address for the whole proposal, which
        is exactly what could not describe a home plus a landlord policy.
        Newer recaps put it on the row above and leave this null.
      */}
      {recap.propertyAddress && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Home className="mt-0.5 size-4 shrink-0" />
          <span className="break-words">
            Property · {formatAddress(recap.propertyAddress)}
          </span>
        </p>
      )}

      <QuoteNotes recap={recap} />

      {recap.document && (
        <QuoteDocumentLink
          recapId={recap.id}
          filename={recap.document.filename}
          contentType={recap.document.contentType}
          size={recap.document.size}
        />
      )}
    </div>
  );
}

/**
 * Status + quote date + edit, the row that identifies a recap in a list of them.
 *
 * Edit is here rather than only on the current recap because an earlier recap
 * is just as likely to hold the typo — and `EditQuoteRecapAction` gates itself,
 * so this card takes no permission dependency.
 */
function RecapMeta({ recap }: { recap: LeadDetailQuoteRecap }) {
  return (
    <>
      {recap.status && (
        <Badge size="sm" className={cn("font-semibold", statusBadgeClass(recap.status))}>
          {recap.status}
        </Badge>
      )}
      <span className="text-sm tabular-nums text-muted-foreground">
        Quoted {formatDate(recap.quoteDate)}
      </span>
      <EditQuoteRecapAction recapId={recap.id} />
    </>
  );
}

/**
 * Block C — what was quoted.
 *
 * ## Why this is a summary and not the mockup's comparison table
 *
 * The Figma design shows a current-vs-proposed coverage comparison: annual and
 * monthly premium, liability limits, collision and comprehensive deductibles,
 * UM/UIM and med pay, side by side with the incumbent carrier.
 *
 * **None of that is capturable today.** The Quote Recap form (PAC-39) shipped
 * the spec's field set — policy type, premium, item count, plus totals, notes
 * and the uploaded document — and records no limits, deductibles or carrier at
 * all. There is also no "current coverage" source anywhere in the system: the
 * only prior-carrier data we hold arrives with the *Sold* form, after the quote
 * has already been accepted, and even then it is carrier names rather than
 * coverage levels.
 *
 * Rendering the comparison with empty rows would misrepresent the data as
 * missing rather than never-collected. If the comparison is still wanted it
 * needs the Quote Recap form and its schema extended first — a product call,
 * tracked as a follow-up under PAC-35. Please don't rebuild it from the design.
 */
export function QuoteRecapCard({ latest, earlier }: QuoteRecapCardProps) {
  const [showEarlier, setShowEarlier] = useState(false);

  return (
    <DetailCard
      title="Quote summary"
      bodyless
      action={<RecapMeta recap={latest} />}
    >
      <div className="px-5 py-4">
        <QuoteRecapBody recap={latest} />
      </div>

      {earlier.length > 0 && (
        <Collapsible
          open={showEarlier}
          onOpenChange={setShowEarlier}
          className="border-t border-border"
        >
          {/*
            A lead can hold several recaps — `quoteRecaps.leadId` is a plain
            index and the status vocabulary includes `Requote`. Showing only the
            newest without saying so would hide a requote's predecessor.
          */}
          <CollapsibleTrigger className="flex w-full items-center justify-between px-5 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <span>
              {earlier.length} earlier recap{earlier.length === 1 ? "" : "s"}
            </span>
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                showEarlier && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="divide-y divide-border border-t border-border">
              {earlier.map((recap) => (
                <li key={recap.id} className="bg-sunken/50 px-5 py-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <RecapMeta recap={recap} />
                  </div>
                  <QuoteRecapBody recap={recap} />
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </DetailCard>
  );
}
