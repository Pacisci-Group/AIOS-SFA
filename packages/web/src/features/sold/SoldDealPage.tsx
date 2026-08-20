import { isSoldLeadStatus } from "@sfa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { carriersKey, getCarriers } from "@/lib/carriers-api";
import {
  createSoldDeal,
  getSoldDealContext,
  getSoldStaff,
  soldStaffKey,
} from "@/lib/sold-deals-api";
import { newSubmissionToken } from "@/lib/submission-token";
import { SoldDealWizard } from "./components/SoldDealWizard";
import {
  toPolicyInput,
  type SoldDealFormValues,
} from "./components/sold-deal-schema";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * `/sold/new?leadId={id}` — the Sold form (PAC-40).
 *
 * Lead-scoped like the Quote Recap form: the API resolves the household from
 * the lead, so a producer can never book a sale against a household they do not
 * own. `quoteRecapId` rides along when present — not every sale has a recorded
 * quote, so it is optional end to end.
 */
export default function SoldDealPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const leadId = searchParams.get("leadId") ?? "";
  const quoteRecapId = searchParams.get("quoteRecapId") ?? "";

  // In a ref, not state: a retry after a failed submit must reuse the same
  // token, which is what makes the retry idempotent server-side rather than
  // booking a second deal.
  const submissionToken = useRef(newSubmissionToken());

  const contextQuery = useQuery({
    queryKey: ["sold-deal-context", leadId],
    queryFn: () => getSoldDealContext(leadId),
    enabled: OBJECT_ID.test(leadId),
  });

  /**
   * The carrier catalog (PAC-56 #19), which the wizard needs before it can
   * render the carrier select or validate a policy number against its rule.
   *
   * Reference data that only an admin surface can change — and none exists yet
   * — so a long `staleTime` keeps it out of the way of a producer moving
   * between leads.
   */
  const carriersQuery = useQuery({
    queryKey: carriersKey,
    queryFn: getCarriers,
    staleTime: 30 * 60_000,
  });

  /**
   * Agency staff for the "Cancelled by → SFA staff" picker (PAC-65 #11).
   *
   * Same shape as the carrier catalog above and for the same reason: reference
   * data that barely changes, so a long `staleTime` keeps it off the wire while
   * a producer works through several leads.
   */
  const staffQuery = useQuery({
    queryKey: soldStaffKey,
    queryFn: getSoldStaff,
    staleTime: 30 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: (values: SoldDealFormValues) =>
      createSoldDeal({
        leadId,
        soldDate: values.soldDate,
        quoteRecapId: OBJECT_ID.test(quoteRecapId) ? quoteRecapId : undefined,
        policies: values.policies.map(toPolicyInput),
        submissionToken: submissionToken.current,
      }),
    onSuccess: (deal) => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["deal-audits"] });
      toast.success(
        `Sale booked — ${deal.policyCount} ${
          deal.policyCount === 1 ? "policy" : "policies"
        }`,
      );
      /*
       * PAC-65 #12. The scrum notes said "on lead review completion", but there
       * is no such thing in this product — the moment meant is this one, which
       * is also where the Aug-4 sold-notification precedent points.
       *
       * Fired before the navigate on purpose: `canvas-confetti` renders into
       * its own canvas on `document.body`, outside React's tree, so the burst
       * outlives the route change instead of being unmounted mid-animation.
       */
      celebrate();
      navigate(`/leads/${leadId}`, { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!OBJECT_ID.test(leadId)) {
    return <Navigate to="/leads" replace />;
  }

  return (
    <AppShell>
      <header className="flex items-center gap-2 border-b border-border px-4 py-4 md:gap-3 md:px-6">
        <MobileNav className="-ml-1" />
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-foreground"
        >
          <Link to={`/leads/${leadId}`} aria-label="Back to lead">
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <div>
          <h1 className="text-sm font-bold">Mark as sold</h1>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Record the closed sale
          </p>
        </div>
      </header>

      <main className="px-4 md:px-6 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {(contextQuery.isPending || carriersQuery.isPending) && (
            <div className="flex items-center gap-2 rounded-xl bg-card border border-border p-6 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Loading lead…
            </div>
          )}

          {contextQuery.isError && (
            <div className="rounded-xl bg-card border border-border p-6 space-y-3">
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle size={16} />
                {contextQuery.error.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void contextQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          )}

          {/*
            * A failed carrier fetch **blocks**, rather than falling through to
            * free text. Falling through would mean one network blip silently
            * removes the carrier vocabulary and its policy-number rules; a
            * delayed sale is better than a sale recorded against a mistyped
            * carrier with an unvalidated number.
            */}
          {carriersQuery.isError && (
            <div className="rounded-xl bg-card border border-border p-6 space-y-3">
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle size={16} />
                Couldn't load the carrier list.
              </p>
              <p className="text-sm text-muted-foreground">
                {carriersQuery.error.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void carriersQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          )}

          {/*
            * A lead with no household cannot be sold — the API returns 409.
            * Blocking here means the producer finds out before filling in
            * seven cards, not after.
            */}
          {contextQuery.data && !contextQuery.data.householdId && (
            <SoldBlocked
              title="This lead is not linked to a household yet."
              detail="A sale is recorded against a household. Add one to the lead first, then come back."
              leadId={leadId}
            />
          )}

          {/*
            * The two PAC-56 #17 gates, mirrored from the buttons on Lead Detail
            * so a typed URL cannot walk around them. Deliberately *not*
            * enforced by the API: rejecting a sold lead there would break the
            * `submissionToken` replay guarantee, which exists so a create whose
            * follow-up died can self-heal.
            */}
          {contextQuery.data?.householdId &&
            isSoldLeadStatus(contextQuery.data.leadStatus) && (
              <SoldBlocked
                title="This lead is already sold."
                detail="Its deal is on the lead page, where individual policies can still be corrected."
                leadId={leadId}
              />
            )}

          {contextQuery.data?.householdId &&
            !isSoldLeadStatus(contextQuery.data.leadStatus) &&
            !contextQuery.data.hasQuoteRecap && (
              <SoldBlocked
                title="No quote has been recorded for this lead."
                detail="Record the quote first, so the sale has the proposal it came from."
                leadId={leadId}
              />
            )}

          {contextQuery.data?.householdId &&
            contextQuery.data.hasQuoteRecap &&
            !isSoldLeadStatus(contextQuery.data.leadStatus) &&
            carriersQuery.data && (
              <SoldDealWizard
                context={contextQuery.data}
                carriers={carriersQuery.data}
                staff={staffQuery.data ?? []}
                submitting={mutation.isPending}
                errorMessage={error}
                onSubmit={(values) => {
                  setError(null);
                  mutation.mutate(values);
                }}
              />
            )}
        </div>
      </main>
    </AppShell>
  );
}

/**
 * A reason the wizard will not mount, with the way out.
 *
 * Every one of these is reachable only by a typed or stale URL — the Lead
 * Detail buttons disable for the same conditions — so the link back matters
 * more than the wording: whoever lands here got here by accident.
 */
function SoldBlocked({
  title,
  detail,
  leadId,
}: {
  title: string;
  detail: string;
  leadId: string;
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-6 space-y-2">
      <p className="flex items-center gap-2 text-base text-foreground">
        <AlertCircle className="size-4 shrink-0 text-destructive" />
        {title}
      </p>
      <p className="text-sm text-muted-foreground">{detail}</p>
      <Button asChild variant="outline" size="sm" className="mt-2">
        <Link to={`/leads/${leadId}`}>Back to the lead</Link>
      </Button>
    </div>
  );
}
