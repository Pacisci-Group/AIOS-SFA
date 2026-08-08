// Type-only, and deliberately circular: `lead-detail` imports `ActivityType`
// from here. Both sides are erased at compile time, so there is no runtime
// cycle — and the alternative, defining the activity write response inside
// `lead-detail`, would file it under the wrong concept.
import type { LeadDetailActivity } from './lead-detail';

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
 * `email` and `note` are written by clients through `POST /activities`
 * (PAC-16) — the dashboard's lead quick actions and the Lead Detail note
 * composer. The timeline renders whatever exists rather than assuming a type
 * appears.
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

/**
 * The types a **client** may write (PAC-16). A strict subset of
 * {@link ACTIVITY_TYPES}.
 *
 * `lead_created`, `quoted`, `sold` and `audit_resolved` are system-generated
 * provenance, each written by the pipeline that owns the event. They are
 * excluded deliberately rather than by oversight: a client able to forge a
 * `sold` row could invent a sale on the Sold scorecard and the Leaderboard.
 *
 * `ACTIVITY_TYPES` is the **read** vocabulary; this is the **write** one.
 */
export const LOGGABLE_ACTIVITY_TYPES = [
  'call',
  'text',
  'email',
  'note',
] as const;

export type LoggableActivityType = (typeof LOGGABLE_ACTIVITY_TYPES)[number];

/** Default summary when a producer logs a touch without typing one. */
export const LOGGABLE_ACTIVITY_LABELS: Record<LoggableActivityType, string> = {
  call: 'Call logged',
  text: 'Text logged',
  email: 'Email logged',
  note: 'Note',
};

/**
 * `POST /activities` response.
 *
 * `activity` is the same `LeadDetailActivity` shape `GET /leads/:id` returns,
 * so the timeline can splice the new row in with no mapping layer.
 * `leadLastActivityAt` echoes the lead's bumped timestamp, which is what the
 * Hot Leads panel sorts on — returning it saves the client a refetch to learn
 * where the lead just moved to.
 */
export interface CreateActivityResponse {
  activity: LeadDetailActivity;
  leadLastActivityAt: string;
}

/** What an activity row hangs off. */
export const ACTIVITY_SUBJECT_TYPES = [
  'lead',
  'deal',
  'quoteRecap',
  'dealAuditItem',
] as const;

export type ActivitySubjectType = (typeof ACTIVITY_SUBJECT_TYPES)[number];

/**
 * Where an activity was written from (PAC-56 #29).
 *
 * Distinct from {@link ActivitySubjectType}, which is the storage-level "what
 * does this row hang off". This is the *provenance the reader needs*: a note
 * typed on the Lead Detail page, a note that arrived with a quote recap, and
 * one from the sold flow are three different things to a producer, and today
 * they render identically.
 *
 * Derived on read rather than stored, so it is correct for the rows already in
 * the collection — nothing has ever written a provenance field. `system` covers
 * both migrated rows and anything the platform generated with no human author.
 */
export const ACTIVITY_ORIGINS = [
  'lead',
  'quote_recap',
  'sold_deal',
  'audit',
  'system',
] as const;

export type ActivityOrigin = (typeof ACTIVITY_ORIGINS)[number];

/** How each origin is labelled on the timeline. */
export const ACTIVITY_ORIGIN_LABELS: Record<ActivityOrigin, string> = {
  lead: 'Lead',
  quote_recap: 'Quote recap',
  sold_deal: 'Sold deal',
  audit: 'Audit',
  system: 'Imported',
};
