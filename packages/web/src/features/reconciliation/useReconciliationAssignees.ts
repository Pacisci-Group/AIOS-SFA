import { useQuery } from "@tanstack/react-query";
import {
  RECONCILIATION_ASSIGNEE_ROLE_SLUGS,
  type ReconciliationOptionsResponse,
} from "@sfa/shared";
import {
  getReconciliationOptions,
  reconciliationOptionsKey,
  type ReconciliationAssignee,
} from "@/lib/carrier-reconciliation-api";

type AssigneeRoleSlug = (typeof RECONCILIATION_ASSIGNEE_ROLE_SLUGS)[number];

const ROLE_LABELS: Record<AssigneeRoleSlug, string> = {
  producer: "Producer",
  csr: "CSR",
};

const isAssigneeRole = (slug: string): slug is AssigneeRoleSlug =>
  (RECONCILIATION_ASSIGNEE_ROLE_SLUGS as readonly string[]).includes(slug);

/** `Producer`, `CSR` or `Producer · CSR` — what qualifies someone to be assigned. */
export function assigneeRoleLabel(assignee: ReconciliationAssignee): string {
  return assignee.roles
    .filter(isAssigneeRole)
    .map((slug) => ROLE_LABELS[slug])
    .join(" · ");
}

const byName = (data: ReconciliationOptionsResponse) =>
  [...data.assignees].sort((a, b) => a.name.localeCompare(b.name));

/**
 * Who a row can be assigned to — the agency's active Producers and CSRs — in
 * name order. The endpoint needs `carrier_reconciliation:read`, so the owner's
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
