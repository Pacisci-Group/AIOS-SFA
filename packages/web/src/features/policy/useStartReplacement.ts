import type { PolicyReplacementReason } from "@sfa/shared";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getReplacementLead } from "@/lib/lead-intake-api";

/**
 * Start — or resume — a Cancel Rewrite or Company Transfer (PAC-126).
 *
 * Both replacements run through the ordinary Sold pipeline, which is anchored on
 * a lead, so the chain is two forms long: **New Lead → Sold form**. This hook is
 * the front door to it, and every entry point uses it so the routing rule exists
 * once.
 *
 * ## Why it asks the server before navigating
 *
 * Because the rep can leave. A lead created and then abandoned before the Sold
 * form is a real record with no sale on it, and asking again for the same action
 * on the same policy must land on *that* lead rather than opening a second one
 * beside it. Only the server can answer that, so the click is a request:
 *
 *   - **blocked** — say why and go nowhere. Same guards the lead creation and the
 *     Sold submit both enforce, so this is a courtesy, not the enforcement.
 *   - **a lead already exists** — skip straight to `/sold/new?leadId=`, the
 *     second form. This is the abandoned-tab case.
 *   - **nothing yet** — `/leads/new`, carrying the policy and the reason so the
 *     created lead is stamped with what it is for and redirects onward itself.
 *
 * A `<Link>` cannot express that, which is why these are buttons.
 */
export function useStartReplacement(
  policyId: string,
  reason: PolicyReplacementReason,
) {
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: () => getReplacementLead(policyId, reason),
    onSuccess: (lookup) => {
      if (lookup.blockedReason) {
        /*
         * Reported rather than thrown by the endpoint, and surfaced as a toast
         * rather than a blocking card: the entry points already hide themselves
         * for an inactive policy, so reaching here means the record changed
         * under the rep — someone else replaced it, or it was cancelled while
         * the page sat open.
         */
        toast.error(lookup.blockedReason);
        return;
      }

      if (lookup.leadId) {
        toast.info("Picking up where you left off — the lead is already open.");
        navigate(`/sold/new?leadId=${lookup.leadId}`);
        return;
      }

      const params = new URLSearchParams({
        replacePolicyId: policyId,
        reason,
      });
      navigate(`/leads/new?${params.toString()}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return {
    start: () => mutation.mutate(),
    isStarting: mutation.isPending,
  };
}
