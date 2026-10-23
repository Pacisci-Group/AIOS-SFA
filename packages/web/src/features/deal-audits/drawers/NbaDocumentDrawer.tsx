import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDate } from "@/features/lead/components/lead-display";
import type { DealAuditReviewPolicy } from "@/lib/deal-audits-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { getNbaDocumentUrl } from "@/lib/policies-api";

/**
 * "View application" on the Deal Audit page (PAC-106): the signed new
 * business application, framed in place, with the **sold date** and the
 * **effective date** beside it — the two dates the manager checks the form
 * against (David, 24 Aug).
 *
 * The URL is fetched when the drawer opens and never cached past it: it is a
 * short-lived presigned link, and a drawer reopened ten minutes later must not
 * frame a dead one. The application is always a PDF (the Sold form refuses
 * anything else), so a frame renders it with the browser's own viewer; **Open
 * in new tab** is there for a browser that will not.
 */
export function NbaDocumentDrawer({
  policy,
  soldDay,
  onClose,
}: {
  policy: DealAuditReviewPolicy | null;
  /** The agency-calendar sold day, `YYYY-MM-DD`. */
  soldDay: string | null;
  onClose: () => void;
}) {
  const application = useQuery({
    queryKey: ["policy-nba", policy?.id],
    queryFn: () => getNbaDocumentUrl(policy!.id),
    enabled: !!policy,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });

  return (
    <Sheet open={!!policy} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl"
      >
        {policy && (
          <>
            <SheetHeader className="gap-1 border-b border-border px-6 py-5">
              <SheetDescription>New business application</SheetDescription>
              <SheetTitle>
                {policy.policyType}{" "}
                <span className="font-normal text-muted-foreground tabular-nums">
                  {policy.policyNumber ?? NOT_AVAILABLE}
                </span>
              </SheetTitle>
              <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <DateFact label="Sold date" value={formatDate(soldDay)} />
                <DateFact
                  label="Effective date"
                  value={formatDate(policy.effectiveDate)}
                />
                <DateFact
                  label="Carrier"
                  value={policy.carrier ?? NOT_AVAILABLE}
                />
              </dl>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col">
              {application.isPending ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  Loading the application…
                </div>
              ) : application.isError ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                  <AlertCircle aria-hidden className="size-5 text-destructive" />
                  <p className="text-sm text-muted-foreground">
                    {application.error.message ||
                      "Couldn't load the application."}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void application.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <iframe
                  src={application.data.downloadUrl}
                  title={`New business application, ${policy.policyNumber ?? policy.policyType}`}
                  className="min-h-[60vh] w-full flex-1 border-0 bg-muted"
                />
              )}
            </div>

            <div className="border-t border-border px-6 py-4">
              <Button
                asChild={!!application.data}
                variant="outline"
                className="w-full"
                disabled={!application.data}
              >
                {application.data ? (
                  <a
                    href={application.data.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink />
                    Open in new tab
                  </a>
                ) : (
                  <span>Open in new tab</span>
                )}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DateFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium text-card-foreground tabular-nums">
        {value}
      </dd>
    </div>
  );
}
