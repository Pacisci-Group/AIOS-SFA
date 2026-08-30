import { eventType } from 'inngest';
import { z } from 'zod';
import { eventEnvelope, isoDateTime, objectId } from './envelope';

/**
 * Event contracts for outbound email.
 *
 * ## Two rules these schemas obey, both enforced by the compiler
 *
 * 1. **No transforms.** Inngest's `eventType` rejects any schema whose input
 *    and output types differ (`AssertNoTransform`), because an event is
 *    serialised to JSON, sent over the wire, and re-parsed on the far side —
 *    a transform would silently mean the two sides disagree. Practically that
 *    bans `z.coerce.*`, `.default()`, `.transform()` and `.pipe()`. Dates
 *    therefore cross the wire as **ISO strings** and are parsed by the handler,
 *    never as `Date` objects.
 * 2. **Ids plus display fields only — never documents.** A payload carries what
 *    a template needs to render and nothing else. This is the contract
 *    {@link InviteEmailPayload} already documented ("templates should never be
 *    able to reach back into the database") and it survives verbatim here.
 *
 * ## Naming and versioning
 * `<domain>/<thing>.<past-tense-verb>`, with the version in the name (`.v1`)
 * rather than a separate field. Adding an optional field does not bump it;
 * removing or retyping one mints `.v2`, and both stay registered until the
 * queue and Inngest's event history no longer hold any `.v1`.
 */

/**
 * Someone was invited to an agency and needs the "set your password" link.
 *
 * Emitted by `UsersService.issueInvite` (through `MailService`) for both the
 * first invite and every resend. A resend mints a **new** token, so it produces
 * a different `inviteUrl` and is correctly treated as a distinct event by the
 * consumer's idempotency key.
 */
const inviteRequestedSchema = z.object({
  ...eventEnvelope,
  /** The invited user. Present so the consumer can record delivery against them. */
  userId: objectId,
  agencyId: objectId,
  /** Null for a user not yet pinned to a branch. */
  branchId: objectId.nullable(),
  /** Already lowercased by the caller. */
  to: z.string().email(),
  /** Null when the owner left both name fields blank. */
  recipientName: z.string().nullable(),
  agencyName: z.string(),
  /** Null when the inviter cannot be resolved. */
  inviterName: z.string().nullable(),
  roleNames: z.array(z.string()),
  /**
   * Absolute accept-invite URL built from `APP_BASE_URL`.
   *
   * ⚠ This is a **bearer credential**. It must never be logged in production
   * and is deliberately not persisted on the delivery record.
   */
  inviteUrl: z.string().url(),
  expiresAt: isoDateTime,
});

export const inviteRequested = eventType('email/invite.requested.v1', {
  schema: inviteRequestedSchema,
});

/** The rendered payload an invite template receives. */
export type InviteRequestedData = z.infer<typeof inviteRequestedSchema>;

/**
 * An agency administrator triggered a password reset for one of their people
 * and they need the "set a new password" link (PAC-79).
 *
 * Emitted by `UsersService.sendPasswordReset` through `MailService`. Every issue
 * mints a fresh token and therefore a different `resetUrl`, so the consumer's
 * idempotency key treats a second reset as a distinct event and sends it.
 */
const passwordResetRequestedSchema = z.object({
  ...eventEnvelope,
  /** The user resetting. Present so the consumer can record delivery. */
  userId: objectId,
  agencyId: objectId,
  /** Null for a user not pinned to a branch. */
  branchId: objectId.nullable(),
  /** Already lowercased by the caller. */
  to: z.string().email(),
  /** Null when both name fields are blank. */
  recipientName: z.string().nullable(),
  /**
   * The agency, for the "an administrator at X" line.
   *
   * ⚠ There is deliberately no field naming *which* administrator — see
   * `PasswordResetEmailPayload`. Adding one is a product decision with a
   * social-engineering cost, not a missing field.
   */
  agencyName: z.string(),
  /**
   * Absolute reset URL built from `APP_BASE_URL`.
   *
   * ⚠ A **bearer credential**, and a stronger one than `inviteUrl` above: it
   * takes over an account that already exists and has data in it. Never logged
   * in production, never persisted on the delivery record.
   */
  resetUrl: z.string().url(),
  expiresAt: isoDateTime,
});

export const passwordResetRequested = eventType(
  'email/password-reset.requested.v1',
  { schema: passwordResetRequestedSchema },
);

/** The rendered payload a password-reset template receives. */
export type PasswordResetRequestedData = z.infer<
  typeof passwordResetRequestedSchema
>;
