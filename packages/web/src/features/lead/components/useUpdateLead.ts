import type {
  LeadDetail,
  UpdateLeadInput,
  UpdateLeadResult,
} from "@sfa/shared";
import { LEAD_SOURCE_NONE, normalizeLeadSource } from "@sfa/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updateLead } from "@/lib/leads-api";

/** The detail query key. Exported so the page and the hook cannot disagree. */
export function leadDetailKey(leadId: string) {
  return ["lead", leadId] as const;
}

/**
 * Apply a patch to a cached `LeadDetail` the same way the server will.
 *
 * Computing the canonical label here rather than echoing the raw input is what
 * makes the optimistic value *equal* the value `onSuccess` writes — otherwise
 * the pill would show the code for one frame and then snap to the label.
 */
function applyLeadPatch(
  current: LeadDetail,
  input: UpdateLeadInput,
): LeadDetail {
  const next: LeadDetail = { ...current };

  if (input.status !== undefined) next.status = input.status;
  if (input.temperature !== undefined) next.temperature = input.temperature;

  if (input.leadSourceCode !== undefined) {
    if (input.leadSourceCode === LEAD_SOURCE_NONE) {
      // The shape the server stores when a source is cleared.
      next.leadSource = { code: null, label: "" };
    } else {
      const source = normalizeLeadSource(input.leadSourceCode);
      next.leadSource = { code: source.code, label: source.label };
    }
  }

  return next;
}

/**
 * The inline status / temperature / source edits on the Lead Detail page
 * (PAC-38), applied optimistically.
 *
 * These are one-click dropdown changes on a page the producer is reading, so a
 * spinner on the pill would be more disruptive than the write itself. This is
 * the first `onMutate`/rollback in `packages/web`; the shape is the standard
 * TanStack Query one, and the comments record the two decisions that are not.
 *
 * Known, accepted limitation: two edits fired in quick succession each take
 * their own snapshot, so the second's `previous` already contains the first's
 * optimistic value. If the first then fails mid-flight, the rollback lands on a
 * mixed state. The `onError` invalidation converges it within one round trip.
 * Serializing properly needs a mutation scope, which is not worth it for two
 * dropdowns a producer clicks seconds apart.
 */
export function useUpdateLead(leadId: string) {
  const queryClient = useQueryClient();
  const queryKey = leadDetailKey(leadId);

  return useMutation({
    mutationFn: (input: UpdateLeadInput) => updateLead(leadId, input),

    onMutate: async (input) => {
      // An in-flight GET must not land after us and overwrite the optimistic
      // value with pre-edit data.
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<LeadDetail>(queryKey);

      queryClient.setQueryData<LeadDetail>(queryKey, (current) =>
        current ? applyLeadPatch(current, input) : current,
      );

      return { previous };
    },

    onError: (error: Error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      // Resync rather than trusting the snapshot: the write may have landed
      // before the response failed, in which case the rollback is now wrong.
      void queryClient.invalidateQueries({ queryKey });
      toast.error(error.message || "Couldn't update the lead");
    },

    onSuccess: (result: UpdateLeadResult) => {
      // The server is authoritative for exactly these four fields; this
      // replaces the optimistic guess with what was actually stored.
      queryClient.setQueryData<LeadDetail>(queryKey, (current) =>
        current
          ? {
              ...current,
              status: result.status,
              temperature: result.temperature,
              leadSource: result.leadSource,
              lastActivityAt: result.lastActivityAt,
            }
          : current,
      );
      toast.success("Lead updated");
    },

    onSettled: () => {
      // The list's status/temperature/source columns and its `lastActivityAt`
      // sort are both stale now — the row will have moved to the top.
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      // A terminal status resolves the lead's quote service ticket server-side,
      // so the CSR queue behind this page is stale too. Invalidated
      // unconditionally rather than only on a terminal status: this hook cannot
      // see which statuses the server treats as terminal without duplicating
      // that rule, and the queue is a cheap refetch.
      void queryClient.invalidateQueries({ queryKey: ["service-tickets"] });
      // Deliberately NOT invalidating the detail query: `onSuccess` already
      // wrote the server's own values, and a refetch would restart the
      // ten-collection assembly on every dropdown change.
    },
  });
}
