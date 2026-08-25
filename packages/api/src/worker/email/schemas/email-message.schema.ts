import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const EMAIL_STATUSES = [
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed',
  'suppressed',
] as const;

export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export type EmailMessageDocument = HydratedDocument<EmailMessage>;

/**
 * One row per email we attempted to deliver.
 *
 * ## This is a *record*, not a concurrency guard
 * Worth stating plainly, because a hand-rolled queue would need it to be the
 * latter and the schema would look very different. Duplicate sends are already
 * prevented three layers up:
 *
 * 1. Inngest's function-level `idempotency` key collapses duplicate *events*
 *    within 24h.
 * 2. `step.run('send')` memoizes on success, so retrying a run whose send
 *    already completed replays the stored result instead of re-sending.
 * 3. Resend's `Idempotency-Key` header covers the one case Inngest cannot see —
 *    the request arrived but the response was lost in flight.
 *
 * So this collection exists to answer *"did this person get the email?"* — for
 * the users list's invite status and for support. It is written after the send,
 * and a write that fails does not un-send anything.
 *
 * ## Why it does not extend `TenantRecord`
 * `TenantRecord` requires `branchId`, and plenty of email is agency-scoped with
 * no branch (an invite to a user not yet pinned to one). Rather than write a
 * sentinel branch id to satisfy a base class, this declares its own tenancy
 * fields with `branchId` nullable. It is an operational record, not a tenant
 * domain record, and it carries no `legacySmartSuiteId` because nothing here
 * was ever migrated.
 */
@Schema({ timestamps: true, collection: 'emailMessages' })
export class EmailMessage {
  @Prop({ required: true, index: true })
  agencyId: string;

  /** Null for agency-scoped mail with no branch context. */
  @Prop({ type: String, default: null })
  branchId: string | null;

  /** Inngest's event id — the join back to a run in the dashboard. */
  @Prop({ required: true })
  eventId: string;

  /** e.g. `email/invite.requested.v1`. */
  @Prop({ required: true })
  eventType: string;

  /** Key into `EMAIL_TEMPLATES`. A stored value: renaming one is a migration. */
  @Prop({ required: true })
  templateKey: string;

  @Prop({ required: true, lowercase: true, trim: true })
  to: string;

  @Prop({ required: true })
  from: string;

  @Prop({ default: '' })
  replyTo: string;

  @Prop({ required: true })
  subject: string;

  /**
   * `type: String` is required, not decorative: `EmailStatus` is a union, and
   * `emitDecoratorMetadata` reports a union as `Object`, so Mongoose cannot
   * infer the field and throws `CannotDetermineTypeError` at boot.
   */
  @Prop({ type: String, required: true, enum: EMAIL_STATUSES, index: true })
  status: EmailStatus;

  /**
   * The provider's message id. Null only for `suppressed` and `failed`, where
   * no send was attempted or none succeeded.
   */
  @Prop({ type: String, default: null })
  providerMessageId: string | null;

  @Prop({ type: Date, default: null })
  sentAt: Date | null;

  /** Last time a provider webhook updated this row. */
  @Prop({ type: Date, default: null })
  lastProviderEventAt: Date | null;

  @Prop({ default: '' })
  lastError: string;

  /**
   * SHA-256 of the rendered text body.
   *
   * ⚠ The body itself is deliberately **not** stored. An invite link is a
   * bearer credential — persisting it would put a working password-reset URL in
   * a collection that support staff and any future admin UI can read. A hash
   * still answers "did these two recipients get identical content?", which is
   * the only question the body was wanted for.
   */
  @Prop({ default: '' })
  bodyHash: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EmailMessageSchema = SchemaFactory.createForClass(EmailMessage);

/**
 * Match an inbound Resend delivery/bounce webhook to its row.
 *
 * Partial rather than `sparse: true`: this is a single-field index so sparse
 * would technically work, but a partial filter on the type states the intent
 * exactly — index the rows where a provider actually accepted the message —
 * and matches the convention `LEGACY_DEDUPE_INDEX_OPTIONS` sets for the rest of
 * the codebase. Not unique: Resend does not guarantee ids are never reused
 * across accounts, and a duplicate here should not reject a delivery record.
 */
EmailMessageSchema.index(
  { providerMessageId: 1 },
  { partialFilterExpression: { providerMessageId: { $type: 'string' } } },
);

/** The users-list invite-status lookup, and per-agency support queries. */
EmailMessageSchema.index({ agencyId: 1, createdAt: -1 });

/** "What has this address received?" — the question support actually asks. */
EmailMessageSchema.index({ to: 1, createdAt: -1 });
