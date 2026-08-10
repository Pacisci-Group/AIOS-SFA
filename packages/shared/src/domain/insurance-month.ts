/**
 * Insurance renewal month on the Quote Recap (PAC-56 #16).
 *
 * A legacy re-port, not a new field. SmartSuite's Quote Recaps table carries
 * `Insurance X Month` (`s69d7c3f64`) as a **single-select of the twelve month
 * names, one per recap** — see `docs/smartsuite-tables/The Quote Recaps Table.md`.
 * Per-recap rather than per-policy is legacy's shape and the placement David
 * asked for; it records when the client's current cover renews, so the agency
 * can re-engage ahead of it.
 *
 * ⚠ Two legacy behaviours deliberately **not** ported:
 *
 * 1. Legacy's own submit API typed this as a JavaScript **number** and rejected
 *    anything else, while the Fillout path wrote the raw choice UUID straight
 *    through. The two never agreed, and the detail page `parseFloat`-ed it and
 *    rendered `—`. We store the month label.
 * 2. It was **optional** in SmartSuite. It is required on our create path,
 *    because David asked for it to be — but only there; see the note on
 *    normalization below.
 */

export const INSURANCE_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export type InsuranceMonth = (typeof INSURANCE_MONTHS)[number];

/** What the form offers — every month, in calendar order. */
export const INSURANCE_MONTH_OPTIONS: readonly InsuranceMonth[] =
  INSURANCE_MONTHS;

/**
 * SmartSuite choice id → month label, from `s69d7c3f64`.
 *
 * Unlike every other select in that workspace, this one uses UUIDs rather than
 * 5-character codes, so a migrated recap holds something like
 * `0897f82f-…` where a human expects "January".
 */
export const INSURANCE_MONTH_CHOICE_ALIASES: Record<string, InsuranceMonth> = {
  '0897f82f-de3a-4bbb-b973-c56bb1f4fecb': 'January',
  'db14e7a4-6268-49ca-8b3f-aed9d15e77ae': 'February',
  'cbaf9fb5-815c-4e2f-932e-a2f87d903606': 'March',
  '8cec2f37-8e1e-479b-8434-671a789a2d49': 'April',
  '0448d31d-5232-4cb5-9381-22f5e99f1970': 'May',
  'a78db315-2e35-4f2b-868e-a98bcd61d180': 'June',
  '9d6f93f2-0ca1-4d83-9955-0c6dc4bcac55': 'July',
  'c1789842-dfed-4ccb-bb14-7b103bf9cade': 'August',
  'a0cac70f-bc52-4f9e-8e2d-81cd2156061c': 'September',
  '196233f9-c8f0-4861-94eb-8c36be0c713f': 'October',
  '2a0ea166-84e7-4c2d-84f4-478c5e203495': 'November',
  'a5868d88-f0cf-4ad4-9fc8-c68a15b925c3': 'December',
};

const CANONICAL_BY_LOWER = new Map<string, InsuranceMonth>(
  INSURANCE_MONTHS.map((month) => [month.toLowerCase(), month]),
);

/**
 * Stored value → month label. Accepts a SmartSuite choice UUID or any casing of
 * the label.
 *
 * Applied on **read** as well as at migration time, deliberately — the same
 * belt-and-braces `normalizePolicyType` uses. A database migrated before this
 * field was mapped still renders month names rather than UUIDs, with no
 * backfill.
 *
 * Unrecognized non-empty values pass through trimmed rather than disappearing.
 */
export function normalizeInsuranceMonth(raw?: string | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';

  return (
    INSURANCE_MONTH_CHOICE_ALIASES[value] ??
    CANONICAL_BY_LOWER.get(value.toLowerCase()) ??
    value
  );
}
