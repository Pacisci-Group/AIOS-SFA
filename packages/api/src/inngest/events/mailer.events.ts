import { eventType } from 'inngest';
import { z } from 'zod';
import { eventEnvelope, objectId } from './envelope';

/**
 * Event contracts for mailer imports (PAC-73).
 *
 * Obeys the two rules the catalog already documents in `email.events.ts`:
 *
 * 1. **No transforms.** `eventType` rejects any schema whose input and output
 *    types differ, because an event is serialised to JSON, sent over the wire
 *    and re-parsed on the far side. No `z.coerce.*`, `.default()`,
 *    `.transform()` or `.pipe()`.
 * 2. **Ids plus display fields only — never documents.** The payload carries
 *    the run id and the object key; the handler loads what it needs. A 23 MB
 *    file obviously cannot travel in an event, but neither should the parsed
 *    preview — the run record is where state lives.
 * 3. **Spread `eventEnvelope` first.** It carries `eventLogId`, the outbox row
 *    this event is recorded against. `InngestService.send` mints and sets it —
 *    producers never pass it — but a schema that omits it cannot be passed to
 *    `send` at all, which is a compile error rather than the very quiet runtime
 *    symptom it would otherwise be: runs that never reach a terminal state and
 *    get re-emitted by the sweeper forever.
 *
 * ## Why two events rather than one with a phase flag
 *
 * They are gated differently and they mean different things. A preview writes
 * nothing and needs no confirmation; a commit writes tens of thousands of
 * documents and may require the operator to have explicitly confirmed an agency
 * mismatch first. Collapsing them into one event with a discriminator would put
 * that distinction inside the handler, where a bug silently writes data the
 * operator only asked to look at.
 */

const importRequestedSchema = z.object({
  ...eventEnvelope,
  /** `MailerImportRun._id`. The handler reads and writes status through it. */
  importRunId: objectId,
  /** The agency the operator explicitly chose. Never inferred from the file. */
  agencyId: objectId,
  /** Object-storage key of the raw upload, minted server-side. */
  storageKey: z.string().min(1),
  /** The operator, recorded on every mailer the run writes. */
  requestedBy: objectId,
});

/**
 * Parse the uploaded file and report what it contains. **Writes no mailers.**
 *
 * The operator sees row count, what the file says about itself, and the
 * rejections with reasons before deciding whether to commit.
 */
export const mailerImportPreviewRequested = eventType(
  'mailers/import.preview.requested.v1',
  { schema: importRequestedSchema },
);

/**
 * Re-parse the same file and upsert the mailers.
 *
 * Re-parses rather than reusing the preview's output: 20k mapped documents are
 * far too much to stash on the run record, and the object key is UUID-suffixed
 * and therefore immutable, so the second parse sees byte-identical input.
 */
export const mailerImportCommitRequested = eventType(
  'mailers/import.commit.requested.v1',
  { schema: importRequestedSchema },
);

/** The payload both mailer-import functions receive. */
export type MailerImportRequestedData = z.infer<typeof importRequestedSchema>;
