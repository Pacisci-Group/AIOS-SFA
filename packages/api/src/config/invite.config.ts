/**
 * Employee-invite tuning (PAC-58).
 *
 * Read through `ConfigService` at call time (not at import time like
 * `rate-limit.config.ts`, which has to be a module constant because `@Throttle`
 * evaluates when the class is defined), so these DO work from the repo `.env`.
 */

/** Default invite lifetime. PAC-58 open question 3 — 7 days, now overridable. */
export const DEFAULT_INVITE_EXPIRY_DAYS = 7;

/**
 * Minimum gap between two resends of the same invite.
 *
 * Per **user**, not per IP. The global throttler already caps request volume
 * from one address, but an owner clicking "Resend" repeatedly is a single
 * legitimate caller doing something that lands in someone else's inbox, so the
 * limit has to key on the invitee.
 */
export const DEFAULT_INVITE_RESEND_COOLDOWN_SECONDS = 60;

export function inviteExpiryDays(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_INVITE_EXPIRY_DAYS;
}

export function inviteResendCooldownSeconds(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_INVITE_RESEND_COOLDOWN_SECONDS;
}
