/**
 * Human-readable record references (PAC-56 #7).
 *
 * David asked for the household's unique identifier to be visible on the Lead
 * Detail page, for support and lookup. Legacy had this for free: SmartSuite
 * autonumbers gave every household a short `#001`-style id. Those were lost in
 * the move to Mongo ObjectIds, and the migration never carried one — the
 * household field map (`migration/smartsuite/field-ids.ts`) has no autonumber
 * entry to import.
 *
 * Rather than add a counter collection and backfill every household, the
 * reference is **derived from the ObjectId**: stable, unique in practice, and
 * correct on migrated data the moment it is deployed with no write path at all.
 *
 * ⚠ It is a *display* label, not a lookup key. The last 6 hex characters of an
 * ObjectId are its low counter bytes, so two households can in principle share
 * a reference — rare, but not impossible. Anything that resolves a reference
 * back to a record (a support search, a URL) must use the full id, which is why
 * the Lead Detail card copies the id and only shows the reference.
 *
 * If a genuinely authoritative, speakable number is wanted later, that is a
 * per-agency sequence on the Household schema plus a backfill — a different
 * change, and one to put to David rather than infer.
 */

/** Distinguishes a household reference from other record types at a glance. */
export const HOUSEHOLD_REFERENCE_PREFIX = 'HH';

/** How many trailing id characters the reference carries. */
const REFERENCE_LENGTH = 6;

/**
 * `HH-4F2A9C` for a household ObjectId.
 *
 * Returns an empty string for an empty id so a caller never renders a bare
 * `HH-`. Anything shorter than {@link REFERENCE_LENGTH} is used whole.
 */
export function householdReference(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return '';
  return `${HOUSEHOLD_REFERENCE_PREFIX}-${trimmed
    .slice(-REFERENCE_LENGTH)
    .toUpperCase()}`;
}
