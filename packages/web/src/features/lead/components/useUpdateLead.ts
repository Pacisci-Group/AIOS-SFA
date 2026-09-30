import type {
  LeadDetail,
  LeadSourceOption,
  UpdateLeadInput,
  UpdateLeadResult,
} from "@sfa/shared";
import { LEAD_SOURCE_NONE } from "@sfa/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { leadSourcesKey } from "@/lib/lead-sources-api";
import { updateLead } from "@/lib/leads-api";

/** The detail query key. Exported so the page and the hook cannot disagree. */
export function leadDetailKey(leadId: string) {
  return ["lead", leadId] as const;
}

/**
 * Apply a patch to a cached `LeadDetail` the same way the server will.
 *
 * Resolving the source's name here rather than echoing the raw id is what makes
 * the optimistic value *equal* the value `onSuccess` writes — otherwise the pill
 * would show an id for one frame and then snap to the label. The name comes from
 * the cached `GET /lead-sources` list: the select that fired this edit rendered
 * from it, so the picked id is in there.
 */
function applyLeadPatch(
  current: LeadDetail,
  input: UpdateLeadInput,
  leadSources: readonly LeadSourceOption[],
): LeadDetail {
  const next: LeadDetail = { ...current };

  if (input.status !== undefined) next.status = input.status;
  if (input.temperature !== undefined) next.temperature = input.temperature;

  if (input.leadSourceId !== undefined) {
    if (input.leadSourceId === LEAD_SOURCE_NONE) {
      // The shape the server returns when a source is cleared.
      next.leadSource = { id: null, label: "" };
    } else {
      const picked = leadSources.find((o) => o.id === input.leadSourceId);
      next.leadSource = { id: input.leadSourceId, label: picked?.name ?? "" };
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

      const leadSources =
        queryClient.getQueryData<LeadSourceOption[]>(leadSourcesKey) ?? [];

      queryClient.setQueryData<LeadDetail>(queryKey, (current) =>
        current ? applyLeadPatch(current, input, leadSources) : current,
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
