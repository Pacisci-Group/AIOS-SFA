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
