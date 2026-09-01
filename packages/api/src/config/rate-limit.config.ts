/**
 * Rate-limit configuration (PAC-37).
 *
 * The public intake routes are the only unauthenticated write surface in the
 * API, so their limits are env-driven: ops can tighten them without a deploy,
 * and the e2e suite raises them so the in-memory bucket doesn't bleed 429s
 * across unrelated test blocks.
 *
 * Read at import time because `@Throttle(...)` is evaluated when the controller
 * class is defined. `packages/api/test/setup-env.ts` runs first (jest
 * `setupFiles`), so tests can still override them.
 *
 * ⚠ These read `process.env` **directly, not through `ConfigService`**, and that
 * is a real constraint rather than an oversight: module-level constants evaluate
 * when `AppModule` is imported, which is before `ConfigModule.forRoot()` has run
 * dotenv. A value placed in the repo `.env` file would therefore be ignored and
 * silently fall back to the defaults below. Set these as real environment
 * variables — `docker-compose.yml` (`environment:`) and the DigitalOcean App
 * Platform config both do, the same way `STORAGE_*` is handled.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

function limitFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Baseline for authenticated traffic — generous; the per-route limits do the real work. */
export const DEFAULT_SHORT_LIMIT = limitFromEnv('RATE_LIMIT_SHORT', 300);
export const DEFAULT_LONG_LIMIT = limitFromEnv('RATE_LIMIT_LONG', 3_000);

/**
 * `GET /public/lead-form/:token` — deliberately looser than the submit limit.
 * Someone filling in a form on a phone will reload it; locking them out of a
 * page that only renders an agency name protects nothing.
 */
export const PUBLIC_FORM_RATE_LIMIT = limitFromEnv(
  'PUBLIC_FORM_RATE_LIMIT',
  10,
);

/** `POST /public/leads/:token` — per minute, and per hour to catch a slow drip. */
export const PUBLIC_INTAKE_RATE_LIMIT = limitFromEnv(
  'PUBLIC_INTAKE_RATE_LIMIT',
  5,
);
export const PUBLIC_INTAKE_HOURLY_LIMIT = limitFromEnv(
  'PUBLIC_INTAKE_HOURLY_LIMIT',
  30,
);

/**
 * `POST /users/:userId/password-reset` — authenticated, `agency:users:write`.
 *
 * Env-driven rather than a bare literal because onboarding a migrated agency is
 * exactly the burst this would otherwise block: an owner working down a list of
 * fourteen people trips a hard-coded ten and cannot finish. The limit that
 * actually protects an inbox is the per-**user** cooldown in
 * `UsersService.sendPasswordReset`; this one only catches a flood.
 */
export const PASSWORD_RESET_ISSUE_RATE_LIMIT = limitFromEnv(
  'PASSWORD_RESET_ISSUE_RATE_LIMIT',
  60,
);

/**
 * `GET /auth/password-reset/:token` — the public preview behind a reset link
 * (PAC-79). Looser than the submit limit for the same reason the intake form is
 * looser than the intake submit: someone opening a link on a phone may reload
 * it, and locking them out of a page that renders an email address and an
 * expiry protects nothing.
 */
export const PASSWORD_RESET_PREVIEW_RATE_LIMIT = limitFromEnv(
  'PASSWORD_RESET_PREVIEW_RATE_LIMIT',
  10,
);

/**
 * `POST /auth/reset-password` — an unauthenticated write that sets a password,
 * so it gets the tightest public limit in the file. The token is 256 bits, so
 * this is not what stops guessing; it caps the damage from a link leaked to
 * something that will hammer it.
 */
export const PASSWORD_RESET_SUBMIT_RATE_LIMIT = limitFromEnv(
  'PASSWORD_RESET_SUBMIT_RATE_LIMIT',
  5,
);

/**
 * `POST /bug-reports` — filing an in-app bug report, per minute.
 *
 * The only authenticated write in the API that requires **no permission at
 * all**, so this limit is the whole abuse bound rather than a second line of
 * defence. Ten a minute is far above anyone describing a real problem and far
 * below anything that would fill the queue.
 *
 * The presign route gets six times this — five screenshots is five presigns,
 * and someone who picks the wrong file and retries must not be locked out of
 * submitting the report they have already typed.
 */
export const BUG_REPORT_RATE_LIMIT = limitFromEnv('BUG_REPORT_RATE_LIMIT', 10);

/**
 * `POST /address/*` — authenticated address autocomplete (PAC-60).
 *
 * Generous, because unlike the intake limits this one guards a *billed* call
 * behind a login rather than an abuse surface. A 250 ms debounce yields roughly
 * 6–10 requests per address typed, so 120/min is several forms a minute per
 * user; the real spend ceiling is the quota cap on the Google key.
 */
export const ADDRESS_LOOKUP_RATE_LIMIT = limitFromEnv(
  'ADDRESS_LOOKUP_RATE_LIMIT',
  120,
);

/**
 * `POST /public/address/:token/*` — the same lookup on the unauthenticated
 * intake form. Two windows, like the intake limits: the per-minute one stops a
 * burst, the hourly one catches a slow drip that would sit under it all day.
 *
 * Tighter than the authenticated limit because there is no login behind it, but
 * still well above one person typing two addresses — a submitter locked out
 * mid-form is a lost lead, and the feature is only meant to save them typing.
 */
export const PUBLIC_ADDRESS_RATE_LIMIT = limitFromEnv(
  'PUBLIC_ADDRESS_RATE_LIMIT',
  30,
);
export const PUBLIC_ADDRESS_HOURLY_LIMIT = limitFromEnv(
  'PUBLIC_ADDRESS_HOURLY_LIMIT',
  200,
);

/**
 * Address lookups per share link per rolling day.
 *
 * The one limit that catches the attack that actually costs money: a single
 * scraped link driven from many IPs, which per-IP throttling structurally
 * cannot see. Counted on the `ShareLink` document rather than in the throttler.
 *
 * ⚠ Unlike its two neighbours this one is read at *request* time, not baked
 * into decorator metadata — but it is kept here so all four address limits are
 * tuned from one file, and it follows the same real-environment-variable rule
 * for consistency.
 */
export const PUBLIC_ADDRESS_LINK_DAILY_LIMIT = limitFromEnv(
  'PUBLIC_ADDRESS_LINK_DAILY_LIMIT',
  500,
);
