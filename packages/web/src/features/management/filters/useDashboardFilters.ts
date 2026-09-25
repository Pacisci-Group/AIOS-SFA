import { LEAD_SOURCE_NONE, POLICY_TYPES } from "@sfa/shared";
import type { OwnerDashboardRangeKey } from "@sfa/shared";
import { useCallback, useMemo } from "react";
import { useUrlState } from "@/hooks/useUrlState";
import { parseUrlRange, toUrlRange } from "@/lib/date-range";
import type { UrlRange } from "@/lib/date-range";
import type { DashboardFilterParams } from "@/lib/dashboard-filter-params";
import {
  DASHBOARD_DEFAULT_RANGE_KEY,
  DASHBOARD_RANGE_KEYS,
} from "./dashboard-range";

export type DashboardRange = UrlRange<OwnerDashboardRangeKey>;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Frozen so `useUrlState`'s memo dependencies stay stable across renders. */
const DEFAULTS = {
  range: DASHBOARD_DEFAULT_RANGE_KEY as string,
  from: "",
  to: "",
  producerIds: [] as string[],
  leadSourceIds: [] as string[],
  policyTypes: [] as string[],
};

const ALLOWED = {
  range: DASHBOARD_RANGE_KEYS,
  producerIds: (value: string) => OBJECT_ID.test(value),
  // Sources are data, so the URL can only be checked for shape. "No source" is
  // a real choice, not an absent value.
  leadSourceIds: (value: string) =>
    value === LEAD_SOURCE_NONE || OBJECT_ID.test(value),
  policyTypes: POLICY_TYPES,
} as const;

/**
 * The management dashboards' whole filter — period plus the three
 * multi-selects — held in the URL so a view survives a refresh and can be
 * shared (PAC-135). One hook for the Owner view and the Manager view
 * (PAC-139): switching tabs keeps the filter, because it is the same filter.
 *
 * One hook owning all six params rather than a range hook beside a filter hook:
 * `useUrlState` explains why a group of keys has to be written in one
 * `navigate()`, and "Clear filters" is exactly such a write.
 *
 * Filtering is instant — there is no Apply button — so `params` is what the
 * three queries key on directly.
 */
export function useDashboardFilters() {
  const [values, setValues] = useUrlState({
    defaults: DEFAULTS,
    allowed: ALLOWED,
  });

  const range = useMemo<DashboardRange>(
    () => parseUrlRange(values, DASHBOARD_DEFAULT_RANGE_KEY),
    [values],
  );

  const params = useMemo<DashboardFilterParams>(
    () => ({
      range: range.key,
      from: range.from,
      to: range.to,
      producerIds: values.producerIds,
      leadSourceIds: values.leadSourceIds,
      policyTypes: values.policyTypes,
    }),
    [range, values.producerIds, values.leadSourceIds, values.policyTypes],
  );

  const setRange = useCallback(
    (next: DashboardRange) => setValues(toUrlRange(next)),
    [setValues],
  );

  const setFilter = useCallback(
    (
      key: "producerIds" | "leadSourceIds" | "policyTypes",
      next: string[],
    ) => setValues({ [key]: next }),
    [setValues],
  );

  /** The three selects only — the period is not a "filter" to clear. */
  const clearFilters = useCallback(
    () => setValues({ producerIds: [], leadSourceIds: [], policyTypes: [] }),
    [setValues],
  );

  const activeCount =
    values.producerIds.length +
    values.leadSourceIds.length +
    values.policyTypes.length;

  return { range, params, setRange, setFilter, clearFilters, activeCount };
}
