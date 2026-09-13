import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { carriersKey, getCarriers } from "@/lib/carriers-api";
import { getPolicy, rewritePolicy } from "@/lib/policies-api";
import { newSubmissionToken } from "@/lib/submission-token";
import { SoldDealWizard } from "./components/SoldDealWizard";
import {
  toPolicyInput,
  type SoldDealFormValues,
} from "./components/sold-deal-schema";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const money = (value: number) =>
  `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/**
 * `/policies/:policyId/rewrite` — cancel a policy and write its replacement.
 *
 * The **same wizard** as `/sold/new`, in its rewrite variant: a policy needs the
 * same information to exist however it came about, so the cards, the validation
 * and the documents are identical. Two cards are dropped — prior insurance
 * (the policy being replaced is already ours) and the transfer picker (the
 * policy being cancelled is the one in the URL, not one chosen from a list).
 *
 * **Policy-scoped rather than ticket-scoped**, which is the difference from
 * `PolicyTransferPage`. A rewrite starts from the policy a service rep has open,
 * and the server clamps it to the caller's data scope through
 * `loadOwnedPolicy` — the same check `PATCH /policies/:id` uses, so a typed URL
 * cannot reach a policy the user could not otherwise edit.
 *
 * The cancellation is **not** applied when this page opens. Nothing happens
 * until the wizard is submitted, and then the cancellation, the replacement and
 * the chargeback all commit in one transaction — which is what makes "a policy
 * cannot be Cancel Rewrite without its replacement" true rather than merely
 * intended. Abandoning this page leaves the policy exactly as it was.
 */
export default function PolicyRewritePage() {
  const { policyId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // In a ref, not state: a retry after a failed submit must reuse the same
  // token, which is what makes the retry idempotent server-side rather than
  // booking a second replacement.
  const submissionToken = useRef(newSubmissionToken());

  const policyQuery = useQuery({
    queryKey: ["policy", policyId],
    queryFn: () => getPolicy(policyId),
    enabled: OBJECT_ID.test(policyId),
  });

  const carriersQuery = useQuery({
    queryKey: carriersKey,
    queryFn: getCarriers,
    staleTime: 30 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: (values: SoldDealFormValues) =>
      rewritePolicy(policyId, {
        // The wizard's date field is `soldDate` in every variant. Here it means
        // the cancellation date, which is also the replacement's sold date —
        // the server uses the one value for both, so they cannot disagree.
        cancelledAt: values.soldDate,
        policies: values.policies.map(toPolicyInput),
        submissionToken: submissionToken.current,
      }),
    onSuccess: (result) => {
      // A rewrite moves the household's policy list, the producer scorecards and
      // the audit queue at once, and retires the policy this page was opened on.
      void queryClient.invalidateQueries({ queryKey: ["policy", policyId] });
      void queryClient.invalidateQueries({ queryKey: ["household"] });
      void queryClient.invalidateQueries({ queryKey: ["performance"] });
      void queryClient.invalidateQueries({ queryKey: ["deal-audits"] });

      /*
       * Say what it cost, in the toast, now.
       *
       * A chargeback that first shows up on a payslip is exactly the surprise
       * this flow exists to prevent, and the two branches are genuinely
       * different news: inside the window the producer also loses the original
       * credit, outside it they keep it.
       */
      toast.success(
        result.withinClawbackWindow
          ? `Policy rewritten — ${money(result.chargebackAmount)} charged back and taken off the original sale (cancelled within a month).`
          : `Policy rewritten — ${money(result.chargebackAmount)} charged back. The original sale keeps its credit.`,
      );
      navigate(`/policies/${result.cancelledPolicyId}`, { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!OBJECT_ID.test(policyId)) {
    return <Navigate to="/clients" replace />;
  }

  const policy = policyQuery.data;
  const backTo = `/policies/${policyId}`;

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
          <Link to={backTo} aria-label="Back to policy">
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <div>
          <h1 className="text-sm font-bold">Cancel &amp; rewrite</h1>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            {policy?.policyNumber
              ? `Replacing ${policy.policyNumber}`
              : "Cancel this policy and write its replacement"}
          </p>
        </div>
      </header>

      <main className="px-4 md:px-6 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {(policyQuery.isPending || carriersQuery.isPending) && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Loading policy…
            </div>
          )}

          {policyQuery.isError && (
            <RewriteBlocked
              title="Couldn't load this policy."
              detail={policyQuery.error.message}
              backTo={backTo}
            />
          )}

          {/*
            A failed carrier fetch **blocks**, exactly as on the Sold form and
            the transfer: falling through to free text would mean one network
            blip silently removes the carrier vocabulary and its policy-number
            rules.
          */}
          {carriersQuery.isError && (
            <RewriteBlocked
              title="Couldn't load the carrier list."
              detail={carriersQuery.error.message}
              backTo={backTo}
            />
          )}

          {/*
            The server-side rejections, mirrored so a typed URL cannot walk into
            a wizard that will 409 on submit. Each matches a guard in
            `PolicyRewritesService.record`.
          */}
          {policy && !policy.active && (
            <RewriteBlocked
              title="This policy is not active."
              detail="Only a policy that is still in force can be cancelled and rewritten. Its replacement, if it has one, is the policy to rewrite instead."
              backTo={backTo}
            />
          )}

          {policy?.active && !policy.household && (
            <RewriteBlocked
              title="This policy is not linked to a household."
              detail="The replacement has to belong to someone. Link the policy to a household first — the unlinked-records view is where that is done."
              backTo={backTo}
            />
          )}

          {policy?.active && policy.household && carriersQuery.data && (
            <>
              <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                Nothing is cancelled until you submit. The cancellation, the
                replacement policy and the chargeback are written together.
              </p>
              <SoldDealWizard
                variant="rewrite"
                householdId={policy.household.id}
                /*
                 * The wizard's context is lead-shaped because the sale path
                 * built it. A rewrite has no lead, so only the fields the
                 * rewrite variant actually reads are meaningful: the client name
                 * in the header, and the contacts behind the defensive-driver
                 * picker — which this flow does not collect, hence the empty
                 * list. Same compromise the transfer page makes.
                 */
                context={{
                  leadId: "",
                  primaryContactName: policy.household.primaryContactName ?? "",
                  householdId: policy.household.id,
                  householdName: policy.household.name,
                  contacts: [],
                  leadStatus: "",
                  hasQuoteRecap: false,
                }}
                carriers={carriersQuery.data}
                submitting={mutation.isPending}
                errorMessage={error}
                onSubmit={(values) => {
                  setError(null);
                  mutation.mutate(values);
                }}
              />
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function RewriteBlocked({
  title,
  detail,
  backTo,
}: {
  title: string;
  detail: string;
  backTo: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-6">
      <p className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle size={16} />
        {title}
      </p>
      <p className="text-sm text-muted-foreground">{detail}</p>
      <Button asChild variant="outline" size="sm">
        <Link to={backTo}>Back to the policy</Link>
      </Button>
    </div>
  );
}
