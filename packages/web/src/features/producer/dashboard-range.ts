import { PERFORMANCE_RANGE_KEYS } from '@sfa/shared';
import type { PerformanceRangeKey } from '@sfa/shared';
import type { RangeChip } from '@/components/common/RangeChips';

/**
 * The time-range chips (PAC-9).
 *
 * Key and label are separate fields, which is the whole point. The previous
 * version of this dashboard used the display string as its state value
 * (`"This Month"`), which is why `ScoreCards` ended up with a fixture map keyed
 * on English copy — rename the chip and the data silently disappears. The key
 * is the API contract; the label is text.
 */
export const RANGE_CHIPS: readonly RangeChip<PerformanceRangeKey>[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'mtd', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'custom', label: 'Custom Date' },
];

export const DEFAULT_RANGE_KEY: PerformanceRangeKey = 'mtd';

/** Vocabulary guard for `useUrlState` — a stale `?range=` falls back to mtd. */
export const RANGE_KEYS = PERFORMANCE_RANGE_KEYS;
