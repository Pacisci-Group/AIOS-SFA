import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getPolicy, rewritePolicy } from "@/lib/policies-api";
import { newSubmissionToken } from "@/lib/submission-token";
import { toPolicyInput } from "../components/sold-deal-schema";
import {
  carrierError,
  OBJECT_ID,
  useCarrierCatalog,
  type FlowBlock,
  type SoldFlow,
} from "./sold-flow";

interface RewriteModeArgs {
  policyId: string;
  enabled: boolean;
}

const money = (value: number) =>
  `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/**
 * `/sold/new?rewritePolicyId={id}` — cancel a policy and write its replacement.
 *
 * **Policy-scoped rather than lead- or ticket-scoped**, which is the difference
 * from the other two modes. A rewrite starts from the policy a service rep has
 * open, and the server clamps it to the caller's data scope through
 * `loadOwnedPolicy` — the same check `PATCH /policies/:id` uses, so a typed URL
 * cannot reach a policy the user could not otherwise edit.
 *
 * The cancellation is **not** applied when the page opens. Nothing happens until
 * the wizard is submitted, and then the cancellation, the replacement and the
 * chargeback all commit in one transaction — which is what makes "a policy
 * cannot be Cancel Rewrite without its replacement" true rather than merely
 * intended. Abandoning the page leaves the policy exactly as it was.
 */
export function useRewriteMode({
  policyId,
  enabled,
}: RewriteModeArgs): SoldFlow {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // In a ref, not state: a retry after a failed submit must reuse the same
  // token, which is what makes the retry idempotent server-side rather than
  // booking a second replacement.
  const submissionToken = useRef(newSubmissionToken());

  const usable = enabled && OBJECT_ID.test(policyId);

  const policyQuery = useQuery({
    queryKey: ["policy", policyId],
    queryFn: () => getPolicy(policyId),
    enabled: usable,
  });

  const carriersQuery = useCarrierCatalog();
  const policy = policyQuery.data;
  const householdId = policy?.household?.id ?? null;

  const mutation = useMutation({
    mutationFn: (values: Parameters<SoldFlow["onSubmit"]>[0]) =>
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
      // the audit queue at once, and retires the policy it started from.
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

      /*
       * Back to the **household**, not to the policy just retired.
       *
       * The policy the rep started from is now inactive and replaced; landing on
       * it shows a dead record, and the next thing they want is the client's new
       * line-up. The household page is also where the rewrite was started from
       * in the common case. `household.id` is guaranteed here — the flow blocks
       * without one, because the replacement has to belong to someone.
       */
      navigate(
        householdId
          ? `/clients/${householdId}`
          : `/policies/${result.cancelledPolicyId}`,
        { replace: true },
      );
    },
    onError: (err: Error) => setError(err.message),
  });

  /*
   * The server-side rejections, mirrored so a typed URL cannot walk into a
   * wizard that will 409 on submit. Each matches a guard in
   * `PolicyRewritesService.record`.
   */
  let blocked: FlowBlock | null = null;
  if (policy && !policy.active) {
    blocked = {
      title: "This policy is not active.",
      detail:
        "Only a policy that is still in force can be cancelled and rewritten. Its replacement, if it has one, is the policy to rewrite instead.",
    };
  } else if (policy?.active && !policy.household) {
    blocked = {
      title: "This policy is not linked to a household.",
      detail:
        "The replacement has to belong to someone. Link the policy to a household first — the unlinked-records view is where that is done.",
    };
  }

  return {
    variant: "rewrite",
    title: "Cancel & rewrite",
    subtitle: policy?.policyNumber
      ? `Replacing ${policy.policyNumber}`
      : "Cancel this policy and write its replacement",
    // Back to the policy while nothing has been written yet — that is where the
    // rep came from and the record still stands.
    backTo: `/policies/${policyId}`,
    backLabel: "Back to policy",
    redirect: OBJECT_ID.test(policyId) ? null : "/clients",
    loading:
      policyQuery.isPending || carriersQuery.isPending ? "Loading policy…" : null,
    errors: [
      ...(policyQuery.isError
        ? [
            {
              title: "Couldn't load this policy.",
              detail: policyQuery.error.message,
              retry: () => void policyQuery.refetch(),
            },
          ]
        : []),
      ...carrierError(carriersQuery),
    ],
    blocked,
    ready:
      !blocked && policy?.active && policy.household && carriersQuery.data
        ? {
            context: {
              /*
               * The wizard's context is lead-shaped because the sale path built
               * it. A rewrite has no lead, so only the fields the rewrite
               * variant actually reads are meaningful: the client name in the
               * header, and the contacts behind the defensive-driver picker —
               * which this flow does not collect, hence the empty list. Same
               * compromise the transfer mode makes.
               */
              leadId: "",
              primaryContactName: policy.household.primaryContactName ?? "",
              householdId: policy.household.id,
              householdName: policy.household.name,
              contacts: [],
              leadStatus: "",
              hasQuoteRecap: false,
            },
            carriers: carriersQuery.data,
            staff: [],
            householdId: policy.household.id,
            // Anchored on the policy: the server reads the household off it, so
            // the caller never names one it does not own.
            uploadScope: { kind: "policy-rewrite", policyId },
            notice:
              "Nothing is cancelled until you submit. The cancellation, the replacement policy and the chargeback are written together.",
          }
        : null,
    submitting: mutation.isPending,
    errorMessage: error,
    onSubmit: (values) => {
      setError(null);
      mutation.mutate(values);
    },
  };
}
