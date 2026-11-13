import { useQuery } from "@tanstack/react-query";
import type { ReconciliationOptionsResponse } from "@sfa/shared";
import {
  getReconciliationOptions,
  reconciliationOptionsKey,
  type ReconciliationAssignee,
} from "@/lib/carrier-reconciliation-api";

/**
 * Their role names, e.g. `Producer` or `Producer · CSR`. Display only: who
 * can be assigned is decided by permission, so a custom role shows as named.
 */
export function assigneeRoleLabel(assignee: ReconciliationAssignee): string {
  return assignee.roles.join(" · ");
}

const byName = (data: ReconciliationOptionsResponse) =>
  [...data.assignees].sort((a, b) => a.name.localeCompare(b.name));

/**
 * Who a row can be assigned to — the agency's active users who can work
 * leads — in name order. The endpoint needs `carrier_reconciliation:read`, so the owner's
 * page and a writer's drawer ask; an assignee's read-only drawer never does.
 */
export function useReconciliationAssignees(enabled = true) {
  return useQuery({
    queryKey: reconciliationOptionsKey,
    queryFn: getReconciliationOptions,
    enabled,
    staleTime: 5 * 60_000,
    select: byName,
  });
}
