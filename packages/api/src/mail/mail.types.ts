/**
 * The payload an invite email is rendered from.
 *
 * Deliberately a plain data object with no Mongoose documents in it: whatever
 * transport eventually lands (see {@link MailService}) will hand this to a
 * template, and templates should never be able to reach back into the database.
 */
export interface InviteEmailPayload {
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
