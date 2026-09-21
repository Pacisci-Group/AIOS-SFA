/**
 * Lead sources.
 *
 * ## A collection, not a constant (PAC-135)
 *
 * Where a lead came from is data an agency curates, so it lives in the
 * `leadSources` collection and leads/deals reference a row by `leadSourceId`.
 * The hard-coded list below was already wrong about production: real leads carry
 * Web, Walk-In, Other and Live Call Transfer, none of which are in it, and the
 * same source sits under several SmartSuite codes (`Mail` on 380 leads, `WCO7l`
 * on 14) because choice codes are per-field.
 *
 * Two kinds of row, the `Carrier` pattern: `agencyId: null` is a platform source
 * every agency sees, a string is that agency's own. Only seeded today — the
 * super-admin and agency-settings curation surfaces are deliberately not built.
 *
 * ## What is left of the old vocabulary
 *
 * {@link normalizeLeadSource} and the code maps survive **only for the SmartSuite
 * import**, which still has to turn a choice code into a name before it can find
 * or create a row. Nothing else should reach for them.
 */

/** A lead source as a record renders it. `id: null` = nobody has said yet. */
export interface LeadSourceRef {
  id: string | null;
  label: string;
}

/** One selectable lead source, as `GET /lead-sources` returns it. */
export interface LeadSourceOption {
  id: string;
  name: string;
  /** Stable key. Code identifies a source by this, never by its name. */
  slug: string;
}

export interface LeadSourceListResponse {
  leadSources: LeadSourceOption[];
}

/**
 * The platform sources every agency starts with, in display order.
 *
 * Deliberately short. Waterstone, Stride, Soleo, JYA and Data Lot look universal
 * in the legacy list but are one agency's vendors; they become that agency's own
 * rows instead.
 */
export const PLATFORM_LEAD_SOURCES: readonly string[] = [
  'Mailer',
  'Book of Business',
  'Customer Referral',
  'Facebook',
  'Google',
  'Web',
  'Walk-In',
  'Other',
];

/**
 * Where a row sits in a picker, ascending, ties broken by name.
 *
 * Platform rows take their index in {@link PLATFORM_LEAD_SOURCES}; a row with no
 * `displayOrder` — every agency-owned row today — takes
 * {@link LEAD_SOURCE_DEFAULT_ORDER}; and `Other` is pinned to
 * {@link LEAD_SOURCE_LAST_ORDER}. The result reads: the common sources, then the
 * agency's own alphabetically, then the catch-all at the very bottom, where a
 * producer looks for it only after failing to find the real one.
 *
 * ⚠ Resolved in application code, not by a Mongo `$sort`: Mongo orders a missing
 * field *before* every number, which would put an agency's vendors above Mailer.
 */
export const LEAD_SOURCE_DEFAULT_ORDER = 500;
export const LEAD_SOURCE_LAST_ORDER = 1000;

/** The display order a platform source is seeded with. */
export function platformLeadSourceOrder(name: string): number {
  if (leadSourceSlug(name) === 'other') return LEAD_SOURCE_LAST_ORDER;
  return PLATFORM_LEAD_SOURCES.indexOf(name);
}

/**
 * Mailer (PAC-61). Every lead logged from a direct-mail piece carries this
 * source, set server-side and never read from the request — so it is found by
 * slug, which a rename cannot break.
 */
export const MAILER_LEAD_SOURCE_SLUG = 'mailer';

/** The dedupe key for a lead source: `Walk-In` and `walk in` are one row. */
export function leadSourceSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Labels the import produces that are *not* a source: an absent value, the
 * importer's own placeholder, and the legacy `Test` choice (those records are
 * already `isTestRecord`). They leave `leadSourceId` unset.
 */
export function isLeadSourcePlaceholder(label: string | null | undefined): boolean {
  const slug = leadSourceSlug(label ?? '');
  return slug === '' || slug === 'unknown' || slug === 'test';
}

/** The legacy embedded shape. Import-only — see the module note. */
export interface NormalizedLeadSource {
  code: string | null;
  label: string;
}

/**
 * The 14 canonical lead sources (authoritative list from SFA/lib/leadSources.ts).
 * Keyed by the SmartSuite select choice code.
 */
export const CANONICAL_LEAD_SOURCES: Record<string, string> = {
  WCO7l: 'Mailer',
  GVCgc: 'Book of Business',
  UqEUq: 'Allstate Lead Marketplace',
  Eos2j: 'Customer Referral',
  oayGb: 'Data Lot',
  X2Wrh: 'Facebook',
  '30sDe': 'Google',
  DmjDy: 'Mail Referral',
  xjtnZ: 'Quotewizard',
  gjJUG: 'Soleo',
  qmWQA: 'Stride',
  FdgIw: 'Waterstone',
  ENEJP: 'Test',
  ymZHL: 'JYA',
};

/**
 * Extra Deal "Fillout Lead Source" (s989aa45e7) codes that are not in the canonical
 * 14 — folded into their closest canonical bucket where sensible, else kept labeled.
 */
const NON_CANONICAL_CODE_ALIASES: Record<string, string> = {
  '65o7M': 'Book of Business', // House
  hqGGu: 'JYA', // Mailer-JYA
  YtWBU: 'Book of Business', // MGO
  Z8lxN: 'Book of Business', // MES
};

/** Legacy free-text / Leads-table select labels mapped to canonical labels. */
const LABEL_ALIASES: Record<string, string> = {
  mailer: 'Mailer',
  mail: 'Mailer',
  'book of business': 'Book of Business',
  'book of business lead': 'Book of Business',
  'allstate lead marketplace': 'Allstate Lead Marketplace',
  'customer referral': 'Customer Referral',
  referral: 'Customer Referral',
  'referral partner': 'Customer Referral',
  'mail referral': 'Mail Referral',
  'data lot': 'Data Lot',
  facebook: 'Facebook',
  google: 'Google',
  quotewizard: 'Quotewizard',
  soleo: 'Soleo',
  stride: 'Stride',
  waterstone: 'Waterstone',
  jya: 'JYA',
  test: 'Test',
};

const CANONICAL_LABELS = new Set(Object.values(CANONICAL_LEAD_SOURCES));

/**
 * Sentinel for "no lead source recorded" in the Leads-page filter (PAC-37).
 *
 * Leads created through a public share link carry no `leadSourceId` — nobody
 * has said where they came from yet. Producers need to isolate them to correct
 * them, and an empty string can't be a query param value. Also what
 * `PATCH /leads/:id` takes to *clear* a source.
 */
export const LEAD_SOURCE_NONE = '__none__';

export interface LeadSourceResult extends NormalizedLeadSource {
  isCanonical: boolean;
}

/**
 * Normalize a lead source given a select code and/or a label. Prefers the code
 * (stable), falls back to label alias matching. Returns the canonical
 * { code, label } plus whether it resolved to one of the 14 canonical sources.
 */
export function normalizeLeadSource(
  code?: string | null,
  label?: string | null,
): LeadSourceResult {
  if (code && CANONICAL_LEAD_SOURCES[code]) {
    return { code, label: CANONICAL_LEAD_SOURCES[code], isCanonical: true };
  }
  if (code && NON_CANONICAL_CODE_ALIASES[code]) {
    return {
      code,
      label: NON_CANONICAL_CODE_ALIASES[code],
      isCanonical: true,
    };
  }

  // Fall back to label matching. For the Leads table the select "code" is itself a
  // human label (e.g. "Mail", "Referral Partner"), so consider it too.
  const rawLabel = (label ?? code ?? '').trim();
  if (rawLabel) {
    const aliased = LABEL_ALIASES[rawLabel.toLowerCase()];
    if (aliased) {
      return { code: code ?? null, label: aliased, isCanonical: true };
    }
    if (CANONICAL_LABELS.has(rawLabel)) {
      return { code: code ?? null, label: rawLabel, isCanonical: true };
    }
    return { code: code ?? null, label: rawLabel, isCanonical: false };
  }

  return { code: code ?? null, label: 'Unknown', isCanonical: false };
}

const TEST_TOKENS = ['test', 'sample', 'demo'];

/**
 * Flag test/sample/demo records for exclusion. Checks the lead-source (code ENEJP
 * = Test, or label) plus any provided name-like strings (client/producer/title).
 */
export function isTestRecord(
  leadSource: NormalizedLeadSource | null | undefined,
  ...names: (string | null | undefined)[]
): boolean {
  if (leadSource?.code === 'ENEJP') return true;
  const haystacks = [leadSource?.label, ...names]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => s.toLowerCase());
  return haystacks.some((h) => TEST_TOKENS.some((t) => h.includes(t)));
}
