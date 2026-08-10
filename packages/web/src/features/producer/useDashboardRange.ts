import { useCallback, useMemo } from 'react';
import type { PerformanceRangeKey } from '@sfa/shared';
import { useUrlState } from '@/hooks/useUrlState';
import { DEFAULT_RANGE_KEY, RANGE_KEYS } from './dashboard-range';

export interface DashboardRange {
  key: PerformanceRangeKey;
  /** `YYYY-MM-DD`, both inclusive. Only set when `key === 'custom'`. */
  from?: string;
  to?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

  const range = useMemo<DashboardRange>(() => {
    const key = values.range as PerformanceRangeKey;
    if (key !== 'custom') return { key };

    const usable =
      ISO_DATE.test(values.from) &&
      ISO_DATE.test(values.to) &&
      values.from <= values.to;

    return usable
      ? { key: 'custom', from: values.from, to: values.to }
      : { key: DEFAULT_RANGE_KEY };
  }, [values.range, values.from, values.to]);

  const setRange = useCallback(
    (next: DashboardRange) => {
      setValues({
        range: next.key,
        // Cleared when leaving custom, so switching to a preset and reloading
        // cannot resurrect a window the user moved off.
        from: next.key === 'custom' ? (next.from ?? '') : '',
        to: next.key === 'custom' ? (next.to ?? '') : '',
      });
    },
    [setValues],
  );

  return { range, setRange };
}
