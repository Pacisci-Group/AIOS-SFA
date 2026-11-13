import { eventType } from 'inngest';
import { z } from 'zod';
import { objectId } from './envelope';

/**
 * Event contract for on-demand MongoDB snapshots (PAC-172).
 *
 * The weekly snapshot is a cron and needs no event. This one asks the same
 * function for an extra, out-of-schedule snapshot — before a risky manual
 * operation today, and before a migrating deploy once the deploy workflow
 * learns to send it.
 *
 * ## ⚠ The one schema that does not spread `eventEnvelope`
 * Every other event is emitted by the API through `InngestService.send`, which
 * mints the `eventLogId` the envelope requires. This one is not: it is sent by
 * an operator (a `curl` to the Inngest event API through the SSH tunnel — see
 * DEPLOYMENT.md, "Database backups"), so nothing has written an `eventLog` row
 * for it. Inngest validates incoming events against this schema before the
 * function runs, and a required `eventLogId` would fail every manual request
 * as non-retriable. Optional here, it is still accepted if a future sender
 * does go through the outbox.
 *
 * The corollary is intended: `InngestService.send` constrains its event to a
 * required `eventLogId`, so the API process cannot emit this event by
 * accident. Snapshots are an operator's act, not an application side effect.
 *
 * Same rules as the rest of the catalog otherwise: no transforms, ids and
 * display fields only.
 */
const dbBackupSnapshotRequestedSchema = z.object({
  eventLogId: objectId.optional(),
  /**
   * Why the snapshot is being taken; also the archive's prefix in the bucket.
   * Scheduled snapshots are not requested this way, so `weekly` is not an
   * option — and only `weekly/` is rotated, so an ad-hoc snapshot can never
   * push a scheduled one out.
   */
  reason: z.enum(['manual', 'pre-deploy']),
  /**
   * Free text appended to the archive name — the operation it guards, or the
   * commit being deployed. Sanitised into a key segment by the worker.
   */
  label: z.string().max(200).nullish(),
});

export const dbBackupSnapshotRequested = eventType(
  'db-backup/snapshot.requested.v1',
  { schema: dbBackupSnapshotRequestedSchema },
);

export type DbBackupSnapshotRequestedData = z.infer<
  typeof dbBackupSnapshotRequestedSchema
>;
