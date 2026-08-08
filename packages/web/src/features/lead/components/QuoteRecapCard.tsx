import type {
  LeadDetailQuoteRecap,
  LeadDetailQuoteRecapSummary,
} from "@sfa/shared";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Home,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { openDocumentInNewTab } from "@/lib/open-document";
import { getQuoteDocumentDownload } from "@/lib/quote-recaps-api";
import { cn } from "@/lib/utils";
import {
  formatAddress,
  formatCurrency,
  formatDate,
  statusBadgeClass,
} from "./lead-display";

interface QuoteRecapCardProps {
  latest: LeadDetailQuoteRecap;
  earlier: LeadDetailQuoteRecapSummary[];
}

/**
 * The uploaded quote document, openable (PAC-56 #10 + #30).
 *
 * Was a filename in plain text — the file was on the page but there was no way
 * to look at it. Clicking now opens it in a new tab in the browser's own PDF
 * viewer, and the user downloads from there; we build neither a viewer nor a
 * download button.
 *
 * The URL is fetched per click rather than rendered into an `href`, because it
 * is a short-lived presigned GET: baking one into the DOM on page load would
 * hand out a link that expires while the producer is still reading the page,
 * and would leak a live document URL into anything that scrapes the markup.
 */
function DocumentLink({
  recapId,
  filename,
}: {
  recapId: string;
  filename: string;
}) {
  const [opening, setOpening] = useState(false);

  const open = async () => {
    setOpening(true);
    try {
      await openDocumentInNewTab(async () => {
        const { downloadUrl } = await getQuoteDocumentDownload(recapId);
        return downloadUrl;
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn’t open the document",
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={opening}
      className="mt-3 flex max-w-full items-center gap-2 rounded text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      {opening ? (
        <Loader2 size={13} className="shrink-0 animate-spin" />
      ) : (
        <FileText size={13} className="shrink-0" />
      )}
      <span className="truncate underline-offset-2 hover:underline">
        {filename}
      </span>
      <ExternalLink size={11} className="shrink-0" aria-hidden />
      <span className="sr-only">Opens in a new tab</span>
    </button>
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
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Quote Summary
        </h2>
        <div className="flex items-center gap-2">
          {latest.status && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                statusBadgeClass(latest.status),
              )}
            >
              {latest.status}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            Quoted {formatDate(latest.quoteDate)}
          </span>
        </div>
      </div>

      <div className="px-5 py-4">
        {latest.policies.length > 0 ? (
          <ul className="divide-y divide-border">
            {latest.policies.map((policy, index) => (
              <li
                key={`${policy.policyType}-${index}`}
                className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-card-foreground">
                    {policy.policyType}
                  </span>
                  {/*
                    Each property policy names the building it insures
                    (PAC-56 #14). Recaps written before that carry one address
                    for the whole proposal — rendered below the list instead.
                  */}
                  {policy.propertyAddress && (
                    <span className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Home size={12} className="mt-0.5 shrink-0" />
                      <span className="break-words">
                        {formatAddress(policy.propertyAddress)}
                      </span>
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    {policy.itemCount} item{policy.itemCount === 1 ? "" : "s"}
                  </span>
                  <span className="font-medium text-card-foreground">
                    {formatCurrency(policy.premium)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          // Migrated recaps carry the totals but not the per-policy rows.
          <p className="text-sm text-muted-foreground">
            {latest.productsQuoted.join(", ") || "No policy detail recorded."}
          </p>
        )}

        {/*
          Pre-PAC-56-#14 recaps only: one address for the whole proposal, which
          is exactly what could not describe a home plus a landlord policy.
          Newer recaps put it on the row above and leave this null.
        */}
        {latest.propertyAddress && (
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Home size={13} className="mt-0.5 shrink-0" />
            <span className="break-words">
              Property · {formatAddress(latest.propertyAddress)}
            </span>
          </p>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Total · {latest.itemCount} item{latest.itemCount === 1 ? "" : "s"}
          </span>
          <span className="text-base font-semibold text-card-foreground">
            {formatCurrency(latest.premium)}
          </span>
        </div>

        {latest.notes && (
          <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">
            {latest.notes}
          </p>
        )}

        {latest.document && (
          <DocumentLink
            recapId={latest.id}
            filename={latest.document.filename}
          />
        )}
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
          <CollapsibleTrigger className="flex w-full items-center justify-between px-5 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <span>
              {earlier.length} earlier recap{earlier.length === 1 ? "" : "s"}
            </span>
            <ChevronDown
              size={14}
              className={cn(
                "transition-transform",
                showEarlier && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="divide-y divide-border border-t border-border">
              {earlier.map((recap) => (
                <li
                  key={recap.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm"
                >
                  <span className="text-muted-foreground">
                    {formatDate(recap.quoteDate)}
                    {recap.productsQuoted.length > 0 && (
                      <span> · {recap.productsQuoted.join(", ")}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {recap.status && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          statusBadgeClass(recap.status),
                        )}
                      >
                        {recap.status}
                      </span>
                    )}
                    <span className="text-card-foreground">
                      {formatCurrency(recap.premium)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
