import {
  loadContactDetails,
  type ContactDetails,
  type ContactFinder,
} from '../contacts/contact-details';

/**
 * Which of a household's contacts is *the* primary.
 *
 * Three things claim to answer this and none of them alone does:
 *
 * - `household.primaryContactId` — the authoritative ref, set by lead intake on
 *   create. Migrated households have none: the SmartSuite import writes neither
 *   it nor `primaryContactName` (see `migrateHouseholds`).
 * - `contact.isPrimary` — copied from a SmartSuite checkbox by the migration,
 *   so it is unset on plenty of migrated rosters and, where legacy intake wrote
 *   it, set on *every* contact in the household (`resolve-contact.step.ts`).
 * - roster order — meaningless on its own.
 *
 * So: the ref wins, the flag is the fallback, and the caller decides what to do
 * with `null`. `LeadDetailService.findPrimaryContact` applies the same order
 * with the lead's own ref ahead of the household's.
 *
 * Ids are compared as strings so an ObjectId, a lean `_id`, and a serialized id
 * all match each other.
 */

/** An ObjectId, a lean `_id`, or an already-serialized id string. */
type IdLike = { toString(): string };

export interface PrimaryContactCandidate {
  _id: IdLike;
  isPrimary?: boolean;
}

export function pickPrimaryContact<T extends PrimaryContactCandidate>(
  contacts: T[],
  primaryContactId: IdLike | null | undefined,
): T | null {
  const preferred = primaryContactId ? String(primaryContactId) : null;
  if (preferred) {
    const match = contacts.find((contact) => String(contact._id) === preferred);
    if (match) return match;
  }

  // Not `filter(...).length === 1`: a household where legacy flagged everyone
  // still has to name someone, and the roster arrives primary-first by
  // `lastName`, so this is at least stable across reads rather than arbitrary.
  return contacts.find((contact) => contact.isPrimary) ?? null;
}

/**
 * Resolve several households' primary contacts in **one** query, keyed by
 * household id.
 *
 * The household stopped carrying `primaryContactName` / `primaryEmails` /
 * `primaryPhones` (PAC-91 §1, §4), so every reader that rendered those now has
 * to follow `primaryContactId`. Batched deliberately: the call sites are list
 * builders (the policies list, the legacy-ticket import), and one lookup per
 * row is how an import that ran two queries starts running two thousand.
 *
 * Households with no `primaryContactId` are simply absent from the map — the
 * caller's `??` chain falls through to the household's own name, exactly as it
 * did when the stored copy was empty.
 */
export async function loadPrimaryContacts(
  contacts: ContactFinder,
  households: ReadonlyArray<{ _id: IdLike; primaryContactId?: IdLike | null }>,
  extraFilter: Record<string, unknown> = {},
): Promise<Map<string, ContactDetails>> {
  const byContactId = await loadContactDetails(
    contacts,
    households.map((household) => household.primaryContactId),
    extraFilter,
  );

  const out = new Map<string, ContactDetails>();
  for (const household of households) {
    if (!household.primaryContactId) continue;
    const details = byContactId.get(String(household.primaryContactId));
    if (details) out.set(String(household._id), details);
  }
  return out;
}
