import {
  isSoldLeadStatus,
  POLICY_REPLACEMENT_REASON_LABELS,
} from "@sfa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";
import {
  createSoldDeal,
  getSoldDealContext,
  getSoldStaff,
  soldStaffKey,
} from "@/lib/sold-deals-api";
import { newSubmissionToken } from "@/lib/submission-token";
import { toPolicyInput } from "../components/sold-deal-schema";
import {
  carrierError,
  OBJECT_ID,
  useCarrierCatalog,
  type FlowBlock,
  type SoldFlow,
} from "./sold-flow";

interface SaleModeArgs {
  leadId: string;
  quoteRecapId: string;
  enabled: boolean;
}

/**
 * `/sold/new?leadId={id}` — the Sold form (PAC-40).
 *
 * Lead-scoped like the Quote Recap form: the API resolves the household from the
 * lead, so a producer can never book a sale against a household they do not own.
 * `quoteRecapId` rides along when present — not every sale has a recorded quote,
 * so it is optional end to end.
 */
export function useSaleMode({
  leadId,
  quoteRecapId,
  enabled,
}: SaleModeArgs): SoldFlow {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // In a ref, not state: a retry after a failed submit must reuse the same
  // token, which is what makes the retry idempotent server-side rather than
  // booking a second deal.
  const submissionToken = useRef(newSubmissionToken());

  const usable = enabled && OBJECT_ID.test(leadId);

  const contextQuery = useQuery({
    queryKey: ["sold-deal-context", leadId],
    queryFn: () => getSoldDealContext(leadId),
    enabled: usable,
  });

  const carriersQuery = useCarrierCatalog();

  /**
   * Agency staff for the "Cancelled by → SFA staff" picker (PAC-65 #11).
   *
   * Reference data that barely changes, so a long `staleTime` keeps it off the
   * wire while a producer works through several leads.
   */
  const staffQuery = useQuery({
    queryKey: soldStaffKey,
    queryFn: getSoldStaff,
    staleTime: 30 * 60_000,
    enabled: usable,
  });

  const mutation = useMutation({
    mutationFn: (values: Parameters<SoldFlow["onSubmit"]>[0]) =>
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
       * Fired before the navigate on purpose: `canvas-confetti` renders into its
       * own canvas on `document.body`, outside React's tree, so the burst
       * outlives the route change instead of being unmounted mid-animation.
       */
      celebrate();
      navigate(`/leads/${leadId}`, { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  const context = contextQuery.data;
  const backTo = `/leads/${leadId}`;

  /*
   * Every block below is reachable only by a typed or stale URL — the Lead
   * Detail buttons disable for the same conditions.
   */
  let blocked: FlowBlock | null = null;
  if (context && !context.householdId) {
    // A lead with no household cannot be sold — the API returns 409. Blocking
    // here means the producer finds out before filling in seven cards.
    blocked = {
      title: "This lead is not linked to a household yet.",
      detail:
        "A sale is recorded against a household. Add one to the lead first, then come back.",
    };
  } else if (context?.householdId && isSoldLeadStatus(context.leadStatus)) {
    /*
     * The two PAC-56 #17 gates, mirrored from the buttons on Lead Detail so a
     * typed URL cannot walk around them. Deliberately *not* enforced by the
     * API: rejecting a sold lead there would break the `submissionToken` replay
     * guarantee, which exists so a create whose follow-up died can self-heal.
     */
    blocked = {
      title: "This lead is already sold.",
      detail:
        "Its deal is on the lead page, where individual policies can still be corrected.",
    };
  } else if (
    context?.householdId &&
    !context.hasQuoteRecap &&
    !context.replacementReason
  ) {
    /*
     * **Waived for a replacement** (PAC-126). A Cancel Rewrite or Company
     * Transfer is not a proposal being shopped — the carrier or the client
     * forced a change to coverage that is already sold — so there is no quote to
     * have recorded, and requiring one would dead-end the chain on a form with
     * nothing to put in it.
     *
     * Only the *gate* is waived. `hasQuoteRecap` still reports the truth beside
     * `replacementReason` rather than being forced true server-side, because a
     * field that lies about what exists misleads the next reader of it.
     */
    blocked = {
      title: "No quote has been recorded for this lead.",
      detail:
        "Record the quote first, so the sale has the proposal it came from.",
    };
  }

  /*
   * A replacement runs this same mode — it is an ordinary sale as far as the
   * wizard is concerned, and the server applies the retirement, the linking and
   * the chargeback from the lead's intent. Only the wording changes, because
   * "Mark as sold" is not what a rep cancelling a policy thinks they are doing.
   */
  const replacementReason = context?.replacementReason ?? null;

  return {
    /*
     * The `replacement` variant drops two cards the sale asks for. Prior
     * insurance, because the policy being replaced is already ours — there is
     * no other carrier to name, and the discounts card's "Prior insurance"
     * checkbox would otherwise make a card the variant never shows mandatory.
     * And the from-policy picker, because the policy being replaced is stamped
     * on the lead and the server injects it. Known at mount: the wizard only
     * renders once the context has loaded.
     */
    variant: replacementReason ? "replacement" : "sale",
    title: replacementReason
      ? `${POLICY_REPLACEMENT_REASON_LABELS[replacementReason]} — step 2 of 2`
      : "Mark as sold",
    subtitle: replacementReason
      ? "The replacement policy"
      : "Record the closed sale",
    backTo,
    backLabel: "Back to lead",
    redirect: OBJECT_ID.test(leadId) ? null : "/leads",
    loading: contextQuery.isPending || carriersQuery.isPending ? "Loading lead…" : null,
    errors: [
      ...(contextQuery.isError
        ? [
            {
              title: "Couldn't load this lead.",
              detail: contextQuery.error.message,
              retry: () => void contextQuery.refetch(),
            },
          ]
        : []),
      ...carrierError(carriersQuery),
    ],
    blocked,
    ready:
      !blocked && context?.householdId && carriersQuery.data
        ? {
            context,
            carriers: carriersQuery.data,
            staff: staffQuery.data ?? [],
            uploadScope: { kind: "lead", leadId },
            notice: replacementReason
              ? "Nothing is cancelled until you submit. The old policy is retired, the replacement is written and any chargeback is recorded together."
              : undefined,
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
