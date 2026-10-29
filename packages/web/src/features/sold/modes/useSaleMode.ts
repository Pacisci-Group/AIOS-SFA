import {
  CARRIER_OTHER,
  carrierSlug,
  isSoldLeadStatus,
  POLICY_REPLACEMENT_REASON_LABELS,
  type CarrierOption,
  type ReconciliationPrefill,
} from "@sfa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useHeldAssignedRow } from "@/features/reconciliation/useHeldAssignedRow";
import { celebrate } from "@/lib/celebrate";
import { reconciliationKey } from "@/lib/carrier-reconciliation-api";
import {
  createSoldDeal,
  getSoldDealContext,
  getSoldStaff,
  soldStaffKey,
} from "@/lib/sold-deals-api";
import { newSubmissionToken } from "@/lib/submission-token";
import {
  emptyPolicy,
  toPolicyInput,
  type SoldPolicyFormValues,
  type WizardVariant,
} from "../components/sold-deal-schema";
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
  /** The Dash Reconciliation row this sale records, or `""` (PAC-173). */
  reconciliationRowId: string;
  enabled: boolean;
}

/**
 * `/sold/new?leadId={id}` — the Sold form (PAC-40).
 *
 * Lead-scoped like the Quote Recap form: the API resolves the household from the
 * lead, so a producer can never book a sale against a household they do not own.
 * `quoteRecapId` rides along when present — not every sale has a recorded quote,
 * so it is optional end to end.
 *
 * ## A Dash row's sale (PAC-173)
 *
 * `reconciliationRowId` names the caller's Dash Reconciliation row whose Sold or
 * Cancel rewrite outcome this sale records. The row is read through the same
 * query key as its drawer, and it changes four things:
 *
 * 1. **The no-quote block is waived** while the outcome is under way. A policy
 *    Dash says the agency sold was sold whether or not its quote was recorded,
 *    and the whole point of the row is to get it into the app.
 * 2. **The sold date and the first policy are prefilled** from the Dash line —
 *    at the outcome's `record_sale` step only. The replacement a Cancel rewrite
 *    writes next is a new policy Dash does not describe. The New Business
 *    Application is still required: it is a document, not something Dash has.
 * 3. **The id is sent with the sale.** The API moves the outcome on after the
 *    sale commits, best-effort, so a hiccup there never costs the booking; the
 *    drawer's Continue picks a stranded one up.
 * 4. **It returns to the row**, whose drawer then shows what the sale did.
 *
 * A row that is no longer the caller's (404 — reassigned or taken back) does
 * not refuse the sale. It books as an ordinary one, and the page says the row
 * will not be completed by it.
 */
export function useSaleMode({
  leadId,
  quoteRecapId,
  reconciliationRowId,
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

  const context = contextQuery.data;

  const rowId = OBJECT_ID.test(reconciliationRowId)
    ? reconciliationRowId
    : "";
  /*
   * Held for the session, so a row that changes under the wizard — decided by
   * the owner while the rep hunts for the PDF — cannot flip the waiver below
   * and unmount a half-entered sale. See `useHeldAssignedRow`.
   */
  const heldRow = useHeldAssignedRow(rowId, usable);
  const dashRow = heldRow.row;
  const rowGone = heldRow.gone;
  /*
   * Settled once the row is in or known to be gone. Until then the wizard
   * waits: mounted early it would miss the prefill (its values are read once),
   * and the no-quote block would show for a sale the row waives it on.
   */
  const rowSettled = !rowId || dashRow !== null || rowGone;
  const outcome =
    dashRow?.outcome?.status === "in_progress" ? dashRow.outcome : null;

  /*
   * A replacement runs this same mode — it is an ordinary sale as far as the
   * wizard is concerned, and the server applies the retirement, the linking and
   * the chargeback from the lead's intent. Only the wording changes, because
   * "Mark as sold" is not what a rep cancelling a policy thinks they are doing.
   */
  const replacementReason = context?.replacementReason ?? null;

  /** Entering the policy a Dash line shows — not writing a replacement for it. */
  const recordingDashSale =
    outcome?.step === "record_sale" && !replacementReason;
  const dashPrefill = recordingDashSale ? (dashRow?.prefill ?? null) : null;

  const mutation = useMutation({
    mutationFn: (values: Parameters<SoldFlow["onSubmit"]>[0]) =>
      createSoldDeal({
        leadId,
        soldDate: values.soldDate,
        quoteRecapId: OBJECT_ID.test(quoteRecapId) ? quoteRecapId : undefined,
        policies: values.policies.map(toPolicyInput),
        submissionToken: submissionToken.current,
        // Not for a row known to be someone else's now: there is nothing for
        // the sale to complete.
        reconciliationRowId: rowId && !rowGone ? rowId : undefined,
      }),
    onSuccess: (deal) => {
      /*
       * Everything a booking changes, not only the lead. The household's
       * policy list and count, the policy and its history (a replacement
       * retires one and links it), the performance and leaderboard widgets, the
       * pending audits, and the ticket queue (a transfer resolves the ticket's
       * question). `staleTime` is 30s app-wide, so a Back to the household page
       * inside that window would otherwise show the retired policy still
       * Active.
       */
      for (const key of [
        "leads",
        "deal-audits",
        "household",
        "households",
        "policy",
        "policy-history",
        "performance",
        "leaderboard",
        "service-tickets",
      ]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      // The row the sale recorded, its run's counts and the assignee's lists.
      if (rowId) {
        void queryClient.invalidateQueries({ queryKey: reconciliationKey });
      }

      const count = `${deal.policyCount} ${
        deal.policyCount === 1 ? "policy" : "policies"
      }`;

      if (replacementReason === "company_transfer") {
        // Not a sale: no "Sale booked", no confetti. The client moved within
        // their own book, and the deal is kept off the leaderboard for the same
        // reason.
        toast.success(
          `Transfer recorded — ${count}. The old policy is retired and linked.`,
        );
      } else if (replacementReason === "cancel_rewrite") {
        toast.success(
          `Policy rewritten — ${count}. The old policy is retired and any chargeback recorded.`,
        );
      } else if (recordingDashSale && outcome?.kind === "cancel_rewrite") {
        // The sale a rewrite later replaced: booked late, and only half the
        // job. No confetti, for the same reason a rewrite gets none.
        toast.success(
          `Sale booked — ${count}. Next, write its replacement from the Dash row.`,
        );
      } else {
        toast.success(`Sale booked — ${count}`);
        /*
         * PAC-65 #12. The scrum notes said "on lead review completion", but
         * there is no such thing in this product — the moment meant is this
         * one, which is also where the Aug-4 sold-notification precedent
         * points. A rewrite books new business too, but the rep is cancelling
         * a client's policy, and a confetti burst over that reads wrong.
         *
         * Fired before the navigate on purpose: `canvas-confetti` renders into
         * its own canvas on `document.body`, outside React's tree, so the burst
         * outlives the route change instead of being unmounted mid-animation.
         */
        celebrate();
      }

      /*
       * A Dash row's sale returns to the row (PAC-173): that is where the rep
       * started, and its drawer shows what the sale did to the outcome — done,
       * or a Cancel rewrite's next step.
       */
      if (rowId && !rowGone) {
        navigate(`/reconciliation/assigned?row=${rowId}`, { replace: true });
        return;
      }

      /*
       * A replacement returns to the household it was done for — that is where
       * the rep started (the policy card or the policy page) and where the
       * result is visible: the old policy retired, the new one beside it. The
       * lead was a means, not a destination. An ordinary sale lands on the
       * lead, whose page now shows the deal.
       */
      if (replacementReason && context?.householdId) {
        navigate(`/clients/${context.householdId}`, { replace: true });
        return;
      }
      navigate(`/leads/${leadId}`, { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  const fromDashRow = Boolean(rowId) && !rowGone;
  const backTo = fromDashRow
    ? `/reconciliation/assigned?row=${rowId}`
    : `/leads/${leadId}`;

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
      detail: fromDashRow
        ? "Its deal is on the lead page. If it is this Dash row's sale, go back to the row and press Continue — it picks the sale up."
        : "Its deal is on the lead page, where the sale can be edited.",
    };
  } else if (
    context?.householdId &&
    !context.hasQuoteRecap &&
    !context.replacementReason &&
    // Waived for a Dash row's outcome (PAC-173) — see the docblock. Not
    // judged until the row is in, or it would flash before the waiver lands.
    rowSettled &&
    !outcome
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

  const variant: WizardVariant = replacementReason ? "replacement" : "sale";

  const notice =
    [
      rowGone
        ? "This Dash row is no longer assigned to you, so booking here won't complete it."
        : dashRow && !outcome
          ? "This Dash row isn't waiting on a sale any more, so booking here won't complete it."
          : null,
      dashPrefill
        ? `Prefilled from Dash${dashRow?.dash ? ` line ${dashRow.dash.rowNumber}` : ""} — check each card against the application, which is still required.${
            outcome?.kind === "cancel_rewrite"
              ? " Once this is booked, its replacement is written from the Dash row."
              : ""
          }`
        : null,
      replacementReason
        ? "Nothing is cancelled until you submit. The old policy is retired, the replacement is written and any chargeback is recorded together."
        : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

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
    variant,
    title: replacementReason
      ? `${POLICY_REPLACEMENT_REASON_LABELS[replacementReason]} — step 2 of 2`
      : recordingDashSale
        ? "Record the Dash sale — step 2 of 2"
        : "Mark as sold",
    subtitle: replacementReason
      ? "The replacement policy"
      : recordingDashSale
        ? "The policy Dash shows"
        : "Record the closed sale",
    backTo,
    backLabel: fromDashRow ? "Back to the Dash row" : "Back to lead",
    redirect: OBJECT_ID.test(leadId) ? null : "/leads",
    loading:
      contextQuery.isPending ||
      carriersQuery.isPending ||
      heldRow.loading
        ? "Loading lead…"
        : null,
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
      ...(heldRow.error
        ? [
            {
              title: "Couldn't load the Dash row.",
              detail: heldRow.error.message,
              retry: heldRow.retry,
            },
          ]
        : []),
    ],
    blocked,
    ready:
      !blocked && rowSettled && context?.householdId && carriersQuery.data
        ? {
            context,
            carriers: carriersQuery.data,
            staff: staffQuery.data ?? [],
            uploadScope: { kind: "lead", leadId },
            notice,
            initialSoldDate: dashPrefill?.policy.soldDate ?? undefined,
            initialDraft: dashPrefill
              ? policyDraftFromDash(
                  dashPrefill.policy,
                  carriersQuery.data,
                  variant,
                )
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

/**
 * The first policy as the Dash line describes it, over the wizard's blank one
 * (PAC-173).
 *
 * The carrier is the run's, by its catalog name when the catalog lists it —
 * matched by slug, as the schema matches carriers — and otherwise "Other" with
 * the name typed in: the run knows the carrier, so it is never dropped. A
 * product Dash's map does not know leaves the blank policy's type for the
 * first card to ask.
 */
function policyDraftFromDash(
  policy: ReconciliationPrefill["policy"],
  carriers: readonly CarrierOption[],
  variant: WizardVariant,
): SoldPolicyFormValues {
  const blank = emptyPolicy(variant);
  const named = policy.carrier;
  const listed = named
    ? carriers.find(
        (carrier) => carrierSlug(carrier.name) === carrierSlug(named),
      )
    : undefined;
  return {
    ...blank,
    policyType: policy.policyType ?? blank.policyType,
    carrier: listed ? listed.name : named ? CARRIER_OTHER : "",
    carrierOther: !listed && named ? named : "",
    policyNumber: policy.policyNumber ?? "",
    premium: policy.premium != null ? String(policy.premium) : "",
    itemCount: String(policy.itemCount),
    effectiveDate: policy.effectiveDate ?? "",
  };
}
