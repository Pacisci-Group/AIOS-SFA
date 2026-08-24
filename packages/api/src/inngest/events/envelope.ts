import { z } from 'zod';

/**
 * Primitives and the shared envelope every event schema is built from.
 *
 * Split out from `email.events.ts` the moment a second domain needed them: an
 * event file for another domain importing from the *email* one would put the
 * catalog's shared vocabulary behind an arbitrary door.
 */

/**
 * ISO-8601 instant.
 *
 * Never `z.coerce.date()` — see rule 1 in `email.events.ts`. Inngest's
 * `eventType` rejects schemas whose input and output types differ, because an
 * event is JSON on the wire and a transform would mean the two sides disagree.
 */
export const isoDateTime = z.string().datetime();

/** 24-character hex Mongo ObjectId, stringified. */
export const objectId = z
  .string()
  .regex(/^[0-9a-f]{24}$/, 'expected a 24-hex ObjectId');

/**
 * Fields every event carries, stamped by the transport rather than the producer.
 *
 * `eventLogId` is the `_id` of this event's row in the `eventLog` collection.
 * `InngestService.send` mints it and sets it; producers never pass it, and
 * `MailService` does not know it exists.
 *
 * ## Why it lives in `data`
 * `InngestService.send` also sets it as the event's Inngest `id`, so it is on the
 * wire twice. The duplication is deliberate: the `id` buys 24h of server-side
 * deduplication, while *this* copy is what the worker reads back. The SDK makes
 * no promise that the id we send is the id a handler receives, and the whole
 * point of the catalog is that the contract between producer and consumer is
 * checked by the compiler rather than assumed.
 *
 * ## Every new event schema must spread this
 * Forgetting it is a **compile error**, not a runtime surprise:
 * `InngestService.send` constrains its event to `{ eventLogId: string }`, so a
 * schema without it cannot be passed. That constraint exists precisely because
 * the runtime symptom would be so quiet — runs that never reach a terminal state,
 * look permanently `pending`, and get re-emitted by the sweeper every five
 * minutes forever. Spread it first, before the domain fields:
 *
 * ```ts
 * const somethingHappenedSchema = z.object({
 *   ...eventEnvelope,
 *   agencyId: objectId,
 * });
 * ```
 */
export const eventEnvelope = {
  eventLogId: objectId,
};
