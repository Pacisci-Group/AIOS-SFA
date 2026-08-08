import { PERFORMANCE_RANGE_KEYS } from '@sfa/shared';
import type { PerformanceRangeKey } from '@sfa/shared';

/**
 * The time-range chips (PAC-9).
 *
 * Key and label are separate fields, which is the whole point. The previous
 * version of this dashboard used the display string as its state value
 * (`"This Month"`), which is why `ScoreCards` ended up with a fixture map keyed
 * on English copy — rename the chip and the data silently disappears. The key
 * is the API contract; the label is text.
 */
export interface RangeChip {
  key: PerformanceRangeKey;
  label: string;
}

export const RANGE_CHIPS: readonly RangeChip[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'mtd', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'custom', label: 'Custom Date' },
];

export const DEFAULT_RANGE_KEY: PerformanceRangeKey = 'mtd';

/** Vocabulary guard for `useUrlState` — a stale `?range=` falls back to mtd. */
export const RANGE_KEYS = PERFORMANCE_RANGE_KEYS;

/** `2026-01-01` → `Jan 1`, dropping the year when it is the current one. */
export function formatRangeDate(iso: string): string {
  // Parsed as UTC noon: these are calendar dates with no time, and
  // `new Date('2026-01-01')` is UTC midnight, which renders as Dec 31 for any
  // viewer west of Greenwich.
  const date = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getUTCFullYear() === new Date().getFullYear()
      ? {}
      : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/** `Jan 1 – Jan 31`, or a single date when the window is one day. */
export function formatRangeLabel(from: string, to: string): string {
  return from === to
    ? formatRangeDate(from)
    : `${formatRangeDate(from)} – ${formatRangeDate(to)}`;
}
