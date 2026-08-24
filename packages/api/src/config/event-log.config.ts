/**
 * Event-log tuning.
 *
 * Read through `ConfigService` at call time, exactly like `invite.config.ts` —
 * these are ordinary values from the repo `.env`, not module constants that have
 * to exist before DI runs (see `rate-limit.config.ts` for the case that does).
 */

/**
 * How long a **terminal** event-log row is kept.
 *
 * Only terminal rows carry an `expiresAt`, so this never reaps a row the sweeper
 * still needs — see `event-log.schema.ts`.
 */
export const DEFAULT_EVENT_LOG_RETENTION_DAYS = 30;

/**
 * How long a row may sit `pending` before the sweeper re-emits it.
 *
 * ⚠ This must exceed the longest expected run duration of any function. The log
 * deliberately does not track a `running` state (it would double the write cost
 * for information the terminal write already carries), so a legitimately
 * long-running function is indistinguishable from a lost one. Fifteen minutes is
 * comfortable for email; a future long-running function means raising this.
 */
export const DEFAULT_EVENT_LOG_STALE_MINUTES = 15;

export function eventLogRetentionDays(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EVENT_LOG_RETENTION_DAYS;
}

export function eventLogStaleMinutes(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EVENT_LOG_STALE_MINUTES;
}
