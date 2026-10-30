import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  dealAuditReviewKey,
  setAuditItemVerdict,
  type AuditItemVerdict,
  type DealAuditReviewView,
} from "@/lib/deal-audits-api";
import { managementDashboardKey } from "@/lib/management-dashboard-api";

export interface ItemVerdictInput {
  itemId: string;
  verdict?: AuditItemVerdict | null;
  note?: string;
}

/**
 * Rule on one checklist item, and fold the answer into the page in place.
 *
 * One mutation per row, so each row knows whether *it* is saving. The response
 * carries the updated item plus the audit's tally and gates, so the summary
 * bar moves without refetching the whole page. `canApprove` / `canSendBack`
 * are taken as the server sends them: it clamps both by `canReview`, the same
 * rule as the page read.
 */
export function useItemVerdict(dealId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, ...payload }: ItemVerdictInput) =>
      setAuditItemVerdict(itemId, payload),
    onSuccess: (result) => {
      queryClient.setQueryData<DealAuditReviewView>(
        dealAuditReviewKey(dealId),
        (prev) =>
          prev && {
            ...prev,
            items: prev.items.map((item) =>
              item.id === result.item.id ? result.item : item,
            ),
            audit: {
              ...prev.audit,
              counts: result.counts,
              unmet: result.unmet,
              canApprove: result.canApprove,
              canSendBack: result.canSendBack,
            },
          },
      );
      // The queue's tally and the Manager view's open-item counts move with a
      // pass (it resolves the item). Not `['deal-audits']` wholesale: that
      // would refetch this page over the answer just written into it.
      void queryClient.invalidateQueries({ queryKey: ["deal-audits", "queue"] });
      void queryClient.invalidateQueries({ queryKey: managementDashboardKey });
    },
    onError: (error) => {
      toast.error(error.message || "Couldn't save that ruling. Try again.");
    },
  });
}
