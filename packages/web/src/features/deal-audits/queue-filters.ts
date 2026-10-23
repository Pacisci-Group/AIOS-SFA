import {
  DEAL_AUDIT_QUEUE_SORTS,
  DEAL_AUDIT_QUEUE_SORT_LABELS,
  POLICY_TYPES,
} from "@sfa/shared";
import type { DealAuditQueueRangeKey, DealAuditQueueSort } from "@sfa/shared";
import type { MultiSelectOption } from "@/components/common/MultiSelect";
import type { RangeChip } from "@/components/common/RangeChips";
import { DASHBOARD_RANGE_CHIPS } from "@/features/management/filters/dashboard-range";

/**
 * The Deal Audits queue's filter vocabulary (20 Oct 2026).
 *
 * The periods are the management dashboards' chips with **All time** in
 * front, and it is the default: the dashboards open on this month, but an
 * audit sold last month and still open is exactly what the queue is for.
 */
export const QUEUE_DEFAULT_RANGE: DealAuditQueueRangeKey = "all";

export const QUEUE_RANGE_CHIPS: readonly RangeChip<DealAuditQueueRangeKey>[] =
  [{ key: "all", label: "All time" }, ...DASHBOARD_RANGE_CHIPS];

/** What the URL may hold — a period with a chip, never one without. */
export const QUEUE_RANGE_KEYS = QUEUE_RANGE_CHIPS.map((chip) => chip.key);

export const QUEUE_DEFAULT_SORT: DealAuditQueueSort = "waiting";

export const QUEUE_SORT_OPTIONS: readonly {
  value: DealAuditQueueSort;
  label: string;
}[] = DEAL_AUDIT_QUEUE_SORTS.map((value) => ({
  value,
  label: DEAL_AUDIT_QUEUE_SORT_LABELS[value],
}));

/** Line of business = policy type — the dashboards' and the Sold form's list. */
export const POLICY_TYPE_OPTIONS: readonly MultiSelectOption[] =
  POLICY_TYPES.map((type) => ({ value: type, label: type }));
