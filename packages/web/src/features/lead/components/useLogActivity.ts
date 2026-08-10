import type { LeadDetail, LeadDetailActivity } from "@sfa/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logActivity } from "@/lib/activities-api";
import type { LogActivityInput } from "@/lib/activities-api";
import { leadDetailKey } from "./useUpdateLead";

/**
 * Log a call / text / email / note against a lead (PAC-16).
 *
 * Shared by the dashboard's quick actions and the Lead Detail note composer —
 * they differ only in the `type` they send.
 *
 * Optimistic, following `useUpdateLead`: the row appears in the timeline
 * immediately and is replaced by the server's copy on success. A producer
 * logging three calls in a row should not watch three spinners.
 *
 * Failure is surfaced through a toast rather than inline, because the caller is
 * often the dashboard, where there is nowhere sensible to put an error message
 * next to a button in a scrolling list.
 */
export function useLogActivity(leadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Omit<LogActivityInput, "leadId">) =>
      logActivity({ ...input, leadId }),

    onMutate: async (input) => {
      const key = leadDetailKey(leadId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LeadDetail>(key);

      if (previous) {
        const optimistic: LeadDetailActivity = {
          // Distinguishable from a real ObjectId, and replaced on success.
          id: `optimistic-${input.type}`,
          type: input.type,
          summary: input.summary ?? null,
          occurredAt: new Date().toISOString(),
          producerName: null,
          // This hook only ever logs against the lead itself, and the server
          // agrees — `ActivitiesService` returns a constant `lead` origin.
          origin: "lead",
        };
        queryClient.setQueryData<LeadDetail>(key, {
          ...previous,
          activities: [optimistic, ...previous.activities],
        });
      }

      return { previous };
    },

    onError: (error: Error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(leadDetailKey(leadId), context.previous);
      }
      toast.error(error.message || "Couldn't log that activity");
    },

    onSuccess: (result) => {
      const key = leadDetailKey(leadId);
      const current = queryClient.getQueryData<LeadDetail>(key);
      if (!current) return;
      queryClient.setQueryData<LeadDetail>(key, {
        ...current,
        activities: [
          result.activity,
          ...current.activities.filter((a) => !a.id.startsWith("optimistic-")),
        ],
      });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: leadDetailKey(leadId) });
      // The Leads list sorts on `lastActivityAt`, which just moved.
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      /*
       * And the dashboard panel, which sorts on it too — in the opposite
       * direction. This is the invalidation that makes the dashboard feel
       * alive: log a call and the lead visibly drops down the priority list.
       */
      void queryClient.invalidateQueries({ queryKey: ["hot-leads"] });
    },
  });
}
