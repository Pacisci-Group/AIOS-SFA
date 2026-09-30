/**
 * Duplicate-key detection, shared rather than re-declared.
 *
 * Lives here because the ticket-number allocator and the renewal materializer
 * both depend on it and now sit in different modules from each other and from
 * `ServiceTicketsService`, where these used to be file-local. It is also the
 * one place the worker can reach: `common/` is outside the feature-directory
 * boundary its eslint rule enforces.
 *
 * ⚠ Five other services still carry their own copy of `isDuplicateKeyError`
 * (`quote-recaps`, `lead-intake`, `lead-tickets`, `share-links`,
 * `run-migrations`). Consolidating those is not this change's business, but
 * this is the file they should collapse into when somebody does.
 */

interface MongoDuplicateKeyError {
  code?: number;
  keyPattern?: Record<string, unknown>;
  message?: string;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (error as MongoDuplicateKeyError)?.code === 11000;
}

/** True when the duplicate was on `ticketNumber` rather than another index. */
export function isTicketNumberClash(error: unknown): boolean {
  const keyPattern = (error as MongoDuplicateKeyError)?.keyPattern;
  if (keyPattern) {
    return Object.keys(keyPattern).includes('ticketNumber');
  }
  return String((error as MongoDuplicateKeyError)?.message ?? '').includes(
    'ticketNumber',
  );
}
