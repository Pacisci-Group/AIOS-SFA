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

/**
 * `GET /auth/password-reset/:token` response — the greeting on the reset page.
 *
 * Same rule as {@link InvitePreview}: every field is something the holder of the
 * emailed link already knows, and anything added must survive the question
 * "would I email this to whoever forwarded the link?".
 *
 * Narrower than the invite preview on purpose — no `roleNames`. This link points
 * at an account that already exists, so the role is not part of introducing
 * anyone to anything, and a forwarded link should not answer "what can this
 * person do?".
 */
export interface PasswordResetPreview {
  /** The address the reset was sent to. Rendered read-only on the form. */
  email: string;
  agencyName: string;
  /** ISO-8601. */
  expiresAt: string;
}
