import type {
  LeadDetail,
  LeadDetailPolicy,
  UpdatePolicyInput,
  UpdatePolicyResult,
} from "@sfa/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updatePolicy } from "@/lib/policies-api";
import { leadDetailKey } from "./useUpdateLead";

/**
 * Replace one policy wherever it appears in a cached `LeadDetail`.
 *
 * It appears **twice** — once under `household.policies` and once under
 * `deal.policies`, which is the same record projected into two places (the
 * Sold card shows only the policies this sale bound; the Household card shows
 * everything on the household). Patching one and not the other would leave the
 * Household card showing the pre-edit carrier immediately below the Sold card
 * showing the corrected one.
 */
function applyPolicyPatch(
  current: LeadDetail,
  saved: UpdatePolicyResult,
): LeadDetail {
  const swap = (policy: LeadDetailPolicy): LeadDetailPolicy =>
    policy.id === saved.id ? saved : policy;

  return {
    ...current,
    household: current.household
      ? { ...current.household, policies: current.household.policies.map(swap) }
      : current.household,
    deal: current.deal
      ? { ...current.deal, policies: current.deal.policies.map(swap) }
      : current.deal,
  };
}

/**
 * The Sold card's per-policy quick edit (PAC-56 #27).
 *
 * Deliberately **not** optimistic, matching {@link useUpdateContact} and unlike
 * {@link useUpdateLead}: this is a modal with an explicit Save, so the producer
 * is already waiting on a result, and the server normalizes what it stores
 * (policy type, the policy-number match key, calendar-date truncation). Guessing
 * at that client-side would show a value the server then contradicts.
 *
 * The response *is* the saved policy, so it is written straight into the cache
 * rather than triggering a refetch — re-running the ten-collection Lead Detail
 * assembly to learn one corrected premium is the wrong trade.
 *
 * ## Why the cache patch is not enough on its own (PAC-56 #25)
 *
 * The endpoint now **does** recompute the parent deal's roll-ups, but the
 * response is a `LeadDetailPolicy` — one row, not the deal. So splicing it in
 * would leave the Sold card's footer total showing the pre-edit sum directly
 * beneath the corrected row. Hence the invalidations below.
 *
 * They deliberately invalidate rather than widening `UpdatePolicyResult` to
 * carry the new deal totals: that would couple a policy patch to deal
 * reporting, and the same argument applies twice over to `performance` and
 * `leaderboard`, which are different pages entirely.
 */
export function useUpdatePolicy(leadId: string, policyId: string) {
  const queryClient = useQueryClient();
  const queryKey = leadDetailKey(leadId);

  return useMutation({
    mutationFn: (input: UpdatePolicyInput) => updatePolicy(policyId, input),

    onSuccess: (saved: UpdatePolicyResult) => {
      // Applied first so the corrected row is on screen immediately; the
      // refetch below then reconciles the totals around it.
      queryClient.setQueryData<LeadDetail>(queryKey, (current) =>
        current ? applyPolicyPatch(current, saved) : current,
      );
      void queryClient.invalidateQueries({ queryKey });
      /*
       * A premium correction moves the deal's roll-up, which is what the Sold
       * scorecard sums and what the leaderboard ranks on. Leaving those cached
       * would show a producer two different numbers for the same sale on two
       * pages.
       */
      void queryClient.invalidateQueries({ queryKey: ["performance"] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      toast.success("Policy updated");
    },

    onError: (error: Error) => {
      toast.error(error.message || "Couldn't update the policy");
    },
  });
}
