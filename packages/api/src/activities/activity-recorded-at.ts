import type { Activity } from './schemas/activity.schema';

/**
 * Sources whose `createdAt` is the time a bulk import ran, not anything a
 * person did: the SmartSuite migration leaves `source` at its `'migration'`
 * default, and the demo seed writes `'demo'`.
 */
export const SEEDED_ACTIVITY_SOURCES: ReadonlySet<string> = new Set([
  'migration',
  'demo',
]);

/**
 * When the row was entered into the app — what the lead timeline shows and
 * sorts by.
 *
 * Not `occurredAt`: on `sold`, `quoted` and `lead_created` rows that is the
 * **business date** from the form (stored at agency-local midnight), so a sale
 * back-dated to last week would read as last week at 12:00 AM rather than when
 * the producer actually marked it sold. The document's own `createdAt` is the
 * entry time.
 *
 * Seeded rows fall back to `occurredAt`: their `createdAt` is the import run,
 * which would stamp years of history with one meaningless instant. On every
 * other row type the two agree anyway, because the app writes notes, touches
 * and edits with `occurredAt` = now.
 */
export function activityRecordedAt(
  activity: Pick<Activity, 'source' | 'occurredAt' | 'createdAt'>,
): Date | undefined {
  if (SEEDED_ACTIVITY_SOURCES.has(activity.source)) {
    return activity.occurredAt;
  }
  return activity.createdAt ?? activity.occurredAt;
}
