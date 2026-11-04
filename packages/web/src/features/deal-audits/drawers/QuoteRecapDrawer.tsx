import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DrawerRow,
  DrawerSection,
} from "@/features/clients/components/drawer-primitives";
import {
  formatCurrency,
  formatDate,
} from "@/features/lead/components/lead-display";
import {
  getQuoteRecapDocumentUrl,
  type DealAuditReviewQuoteRecap,
} from "@/lib/deal-audits-api";
import { openDocumentInNewTab } from "@/lib/open-document";

/**
 * "View quote recap" on the Deal Audit page (PAC-106): the quote the sale came
 * from, in full, with the carrier's quote document.
 *
 * The document opens through the **audit's** route, not the quote recap's —
 * a Branch Manager holds no `quote_recaps:read`, and reaching the file
 * through the audit is the access they have.
 */
export function QuoteRecapDrawer({
  dealId,
  quote,
  open,
  onClose,
}: {
  dealId: string;
  quote: DealAuditReviewQuoteRecap | null;
  open: boolean;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState(false);

  const openDocument = async () => {
    setOpening(true);
    try {
      await openDocumentInNewTab(async () => {
        const { downloadUrl } = await getQuoteRecapDocumentUrl(dealId);
        return downloadUrl;
      });
    } catch {
      toast.error("Couldn't open the quote document. Try again.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <Sheet open={open && !!quote} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[440px] sm:max-w-[440px]"
      >
        {quote && (
          <>
            <SheetHeader className="gap-1 border-b border-border px-6 py-5">
              <SheetDescription>Quote recap</SheetDescription>
              <SheetTitle className="tabular-nums">
                {formatCurrency(quote.premium)} · {quote.itemCount}{" "}
                {quote.itemCount === 1 ? "item" : "items"}
              </SheetTitle>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
              <div>
                <DrawerRow label="Quoted" value={formatDate(quote.quoteDate)} />
                <DrawerRow label="Quoted by" value={quote.producerName} />
                <DrawerRow
                  label="Products"
                  value={
                    quote.productsQuoted.length
                      ? quote.productsQuoted.join(", ")
                      : null
                  }
                />
              </div>

              {quote.policies.length > 0 && (
                <DrawerSection title="Quoted lines">
                  {quote.policies.map((line, index) => (
                    <DrawerRow
                      key={`${line.policyType}-${index}`}
                      label={line.policyType}
                      value={
                        <span className="tabular-nums">
                          {formatCurrency(line.premium)} · {line.itemCount}{" "}
                          {line.itemCount === 1 ? "item" : "items"}
                        </span>
                      }
                    />
                  ))}
                </DrawerSection>
              )}

              {quote.notes && (
                <DrawerSection title="Notes">
                  <p className="whitespace-pre-line text-sm text-card-foreground">
                    {quote.notes}
                  </p>
                </DrawerSection>
              )}
            </div>

            <div className="border-t border-border px-6 py-4">
              {quote.document ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={opening}
                  onClick={() => void openDocument()}
                >
                  {opening ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                  View quote document
                </Button>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  No quote document was uploaded with this recap.
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
