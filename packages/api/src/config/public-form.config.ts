/**
 * Where the public intake form is served from. Share-link URLs are built as
 * `${PUBLIC_FORM_BASE_URL}/f/lead/{token}`.
 *
 * Read from `process.env` at import time for the same reason as the rate
 * limits: it must be a real environment variable (docker-compose `environment:`
 * or the platform config), not a line in the repo `.env` file.
 */
export const PUBLIC_FORM_BASE_URL = (
  process.env.PUBLIC_FORM_BASE_URL ?? 'http://localhost:5173'
).replace(/\/+$/, '');
