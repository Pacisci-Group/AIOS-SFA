/**
 * Re-export shim. The implementation moved to `@sfa/shared` in PAC-61, because
 * the Mailers drawer normalizes the typed control number client-side too and a
 * second copy of the expression would drift into 404s on valid numbers.
 *
 * Kept as a file rather than rewriting the seven import sites PAC-73 left
 * behind (`mailer-import.ts`, `mailer-row.mapper.ts`, the demo seed, the
 * BigQuery backfill, the e2e specs): they are all correct as written, and the
 * indirection is one line.
 */
export {
  mailerControlNumberKey,
  mailerControlNumberKeys,
  MIN_MAILER_CONTROL_NUMBER_KEY_LENGTH,
} from '@sfa/shared';
