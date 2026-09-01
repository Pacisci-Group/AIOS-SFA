/**
 * The payload an invite email is rendered from.
 *
 * Deliberately a plain data object with no Mongoose documents in it: whatever
 * transport eventually lands (see {@link MailService}) will hand this to a
 * template, and templates should never be able to reach back into the database.
 */
export interface InviteEmailPayload {
  /**
   * The invited user, as a 24-hex string.
   *
   * Added when delivery moved to the worker: the delivery record is written in
   * another process (and, later, possibly another container), so it cannot go
   * looking for the user it belongs to.
   */
  userId: string;
  /** Agency the invite belongs to, as a 24-hex string. */
  agencyId: string;
  /** Null when the user is not yet pinned to a branch. */
  branchId: string | null;
  /** Where the invite is going. Already lowercased by the caller. */
  to: string;
  /** Invitee's display name, or null when the owner left both name fields blank. */
  recipientName: string | null;
  /** Agency the invitee is joining, for the greeting. */
  agencyName: string;
  /** Who sent it, for the "X invited you" line. Null if it can't be resolved. */
  inviterName: string | null;
  /** Human-readable role names the invitee has been assigned. */
  roleNames: string[];
  /** Absolute accept-invite URL, built from `APP_BASE_URL`. */
  inviteUrl: string;
  /** When the link stops working, for the "expires in N days" line. */
  expiresAt: Date;
}

/**
 * The payload a password-reset email is rendered from (PAC-79).
 *
 * Same plain-data rule as {@link InviteEmailPayload} — no Mongoose documents, so
 * a template can never reach back into the database.
 *
 * ⚠ **No `requestedByName`.** The invite email names the inviter, and the
 * obvious symmetry here would be "your agency owner reset your password". It is
 * deliberately absent: naming a specific person is reassuring to the recipient
 * and equally useful to an attacker deciding who to impersonate on the
 * follow-up phone call. The template names the agency instead, which is enough
 * for the recipient to know the mail is not phishing.
 */
export interface PasswordResetEmailPayload {
  /** The user resetting, as a 24-hex string. Delivery is recorded against them. */
  userId: string;
  /** Agency the user belongs to, as a 24-hex string. */
  agencyId: string;
  /** Null when the user is not pinned to a branch. */
  branchId: string | null;
  /** Where the link is going. Already lowercased by the caller. */
  to: string;
  /** Recipient's display name, or null when both name fields are blank. */
  recipientName: string | null;
  /** Agency that triggered it, for the "an administrator at X" line. */
  agencyName: string;
  /** Absolute reset URL, built from `APP_BASE_URL`. */
  resetUrl: string;
  /** When the link stops working. Hours away, so render the time as well. */
  expiresAt: Date;
}
