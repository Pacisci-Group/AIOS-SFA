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

/** Where a submitted quote recap moves the lead (PAC-39). */
export const QUOTE_ADVANCE_TARGET: LeadStatus = 'Quoted';

/**
 * Statuses that a new quote recap advances to "Quoted". Forward only — a recap
 * recorded against a Sold or Lost lead must never drag it backwards.
 *
 * `Requote` is included deliberately. It sits *after* `Quoted` in
 * {@link LEAD_STATUSES}, but that array is pipeline **display** order, not a
 * rank: Requote is a re-entry state meaning "needs quoting again", so
 * delivering that requote is an advance, not a regression.
 */
export const QUOTE_ADVANCEABLE_LEAD_STATUSES: readonly LeadStatus[] = [
  'New',
  'Contacted',
  'Qualified',
  'Requote',
];

/**
 * Derived rather than listed, so a status added to {@link LEAD_STATUSES} later
 * defaults to *not* advancing — the safe direction.
 *
 * Currently: Quoted, Sold, Converted, Not Qualified, Lost, Closed.
 */
export const QUOTE_NON_ADVANCING_LEAD_STATUSES: readonly LeadStatus[] =
  LEAD_STATUSES.filter((s) => !QUOTE_ADVANCEABLE_LEAD_STATUSES.includes(s));

/**
 * Every **stored** value that may advance, for a Mongo
 * `{ status: { $in: [...] } }` clause.
 *
 * The code expansion is load-bearing: migrated Qualified leads are stored as
 * `hfwda` and Requote leads as `arW7O`, so without it neither would ever
 * advance. `''` and `null` are included because a lead with no status at all
 * should advance too — and `$in: [null]` also matches a missing field.
 * Uncatalogued values match nothing and stay put.
 */
export function quoteAdvanceableStatusValues(): (string | null)[] {
  return [
    ...QUOTE_ADVANCEABLE_LEAD_STATUSES.flatMap(leadStatusQueryValues),
    '',
    null,
  ];
}

/**
 * Statuses where the lead is finished — nobody should be chasing it (PAC-15).
 *
 * Membership currently coincides exactly with
 * {@link SOLD_NON_ADVANCING_LEAD_STATUSES}, and that is not a coincidence: both
 * answer "is this lead done?". They are kept separate because they answer it
 * for different purposes — one guards a write (don't drag a closed lead back to
 * Sold), this one filters a read (don't put a closed lead on a contact list) —
 * and a future status could plausibly belong to one and not the other.
 */
export const TERMINAL_LEAD_STATUSES: readonly LeadStatus[] = [
  'Sold',
  'Converted',
  'Not Qualified',
  'Lost',
  'Closed',
];

/**
 * Every **stored** form of a terminal status, for a Mongo
 * `{ status: { $nin: [...] } }` clause.
 *
 * The code expansion is load-bearing in the exclusion direction too: without
 * it, a migrated Lost lead stored as `jp76g` would not match the `Lost` label
 * and would sit on the producer's priority contact list forever.
 */
export function terminalLeadStatusValues(): string[] {
  return [...new Set(TERMINAL_LEAD_STATUSES.flatMap(leadStatusQueryValues))];
}

/**
 * Is this lead finished? Normalizes first, so a migrated lead stored as a raw
 * choice code (`jp76g` for Lost) answers correctly.
 *
 * The predicate form of {@link TERMINAL_LEAD_STATUSES}, for the callers holding
 * one status rather than building a Mongo clause — chiefly
 * `LeadTicketsService.resolveForLead`, which resolves a lead's quote ticket the
 * moment the lead reaches any terminal status.
 */
export function isTerminalLeadStatus(status?: string | null): boolean {
  return (TERMINAL_LEAD_STATUSES as readonly string[]).includes(
    normalizeLeadStatus(status),
  );
}

/** Where a submitted sold deal moves the lead (PAC-40). */
export const SOLD_ADVANCE_TARGET: LeadStatus = 'Sold';

/**
 * Has this lead already been sold? (PAC-56 #17)
 *
 * Drives the **UI gate** on the Quote and Mark-as-Sold actions: both are
 * disabled once the lead is sold, so a producer cannot start a second recap or
 * a second sale on a closed deal by habit.
 *
 * Deliberately narrower than {@link TERMINAL_LEAD_STATUSES}. A `Lost` or
 * `Not Qualified` lead is also finished, but it can legitimately come back —
 * PAC-38 made status freely editable in both directions for exactly that
 * reason — and greying out its actions would be a different product decision
 * from the one David asked for. Widening it later is one line here.
 *
 * Normalizes first, so a migrated lead stored as a raw choice code answers
 * correctly. This is a **UI affordance only**: `POST /sold-deals` deliberately
 * does *not* reject a sold lead, because `AdvanceLeadStep` is idempotent so the
 * `submissionToken` replay path can self-heal a create whose follow-up died.
 */
export function isSoldLeadStatus(status?: string | null): boolean {
  return normalizeLeadStatus(status) === SOLD_ADVANCE_TARGET;
}

/**
 * Statuses a sold deal must **not** drag the lead back from.
 *
 * Note this is listed while {@link QUOTE_ADVANCEABLE_LEAD_STATUSES} lists the
 * *advancing* side — the derivation runs in the opposite direction on purpose.
 * A quote advance is narrow (only pre-quote states qualify), so its safe
 * default for an unforeseen status is "don't advance". A sold advance is broad
 * — anything not already terminal — so its safe default is "do advance": a
 * status added to {@link LEAD_STATUSES} later should never silently block a
 * producer from booking a sale they actually made.
 */
export const SOLD_NON_ADVANCING_LEAD_STATUSES: readonly LeadStatus[] = [
  'Sold',
  'Converted',
  'Not Qualified',
  'Lost',
  'Closed',
];

/**
 * Derived, so a new mid-pipeline status advances by default.
 *
 * Currently: New, Contacted, Qualified, Quoted, Requote.
 */
export const SOLD_ADVANCEABLE_LEAD_STATUSES: readonly LeadStatus[] =
  LEAD_STATUSES.filter((s) => !SOLD_NON_ADVANCING_LEAD_STATUSES.includes(s));

/**
 * Every **stored** value that may advance to "Sold", for a Mongo
 * `{ status: { $in: [...] } }` clause.
 *
 * Same code expansion as {@link quoteAdvanceableStatusValues}, and load-bearing
 * for the same reason: migrated Qualified leads are stored as `hfwda` and
 * Requote leads as `arW7O`. `''` and `null` cover a lead with no status at all
 * (`$in: [null]` also matches a missing field). Uncatalogued values match
 * nothing and stay put.
 */
export function soldAdvanceableStatusValues(): (string | null)[] {
  return [
    ...SOLD_ADVANCEABLE_LEAD_STATUSES.flatMap(leadStatusQueryValues),
    '',
    null,
  ];
}
