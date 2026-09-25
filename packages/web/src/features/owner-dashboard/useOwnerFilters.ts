import { LEAD_SOURCE_NONE, POLICY_TYPES } from "@sfa/shared";
import type { OwnerDashboardRangeKey } from "@sfa/shared";
import { useCallback, useMemo } from "react";
import { useUrlState } from "@/hooks/useUrlState";
import { parseUrlRange, toUrlRange } from "@/lib/date-range";
import type { UrlRange } from "@/lib/date-range";
import type { OwnerDashboardParams } from "@/lib/owner-dashboard-api";
import { OWNER_DEFAULT_RANGE_KEY, OWNER_RANGE_KEYS } from "./owner-range";

export type OwnerRange = UrlRange<OwnerDashboardRangeKey>;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Frozen so `useUrlState`'s memo dependencies stay stable across renders. */
const DEFAULTS = {
  range: OWNER_DEFAULT_RANGE_KEY as string,
  from: "",
  to: "",
  producerIds: [] as string[],
  leadSourceIds: [] as string[],
  policyTypes: [] as string[],
};

const ALLOWED = {
  range: OWNER_RANGE_KEYS,
  producerIds: (value: string) => OBJECT_ID.test(value),
  // Sources are data, so the URL can only be checked for shape. "No source" is
  // a real choice, not an absent value.
  leadSourceIds: (value: string) =>
    value === LEAD_SOURCE_NONE || OBJECT_ID.test(value),
  policyTypes: POLICY_TYPES,
} as const;

/**
 * The Owner dashboard's whole filter — period plus the three multi-selects —
 * held in the URL so a view survives a refresh and can be shared (PAC-135).
 *
 * One hook owning all six params rather than a range hook beside a filter hook:
 * `useUrlState` explains why a group of keys has to be written in one
 * `navigate()`, and "Clear filters" is exactly such a write.
 *
 * Filtering is instant — there is no Apply button — so `params` is what the
 * three queries key on directly.
 */
export function useOwnerFilters() {
  const [values, setValues] = useUrlState({
    defaults: DEFAULTS,
    allowed: ALLOWED,
  });

  const range = useMemo<OwnerRange>(
    () => parseUrlRange(values, OWNER_DEFAULT_RANGE_KEY),
    [values],
  );

  const params = useMemo<OwnerDashboardParams>(
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
    (next: OwnerRange) => setValues(toUrlRange(next)),
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
