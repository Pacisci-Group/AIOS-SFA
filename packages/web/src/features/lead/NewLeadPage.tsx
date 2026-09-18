import { POLICY_REPLACEMENT_REASON_LABELS } from "@sfa/shared";
import type { PolicyReplacementReason } from "@sfa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { leadIntakeFromHousehold } from "@/features/household/components/start-quote-prefill";
import { getHousehold } from "@/lib/households-api";
import { createLead } from "@/lib/lead-intake-api";
import { getPolicy } from "@/lib/policies-api";
import { LeadIntakeForm } from "./components/LeadIntakeForm";
import {
  newSubmissionToken,
  type LeadIntakeFormValues,
} from "./components/lead-intake-schema";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function isReplacementReason(
  value: string,
): value is PolicyReplacementReason {
  return value === "cancel_rewrite" || value === "company_transfer";
}

/**
 * `/leads/new` — the authenticated New Lead form (PAC-37), and the destination
 * the shared `AddLeadButton` has been pointing at since PAC-17.
 *
 * ## Also step 1 of a replacement (PAC-126)
 *
 * `?replacePolicyId=<id>&reason=<cancel_rewrite|company_transfer>` turns this
 * into the first of two forms. A Cancel Rewrite and a Company Transfer run
 * through the ordinary Sold pipeline, which is anchored on a lead — so one is
 * created here, stamped with the policy it replaces, and the page hands straight
 * off to the Sold form rather than to the lead it just made.
 *
 * Three things change in that mode, and nothing else does:
 *
 * 1. **The form is prefilled** from the policy's household, reusing the Start
 *    Quote dialog's `leadIntakeFromHousehold`. Every field is already on the
 *    record; making a rep retype a birthday they can see is how the typo that
 *    splits a household in two gets made. Lead source is deliberately left
 *    blank — it describes where *this* enquiry came from, which is the one thing
 *    the household cannot know.
 * 2. **The created lead carries the intent**, which is what makes the chain
 *    resumable if the rep closes the tab here, and what makes the Sold submit
 *    retire the old policy instead of booking an ordinary sale.
 * 3. **On success it goes to the Sold form**, not to the lead. The lead is a
 *    means, not the destination.
 */
export default function NewLeadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  // Held in a ref, not form state: it must survive a failed submit unchanged,
  // because that is exactly what makes the retry idempotent server-side rather
  // than creating a second lead.
  const submissionToken = useRef(newSubmissionToken());

  const replacePolicyId = searchParams.get("replacePolicyId") ?? "";
  const rawReason = searchParams.get("reason") ?? "";
  /*
   * Both params or neither. A `replacePolicyId` with an unrecognised reason is
   * read as an ordinary New Lead rather than guessed at — the two reasons apply
   * different money rules, and picking one for the rep is the error that shows
   * up on a payslip.
   */
  const replacement =
    OBJECT_ID.test(replacePolicyId) && isReplacementReason(rawReason)
      ? { policyId: replacePolicyId, reason: rawReason }
      : null;

  const policyQuery = useQuery({
    queryKey: ["policy", replacePolicyId],
    queryFn: () => getPolicy(replacePolicyId),
    enabled: Boolean(replacement),
  });

  const householdId = policyQuery.data?.household?.id ?? null;
  const householdQuery = useQuery({
    queryKey: ["household", householdId],
    queryFn: () => getHousehold(householdId ?? ""),
    enabled: Boolean(replacement && householdId),
  });

  /*
   * Seeded once, and the form is keyed on the household below so a late arrival
   * re-seeds it: `useAppForm`'s `defaultValues` are not reactive, so a form
   * mounted before the household loaded would stay empty forever.
   */
  const initialValues = useMemo(
    () =>
      householdQuery.data
        ? leadIntakeFromHousehold(householdQuery.data)
        : undefined,
    [householdQuery.data],
  );

  const mutation = useMutation({
    mutationFn: (values: LeadIntakeFormValues) =>
      createLead({
        primaryContact: values.primaryContact,
        address: values.address,
        members: values.members,
        // No policies of interest and no property address: this form does not
        // ask (PAC-56 #2 scopes that to the public one), and sending the unasked
        // defaults would record a choice the producer never made.
        leadSourceCode: values.leadSourceCode ?? "",
        submissionToken: submissionToken.current,
        replacementIntent: replacement ?? undefined,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });

      /*
       * A replacement hands straight off to the Sold form — the second half of
       * the chain. `replace` on purpose: Back from the Sold form should return
       * the rep to the policy they started from, not to a lead-creation form
       * that would create a *second* lead if they submitted it again.
       */
      if (replacement) {
        navigate(`/sold/new?leadId=${created.id}`, { replace: true });
        return;
      }
      navigate(`/leads/${created.id}`, { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  const backTo = replacement ? `/policies/${replacement.policyId}` : "/leads";
  /*
   * The household query is *disabled* until the policy names a household, and
   * a disabled query reports `isPending` forever. So it only counts as loading
   * once there is a household to load — otherwise a policy that comes back
   * with `household: null` (unlinked, or linked to a household outside the
   * caller's scope) would leave the page on "Loading the client…" with no
   * error and no form.
   */
  const loadingContext = Boolean(
    replacement &&
      (policyQuery.isPending || (householdId && householdQuery.isPending)),
  );
  const policyHasNoHousehold = Boolean(
    replacement && policyQuery.data && !policyQuery.data.household,
  );
  const contextError = replacement
    ? (policyQuery.error?.message ??
      householdQuery.error?.message ??
      (policyHasNoHousehold
        ? "This policy is not linked to a household, so a replacement cannot be written for it. Link it to a household first."
        : null))
    : null;

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
          <Link
            to={backTo}
            aria-label={replacement ? "Back to policy" : "Back to leads"}
          >
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <div>
          <h1 className="text-sm font-bold">
            {replacement
              ? `${POLICY_REPLACEMENT_REASON_LABELS[replacement.reason]} — step 1 of 2`
              : "New lead"}
          </h1>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {replacement ? "Who is this for?" : "Household intake"}
          </p>
        </div>
      </header>

      <main className="px-4 md:px-6 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {replacement && (
            <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              Nothing is cancelled yet. This records who the replacement is for;
              the next step is the policy itself, and the two are written
              together at the end.
            </p>
          )}

          {loadingContext && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Loading the client…
            </div>
          )}

          {contextError && (
            <div className="space-y-3 rounded-xl border border-border bg-card p-6">
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle size={16} />
                Couldn't load the client this replacement is for.
              </p>
              <p className="text-sm text-muted-foreground">{contextError}</p>
              <Button asChild variant="outline" size="sm">
                <Link to={backTo}>Back to the policy</Link>
              </Button>
            </div>
          )}

          {!loadingContext && !contextError && (
            <LeadIntakeForm
              /*
               * Keyed on the household so the prefill is re-read once it
               * arrives. `defaultValues` are captured on mount, so without this
               * a form rendered before the fetch resolved would stay blank.
               */
              key={householdId ?? "new"}
              variant="internal"
              initialValues={initialValues}
              submitting={mutation.isPending}
              errorMessage={error}
              submitLabel={replacement ? "Continue to the policy" : undefined}
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
