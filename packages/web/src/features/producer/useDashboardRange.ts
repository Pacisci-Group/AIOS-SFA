import { useCallback, useMemo } from 'react';
import type { PerformanceRangeKey } from '@sfa/shared';
import { useUrlState } from '@/hooks/useUrlState';
import { parseUrlRange, toUrlRange } from '@/lib/date-range';
import { DEFAULT_RANGE_KEY, RANGE_KEYS } from './dashboard-range';

export interface DashboardRange {
  key: PerformanceRangeKey;
  /** `YYYY-MM-DD`, both inclusive. Only set when `key === 'custom'`. */
  from?: string;
  to?: string;
}

/** Frozen so `useUrlState`'s memo dependencies stay stable across renders. */
const DEFAULTS = {
  range: DEFAULT_RANGE_KEY as string,
  from: '',
  to: '',
} as const;

const ALLOWED = { range: RANGE_KEYS } as const;

/**
 * The dashboard's selected time range, held in the URL so it survives a refresh
 * and can be shared (PAC-9).
 *
 * All three params are written in **one** update. They cannot be three separate
 * writes: `setSearchParams` calls `navigate()`, which is asynchronous, so
 * sequential writes in the same tick each read a stale location and the last
 * one wins — setting `range` and then clearing `from`/`to` would silently throw
 * the range away. See `useUrlState`.
 *
 * The one invariant enforced here: **`custom` without a valid `from`/`to`
 * degrades to the default range** rather than issuing a request the API will
 * reject. That state is reachable by ordinary means — a shared link truncated
 * at `?range=custom`, or a reload mid-selection — so it has to resolve to
 * something sensible rather than a 400.
 */
export function useDashboardRange(): {
  range: DashboardRange;
  setRange: (next: DashboardRange) => void;
} {
  const [values, setValues] = useUrlState({
    defaults: DEFAULTS,
    allowed: ALLOWED,
  });

  const range = useMemo<DashboardRange>(
    () => parseUrlRange(values, DEFAULT_RANGE_KEY),
    [values],
  );

  const setRange = useCallback(
    (next: DashboardRange) => setValues(toUrlRange(next)),
    [setValues],
  );

  return { range, setRange };
}
