/**
 * Canonical lead-source vocabulary.
 *
 * Shared (not API-local) because three consumers need the same list: the
 * SmartSuite migration writes normalized sources, the demo seed generates them,
 * and the Leads page renders the filter dropdown from it (PAC-36).
 */

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
 * The canonical sources as `{ code, label }`, sorted by label — what a filter
 * dropdown renders. `Test` is included; callers that exclude test records
 * (every dashboard read path) should filter it out of the options they show.
 */
export const LEAD_SOURCE_OPTIONS: ReadonlyArray<{ code: string; label: string }> =
  Object.entries(CANONICAL_LEAD_SOURCES)
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

/** Canonical labels only, sorted — for a filter that matches on `leadSource.label`. */
export const LEAD_SOURCE_LABELS: readonly string[] = [
  ...new Set(LEAD_SOURCE_OPTIONS.map((o) => o.label)),
];

/**
 * The sources a human may pick on an intake form — `Test` (ENEJP) removed.
 *
 * This is what lets the intake pipeline write `isTestRecord: false`
 * unconditionally instead of calling `isTestRecord()`: that helper flags any
 * label containing test/sample/demo, so a real prospect named Demopoulos would
 * be created invisible (every read path filters `isTestRecord: { $ne: true }`)
 * with no feedback to the producer.
 */
export const SELECTABLE_LEAD_SOURCE_OPTIONS: ReadonlyArray<{
  code: string;
  label: string;
}> = LEAD_SOURCE_OPTIONS.filter((o) => o.code !== 'ENEJP');

/**
 * Sentinel for "no lead source recorded" in the Leads-page filter (PAC-37).
 *
 * Leads created through a public share link store `{ code: null, label: '' }` —
 * nobody has said where they came from yet. Producers need to isolate them to
 * correct them, and an empty string can't be a query param value.
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
