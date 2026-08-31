import { choiceVocabulary } from './choice-vocabulary';

/**
 * Whether a household is still a customer (PAC-80).
 *
 * 2,095 of 2,519 migrated households stored the raw code `b5qvJ`. It reached the
 * UI unmapped: `HouseholdProfile.tsx` renders `household.status ?? "Unknown"` in
 * a badge and decides the "active" pulse dot with `/active/i.test(status)`,
 * which `b5qvJ` never matched — so every migrated household displayed a code and
 * looked inactive.
 *
 * Labels from `docs/smartsuite-tables/The Households Table.md:18`.
 */
export const HOUSEHOLD_STATUSES = ['Active', 'Inactive'] as const;

export type HouseholdStatus = (typeof HOUSEHOLD_STATUSES)[number];

/** Field `s5f13c562d`. */
export const HOUSEHOLD_STATUS_CODE_ALIASES: Record<string, HouseholdStatus> = {
  b5qvJ: 'Active',
  QmEth: 'Inactive',
};

const vocabulary = choiceVocabulary(
  HOUSEHOLD_STATUSES,
  HOUSEHOLD_STATUS_CODE_ALIASES,
);

export const normalizeHouseholdStatus = vocabulary.normalize;
export const householdStatusQueryValues = vocabulary.queryValues;

/**
 * Is this household still active?
 *
 * Replaces the `/active/i` regex the household screens used. Unknown or absent
 * answers `false` — a household we cannot classify is not evidence of an active
 * one.
 */
export function isActiveHouseholdStatus(raw?: string | null): boolean {
  return normalizeHouseholdStatus(raw) === 'Active';
}
