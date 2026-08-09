import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { createSoldDeal, getSoldDealContext } from "@/lib/sold-deals-api";
import { newSubmissionToken } from "@/lib/submission-token";
import { SoldDealWizard } from "./components/SoldDealWizard";
import {
  toPolicyInput,
  type SoldPolicyFormValues,
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

  const mutation = useMutation({
    mutationFn: (values: {
      soldDate: string;
      policies: SoldPolicyFormValues[];
    }) =>
      createSoldDeal({
        leadId,
        soldDate: values.soldDate,
        quoteRecapId: OBJECT_ID.test(quoteRecapId) ? quoteRecapId : undefined,
        // `discounts` is omitted entirely — Card 5 lands in PR4, and the server
        // defaults an absent object to "nothing selected".
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
          {contextQuery.isPending && (
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
            * A lead with no household cannot be sold — the API returns 409.
            * Blocking here means the producer finds out before filling in
            * seven cards, not after.
            */}
          {contextQuery.data && !contextQuery.data.householdId && (
            <div className="rounded-xl bg-card border border-border p-6 space-y-2">
              <p className="flex items-center gap-2 text-sm text-foreground">
                <AlertCircle size={16} className="text-amber-500" />
                This lead is not linked to a household yet.
              </p>
              <p className="text-xs text-muted-foreground">
                A sale is recorded against a household. Add one to the lead
                first, then come back.
              </p>
            </div>
          )}

          {contextQuery.data?.householdId && (
            <SoldDealWizard
              context={contextQuery.data}
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
