/**
 * Activity/timeline vocabulary — shared because the Lead Detail timeline
 * (PAC-38) renders one icon and tone per type, and the web app cannot import
 * from `packages/api`.
 *
 * The union previously lived only in `api/src/activities/schemas/activity.schema.ts`;
 * that schema now imports and re-exports it, so there is one list.
 */

/**
 * Every activity type the platform writes.
 *
 * Only three are produced today, one per pipeline form:
 * - `lead_created` — `LeadIntakeService` (PAC-37)
 * - `quoted`       — `QuoteRecapsService` (PAC-39)
 * - `sold`         — `SoldDealIntakeService` (PAC-40)
 *
 * `audit_resolved` comes from the hand-off board (PAC-14). `call`, `text`,
 * `email` and `note` are declared but **nothing writes them yet** — the quick
 * actions that will are PAC-16. The timeline therefore renders whatever exists
 * rather than assuming a type appears.
 */
export const ACTIVITY_TYPES = [
  'lead_created',
  'quoted',
  'sold',
  'call',
  'text',
  'email',
  'note',
  'audit_resolved',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** What an activity row hangs off. */
export const ACTIVITY_SUBJECT_TYPES = [
  'lead',
  'deal',
  'quoteRecap',
  'dealAuditItem',
] as const;

export type ActivitySubjectType = (typeof ACTIVITY_SUBJECT_TYPES)[number];
