// `directConnection=true` (never with `replicaSet=`) so the driver keeps a
// Single topology and doesn't rewrite `localhost` to the replica-set member's
// advertised host (`mongo:27017`), which is unresolvable outside the compose
// network. The set still reports a primary, so transactions work.
process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI ??
  'mongodb://localhost:27017/sfa_test?directConnection=true';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-jwt-access-secret';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-jwt-refresh-secret';
process.env.JWT_ACCESS_EXPIRES = '15m';
process.env.JWT_REFRESH_EXPIRES = '7d';

// Invites (PAC-58). Pinned so the "inviteUrl is absolute" assertion has a known
// origin to compare against rather than depending on the developer's `.env`.
process.env.APP_BASE_URL = 'http://localhost:5173';

// White labelling. `HostTenantGuard` binds a session to the hostname it was
// created on, and `AuthService` refuses to mint one on a host that resolves to
// no tenant. Supertest talks to the in-process server as `127.0.0.1:<port>`,
// which is not the platform host derived from `APP_BASE_URL` above — so without
// this every `login()` in the suite returns 401 and effectively the whole e2e
// run fails on the first `beforeAll`. Pinning the platform host to the address
// supertest actually uses is what puts the suite back on the platform-host
// path, which is where it was written to run.
process.env.PLATFORM_HOST = '127.0.0.1';

// The cooldown is *exercised* by the suite (immediate resend → 409), which
// clears `inviteLastSentAt` directly in Mongo to reach the success path so no
// test has to sleep. It therefore needs a non-zero value, and it needs one that
// does not depend on the developer's `.env`.
//
// This used to be left at its default on the assumption that nothing would set
// it. That assumption is wrong in exactly the case you would expect: setting
// `INVITE_RESEND_COOLDOWN_SECONDS=0` locally is a *reasonable* thing to do — it
// is what makes hammering the resend button while testing bearable — and it
// silently turned the 409 assertion into a 201. Pinned for the same reason
// `APP_BASE_URL` above is.
process.env.INVITE_RESEND_COOLDOWN_SECONDS = '60';

// Password reset (PAC-79). Both pinned for exactly the reason
// `INVITE_RESEND_COOLDOWN_SECONDS` above is: the suite *exercises* the cooldown
// (immediate second reset -> 409, then clears `passwordResetLastSentAt` in Mongo
// to reach the success path), so a developer's local `0` would silently turn
// that assertion into a 201. The expiry is pinned so the "expired token" test
// can reason about a known window rather than the developer's `.env`.
process.env.PASSWORD_RESET_COOLDOWN_SECONDS = '60';
process.env.PASSWORD_RESET_EXPIRY_HOURS = '24';

// Throttler storage is in-memory and process-wide, so a tight public-intake
// limit would bleed 429s into unrelated describe blocks. Raise the limits for
// the suite; the rate-limit block spins up its own app with tight values.
process.env.RATE_LIMIT_SHORT = process.env.RATE_LIMIT_SHORT ?? '100000';
process.env.RATE_LIMIT_LONG = process.env.RATE_LIMIT_LONG ?? '100000';
process.env.PUBLIC_FORM_RATE_LIMIT =
  process.env.PUBLIC_FORM_RATE_LIMIT ?? '100000';
process.env.PUBLIC_INTAKE_RATE_LIMIT =
  process.env.PUBLIC_INTAKE_RATE_LIMIT ?? '100000';
process.env.PUBLIC_INTAKE_HOURLY_LIMIT =
  process.env.PUBLIC_INTAKE_HOURLY_LIMIT ?? '100000';

// Same reasoning for the PAC-60 address limits. The per-link daily cap is
// raised too: it is counted on the ShareLink document rather than in the
// throttler, so it would otherwise persist across an entire suite's requests.
process.env.PUBLIC_ADDRESS_RATE_LIMIT =
  process.env.PUBLIC_ADDRESS_RATE_LIMIT ?? '100000';
process.env.PUBLIC_ADDRESS_HOURLY_LIMIT =
  process.env.PUBLIC_ADDRESS_HOURLY_LIMIT ?? '100000';
process.env.PUBLIC_ADDRESS_LINK_DAILY_LIMIT =
  process.env.PUBLIC_ADDRESS_LINK_DAILY_LIMIT ?? '100000';
process.env.ADDRESS_LOOKUP_RATE_LIMIT =
  process.env.ADDRESS_LOOKUP_RATE_LIMIT ?? '100000';
process.env.PASSWORD_RESET_ISSUE_RATE_LIMIT =
  process.env.PASSWORD_RESET_ISSUE_RATE_LIMIT ?? '100000';
process.env.PASSWORD_RESET_PREVIEW_RATE_LIMIT =
  process.env.PASSWORD_RESET_PREVIEW_RATE_LIMIT ?? '100000';
process.env.PASSWORD_RESET_SUBMIT_RATE_LIMIT =
  process.env.PASSWORD_RESET_SUBMIT_RATE_LIMIT ?? '100000';
// PAC-81: the self-service forgot-password windows and the change-password
// limit, raised for the same in-memory-throttler reason as everything above.
process.env.PASSWORD_RESET_REQUEST_RATE_LIMIT =
  process.env.PASSWORD_RESET_REQUEST_RATE_LIMIT ?? '100000';
process.env.PASSWORD_RESET_REQUEST_HOURLY_LIMIT =
  process.env.PASSWORD_RESET_REQUEST_HOURLY_LIMIT ?? '100000';
process.env.CHANGE_PASSWORD_RATE_LIMIT =
  process.env.CHANGE_PASSWORD_RATE_LIMIT ?? '100000';

// Address autocomplete (PAC-60). The suite asserts the *unconfigured* behaviour
// — `{ available: false }` and a 200 rather than a 5xx — so a developer with a
// real key in `.env` would otherwise have these tests call Google for real and
// fail on the response shape. Same trap as `INVITE_RESEND_COOLDOWN_SECONDS`
// above, and pinned for the same reason: the assumption that nothing sets it is
// wrong in exactly the case you would expect, since having a working key
// locally is the normal state for anyone who has touched this feature.
//
// Set to empty rather than `delete`d: ConfigModule runs dotenv when the app
// boots, and dotenv only skips keys already present in `process.env`. Deleting
// it hands `.env` the chance to put the real key back. Empty is falsy, which is
// exactly what "unconfigured" means to the address service.
process.env.GOOGLE_MAPS_API_KEY = '';
