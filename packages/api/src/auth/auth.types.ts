/**
 * `GET /auth/invite/:token` response — the public greeting shown on the
 * accept-invite page.
 *
 * Every field here is something the person holding the emailed link already
 * knows. Keep it that way: this is an unauthenticated endpoint, so anything
 * added must survive the question "would I email this to whoever forwarded the
 * link?".
 */
export interface InvitePreview {
  /** The address the invite was sent to. Rendered read-only on the form. */
  email: string;
  agencyName: string;
  roleNames: string[];
  /** ISO-8601. */
  expiresAt: string;
}
