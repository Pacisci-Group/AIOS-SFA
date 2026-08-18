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
//
// The resend cooldown is deliberately left at its default: the suite exercises
// it for real (immediate resend → 409) and then clears `inviteLastSentAt`
// directly in Mongo to test the success path, so no test has to sleep.
process.env.APP_BASE_URL = 'http://localhost:5173';

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
