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
  /**
   * The names the inviter typed, so the wizard's first step arrives filled in
   * rather than asking the invitee to retype what is already on the record
   * (PAC-69). Null when the invite was created without them — the seed and the
   * migration both do.
   *
   * Passes the forwarded-link test: these already appear in the greeting of the
   * email the link came from.
   */
  firstName: string | null;
  lastName: string | null;
  /**
   * Whether accepting this invite leads into the agency's own first-run setup —
   * true only for the owner of a freshly onboarded agency (PAC-69).
   *
   * Here rather than discovered after sign-in so the wizard can show a correct
   * step count from the first screen: "Step 1 of 5", not "Step 1 of 2" followed
   * by three more steps appearing.
   */
  agencySetupPending: boolean;
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
