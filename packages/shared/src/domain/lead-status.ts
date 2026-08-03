/**
 * Canonical lead-status vocabulary (PAC-36).
 *
 * The SmartSuite "Leads Table" `status` field has 10 choices. Six are
 * self-coded (the choice code *is* the label); four carry opaque 5-char codes.
 * The migration writes `selectCode(...)` verbatim into `leads.status`, so Mongo
 * holds a mix of labels and raw codes — e.g. a "Requote" lead is stored as
 * `arW7O`.
 *
 * Rather than backfill the collection, we normalize on read
 * ({@link normalizeLeadStatus}) and expand filters on write
 * ({@link leadStatusQueryValues}) so both stored forms match.
 */

/** Canonical labels, in pipeline order. Drives the filter dropdowns. */
export const LEAD_STATUSES = [
  'New',
  'Contacted',
  'Qualified',
  'Quoted',
  'Requote',
  'Sold',
  'Converted',
  'Not Qualified',
  'Lost',
  'Closed',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Shown when a lead has no status at all. Never a filter option. */
export const LEAD_STATUS_UNKNOWN = 'Unknown';

/**
 * Opaque SmartSuite choice codes → canonical label. The other six choices are
 * self-coded, so they need no entry here.
 */
export const LEAD_STATUS_CODE_ALIASES: Record<string, LeadStatus> = {
  arW7O: 'Requote',
  phjnb: 'Converted',
  jp76g: 'Lost',
  hfwda: 'Qualified',
};

const CANONICAL_BY_LOWER = new Map<string, LeadStatus>(
  LEAD_STATUSES.map((s) => [s.toLowerCase(), s]),
);

/**
 * Stored value → canonical label. Accepts either form (raw code or label) and is
 * case-insensitive. Unrecognized non-empty values pass through trimmed, so a
 * status we haven't catalogued still renders as itself rather than disappearing.
 */
export function normalizeLeadStatus(raw?: string | null): string {
  const value = (raw ?? '').trim();
  if (!value) return LEAD_STATUS_UNKNOWN;

  const byCode = LEAD_STATUS_CODE_ALIASES[value];
  if (byCode) return byCode;

  return CANONICAL_BY_LOWER.get(value.toLowerCase()) ?? value;
}

/**
 * Canonical label → every stored form that must match it. Feeds a Mongo
 * `{ status: { $in: [...] } }` filter, so that filtering by "Requote" also
 * matches the migrated documents storing the raw `arW7O`.
 */
export function leadStatusQueryValues(label: string): string[] {
  const canonical = normalizeLeadStatus(label);
  const codes = Object.entries(LEAD_STATUS_CODE_ALIASES)
    .filter(([, mapped]) => mapped === canonical)
    .map(([code]) => code);
  return [canonical, ...codes];
}
