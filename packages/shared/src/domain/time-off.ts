import { choiceVocabulary } from './choice-vocabulary';

/**
 * The four choice fields on the imported `timeOffRequests` collection (PAC-80).
 *
 * One table, four selects, so one module — splitting them into four files would
 * scatter a single source of record for no gain.
 *
 * Nothing reads this collection yet: no controller, no service, no component.
 * It is normalized anyway because the cost is a lookup table and the alternative
 * is leaving `FEJyv` in the database for whoever builds the time-off screen to
 * rediscover. Labels from `docs/smartsuite-tables/The Time Off Request Table.md`.
 */

/** Field `s4de941e84` (line 21). */
export const TIME_OFF_REQUEST_TYPES = [
  'Full Day(s)',
  'Partial Day (Hours)',
] as const;
export type TimeOffRequestType = (typeof TIME_OFF_REQUEST_TYPES)[number];

export const TIME_OFF_REQUEST_TYPE_CODE_ALIASES: Record<
  string,
  TimeOffRequestType
> = {
  FEJyv: 'Full Day(s)',
  sbIWx: 'Partial Day (Hours)',
};

/**
 * Field `s15cf96e61` (line 23) — a SmartSuite *status* field.
 *
 * ⚠ `backlog` means "Submitted" here, "Not Started" on Prior Policies and "Open"
 * on Service Tickets. The same four slugs, three different vocabularies: the
 * clearest demonstration of why a global code map cannot work.
 */
export const TIME_OFF_STATUSES = [
  'Submitted',
  'Approved',
  'Denied',
  'Cancelled',
] as const;
export type TimeOffStatus = (typeof TIME_OFF_STATUSES)[number];

export const TIME_OFF_STATUS_CODE_ALIASES: Record<string, TimeOffStatus> = {
  backlog: 'Submitted',
  in_progress: 'Approved',
  ready_for_review: 'Denied',
  complete: 'Cancelled',
};

/** Field `sec9109888` (line 31). */
export const TIME_OFF_TYPES = ['Unpaid', 'PTO', 'Sick'] as const;
export type TimeOffType = (typeof TIME_OFF_TYPES)[number];

export const TIME_OFF_TYPE_CODE_ALIASES: Record<string, TimeOffType> = {
  // The doc's example renders this as `"Unpaid "` — a trailing space in the
  // SmartSuite label itself. Stored trimmed; the vocabulary trims on the way in
  // too, so the raw label also resolves.
  Aw0Xh: 'Unpaid',
  ROgIb: 'PTO',
  FaIkv: 'Sick',
};

/** Field `s9f9622cf9` (line 32). */
export const TIME_OFF_DECISIONS = ['Approve', 'Deny'] as const;
export type TimeOffDecision = (typeof TIME_OFF_DECISIONS)[number];

export const TIME_OFF_DECISION_CODE_ALIASES: Record<string, TimeOffDecision> = {
  yX9Ig: 'Approve',
  '4sKn5': 'Deny',
};

export const normalizeTimeOffRequestType = choiceVocabulary(
  TIME_OFF_REQUEST_TYPES,
  TIME_OFF_REQUEST_TYPE_CODE_ALIASES,
).normalize;

export const normalizeTimeOffStatus = choiceVocabulary(
  TIME_OFF_STATUSES,
  TIME_OFF_STATUS_CODE_ALIASES,
).normalize;

export const normalizeTimeOffType = choiceVocabulary(
  TIME_OFF_TYPES,
  TIME_OFF_TYPE_CODE_ALIASES,
).normalize;

export const normalizeTimeOffDecision = choiceVocabulary(
  TIME_OFF_DECISIONS,
  TIME_OFF_DECISION_CODE_ALIASES,
).normalize;
