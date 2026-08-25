/**
 * Side-effect module: clamp the public-intake rate limits **before** any
 * application code is imported.
 *
 * Import order matters and this must be the FIRST import of any spec that uses
 * it. `@Throttle(...)` bakes its numbers into route metadata when the controller
 * class is evaluated, and `rate-limit.config.ts` reads `process.env` at module
 * load, so setting these later has no effect at all.
 *
 * Jest gives every test file its own module registry, so a spec importing this
 * gets a freshly-evaluated AppModule with these limits, while
 * `api.e2e-spec.ts` keeps the generous ones from `setup-env.ts`.
 */
export const TIGHT_PUBLIC_FORM_LIMIT = 3;
export const TIGHT_PUBLIC_INTAKE_LIMIT = 2;

process.env.PUBLIC_FORM_RATE_LIMIT = String(TIGHT_PUBLIC_FORM_LIMIT);
process.env.PUBLIC_INTAKE_RATE_LIMIT = String(TIGHT_PUBLIC_INTAKE_LIMIT);
process.env.PUBLIC_INTAKE_HOURLY_LIMIT = '50';

/**
 * Address autocomplete on the public form (PAC-60).
 *
 * The per-minute throttle is left generous while the **per-link daily cap** is
 * clamped, because they guard different things and only one of them is worth
 * asserting here: the throttle is the same `@Throttle` machinery the intake
 * limits above already prove, whereas the per-link cap is bespoke counting on
 * the ShareLink document and is the only defence against one scraped link
 * driven from many IPs.
 */
export const TIGHT_PUBLIC_ADDRESS_LINK_DAILY_LIMIT = 3;

process.env.PUBLIC_ADDRESS_RATE_LIMIT = '100000';
process.env.PUBLIC_ADDRESS_HOURLY_LIMIT = '100000';
process.env.PUBLIC_ADDRESS_LINK_DAILY_LIMIT = String(
  TIGHT_PUBLIC_ADDRESS_LINK_DAILY_LIMIT,
);
