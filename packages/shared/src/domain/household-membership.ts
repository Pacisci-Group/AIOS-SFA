import type { StructuredAddress } from './address';

/**
 * Household membership wire contracts (PAC-91 §5).
 *
 * Membership is many-to-many: a contact can belong to several households, and
 * is the primary contact of at most one. The two consequences the web app has
 * to know about are here.
 */

/**
 * `code` on the 409 lead intake returns when the submitter belongs to several
 * households and named none of them.
 *
 * A code rather than message-matching: the message is written for a human and
 * will be reworded, and a client that branched on its text would break silently
 * when it was.
 */
export const AMBIGUOUS_HOUSEHOLD_CODE = 'ambiguous_household';

/** One option in that 409's chooser — enough to tell two households apart. */
export interface AmbiguousHouseholdCandidate {
  id: string;
  /** `HH-2614`, or null for a household migrated before refs existed. */
  reference: string | null;
  name: string | null;
  /** Already coerced by the API; the three stored shapes never reach a client. */
  address: StructuredAddress | null;
}

/** The 409 body itself, so the form can narrow on it rather than on a string. */
export interface AmbiguousHouseholdError {
  statusCode: 409;
  error: 'Conflict';
  code: typeof AMBIGUOUS_HOUSEHOLD_CODE;
  message: string;
  contactId: string;
  households: AmbiguousHouseholdCandidate[];
}
