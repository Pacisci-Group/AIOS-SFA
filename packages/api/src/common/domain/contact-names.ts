/**
 * A contact's display name — `"First Last"`, trimmed, or `null` when there is
 * no name to show so a caller's `??` chain continues.
 *
 * Lives in `common/` rather than `contacts/contact-details.ts` (which
 * re-exports it) so the Data Export engine can use it from the worker, whose
 * import boundary admits `common/` but no feature directory.
 */
export function contactDisplayName(
  contact: {
    firstName?: string | null;
    lastName?: string | null;
  } | null,
): string | null {
  if (!contact) return null;
  return (
    [contact.firstName, contact.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ') || null
  );
}
