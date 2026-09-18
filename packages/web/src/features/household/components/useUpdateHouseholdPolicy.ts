import type { HouseholdView, PolicySummary, UpdatePolicyInput } from "@sfa/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updateHouseholdPolicy } from "@/lib/policies-api";

/** The cache entry `HouseholdDetailsPage` reads, so the two cannot disagree on it. */
export function householdDetailKey(householdId: string) {
  return ["household", householdId] as const;
}

/**
 * The household policy card's edit (PAC-126).
 *
 * The household page has **no separate policies query** — they arrive nested on
 * the household and are handed straight to `PolicyPortfolio` — so the saved row
 * is spliced into that one cache entry rather than into a list of its own.
 *
 * Deliberately **not** optimistic, matching `useUpdatePolicy` and
 * `useUpdateContact`: this is a modal with an explicit Save, so the operator is
 * already waiting on a result, and the server normalizes what it stores — the
 * policy type, the policy-number match key, the status vocabulary, and above all
 * **the renewal date**, which is re-derived from the effective date and the term.
 * That last one is the reason guessing client-side would be actively wrong: the
 * whole point of the edit is to surface a date the operator did not type, and an
 * optimistic render would have to invent it and then be contradicted.
 *
 * The response *is* the saved policy, so it is written straight into the cache
 * rather than triggering a refetch of the whole 360° household assembly.
 */
export function useUpdateHouseholdPolicy(
  householdId: string,
  policyId: string,
) {
  const queryClient = useQueryClient();
  const queryKey = householdDetailKey(householdId);

  return useMutation({
    mutationFn: (input: UpdatePolicyInput) =>
      updateHouseholdPolicy(householdId, policyId, input),

    onSuccess: (saved: PolicySummary) => {
      queryClient.setQueryData<HouseholdView>(queryKey, (current) =>
        current
          ? {
              ...current,
              policies: current.policies.map((policy) =>
                policy.id === saved.id ? saved : policy,
              ),
            }
          : current,
      );
      /*
       * `applyUpdate` recomputes the parent deal's roll-ups server-side, and the
       * response is one policy rather than the deal — the same gap
       * `useUpdatePolicy` invalidates for. A premium correction on a household
       * policy moves the sold scorecard and the leaderboard it ranks, so leaving
       * those cached would show two different numbers for one sale.
       */
      void queryClient.invalidateQueries({ queryKey: ["performance"] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      /*
       * Giving an undated policy an effective date derives its renewal anchor,
       * which is what moves it out of the Unlinked records "No renewal date"
       * chip. The count is its own query, so nothing else would refresh it.
       */
      void queryClient.invalidateQueries({ queryKey: ["unlinked-counts"] });
      void queryClient.invalidateQueries({ queryKey: ["unlinked"] });
      toast.success("Policy updated");
    },

    onError: (error: Error) => {
      toast.error(error.message || "Couldn't update the policy");
    },
  });
}
