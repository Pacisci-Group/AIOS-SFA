/**
 * Admin-triggered password-reset tuning (PAC-79).
 *
 * Read through `ConfigService` at call time, exactly as `invite.config.ts` is
 * and for the same reason — these work from the repo `.env`, unlike
 * `rate-limit.config.ts`, which must be a module constant because `@Throttle`
 * evaluates when the class is defined.
 */

/**
 * Default reset-link lifetime, in **hours** — not the invite's days.
 *
 * An invite is sent cold to someone who may not be expecting it, so it gets a
 * week. A reset is triggered on demand by an owner who can tell the person it
 * is coming, so the link should not still be a working credential in an inbox
 * days later.
 */
export const DEFAULT_PASSWORD_RESET_EXPIRY_HOURS = 24;

/**
 * Minimum gap between two resets issued for the same user.
 *
 * Per **user**, mirroring {@link DEFAULT_INVITE_RESEND_COOLDOWN_SECONDS}. The
 * global throttler is per-IP: it caps how fast one address can call the API, but
 * an owner clicking the button repeatedly is one legitimate caller filling
 * somebody else's inbox, so the limit has to key on the recipient.
 */
export const DEFAULT_PASSWORD_RESET_COOLDOWN_SECONDS = 60;

export function passwordResetExpiryHours(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PASSWORD_RESET_EXPIRY_HOURS;
}

export function passwordResetCooldownSeconds(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PASSWORD_RESET_COOLDOWN_SECONDS;
}
