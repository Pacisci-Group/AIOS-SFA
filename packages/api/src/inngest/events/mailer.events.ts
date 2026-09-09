import { eventType } from 'inngest';
import { z } from 'zod';
import { eventEnvelope, objectId } from './envelope';

/**
 * Event contracts for mailer campaigns (PAC-71).
 *
 * Obeys the rules the catalog documents in `email.events.ts`:
 *
 * 1. **No transforms.** `eventType` rejects any schema whose input and output
 *    types differ, because an event is serialised to JSON, sent over the wire
 *    and re-parsed on the far side. No `z.coerce.*`, `.default()`,
 *    `.transform()` or `.pipe()`.
 * 2. **Ids plus display fields only — never documents.** The payload carries the
 *    campaign id; the handler loads what it needs. A 23 MB file obviously cannot
 *    travel in an event, but neither should the parsed preview — the campaign
 *    record is where state lives.
 * 3. **Spread `eventEnvelope` first.** It carries `eventLogId`, the outbox row
 *    this event is recorded against. `InngestService.send` mints and sets it —
 *    producers never pass it — but a schema that omits it cannot be passed to
 *    `send` at all, which is a compile error rather than the very quiet runtime
 *    symptom it would otherwise be: runs that never reach a terminal state and
 *    get re-emitted by the sweeper forever.
 *
 * ## Why `attempt` is in the payload
 *
 * The campaign record carries `previewAttempt` / `commitAttempt`, bumped on
 * every dispatch. A handler compares the event's `attempt` against the stored
 * counter and **no-ops when they disagree**. Without it a retried preview can
 * land after a newer one and overwrite its result with stale numbers — which the
 * operator then commits against. It is also half the idempotency key, so a
 * double-submitted commit runs once while a deliberate re-run still runs.
 *
 * ## Why separate events rather than one with a phase flag
 *
 * They are gated differently and mean different things. A preview writes
 * nothing; a commit writes tens of thousands of documents and may delete some.
 * Collapsing them would put that distinction inside a handler, where a bug
 * silently writes data the operator only asked to look at.
 */

const campaignJobSchema = z.object({
  ...eventEnvelope,
  /** `MailerCampaign._id`. The handler reads and writes status through it. */
  campaignId: objectId,
  /** Must equal the campaign's current attempt counter, or the job no-ops. */
  attempt: z.number().int().min(1),
  /** The operator, recorded on every mailer and lead link the run writes. */
  requestedBy: objectId,
});

/**
 * Parse the uploaded file, run the transform in memory and report what it
 * contains. **Writes no mailers.**
 *
 * The operator sees row counts, the assignment resolution, unmatched ZIPs, the
 * premium spread, the floor hit rate and any overlapping campaign before
 * deciding whether to commit.
 */
export const mailerCampaignPreviewRequested = eventType(
  'mailers/campaign.preview.requested.v1',
  { schema: campaignJobSchema },
);

/**
 * Run the transform for real: write the output CSV, upsert the mailers, delete
 * whatever an overwrite replaced, and reconcile pending lead links.
 *
 * Re-reads the vendor file rather than reusing the preview's output: 20k mapped
 * rows are far too much to stash on the campaign record, and the object key is
 * UUID-suffixed and therefore immutable, so the second read sees byte-identical
 * input.
 */
export const mailerCampaignCommitRequested = eventType(
  'mailers/campaign.commit.requested.v1',
  { schema: campaignJobSchema },
);

/**
 * Mail the completion notice with a time-limited download link.
 *
 * A **separate** function, not a step of the commit, so a mail-transport failure
 * can never fail an import that already succeeded.
 */
export const mailerCampaignOutputEmailRequested = eventType(
  'mailers/campaign.output-email.requested.v1',
  {
    schema: campaignJobSchema.extend({
      recipients: z.array(z.string()).min(1),
    }),
  },
);

/** The payload the preview and commit functions receive. */
export type MailerCampaignJobData = z.infer<typeof campaignJobSchema>;

/** The payload the output-email function receives. */
export type MailerCampaignOutputEmailData = MailerCampaignJobData & {
  recipients: string[];
};
