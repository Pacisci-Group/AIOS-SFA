import type { StoredAddress } from './address';

/**
 * A household's address book — every address it has held besides the one it
 * lives at now.
 *
 * ## The primary stays where it was
 *
 * The household's **primary** address is still `Household.propertyAddress`,
 * and only that. Every reader in the platform — the Clients list's Location
 * column and its search, `addressKey`, the quote prefill, the data export —
 * already reads it, and none of them has to learn about a list. The book holds
 * the *others*: a previous home, a second home, an address the client gave that
 * is not where they live.
 *
 * Each address lives in exactly one place. Making an entry primary **swaps**
 * it with the current primary, which moves into the book as a previous address
 * rather than being overwritten — the move is what a client who sold their home
 * looks like, and the old address is still the one on the policies they held
 * there. A `primaryAddressId` pointing into the list would have been the other
 * design, and it is the denormalised copy `AGENTS.md` §11 warns about: every
 * reader of `propertyAddress` would then be reading a stale duplicate.
 *
 * The mailing address is not in the book either. It is a separate fact
 * (`Household.mailingAddress`) with its own meaning, and it is shown beside the
 * book, not moved through it.
 */

/** The label a primary address takes when another one replaces it. */
export const PREVIOUS_ADDRESS_LABEL = 'Previous address';

/** How many addresses the book holds besides the primary. */
export const HOUSEHOLD_ADDRESS_BOOK_MAX = 20;

/** Longest label an entry may carry. */
export const HOUSEHOLD_ADDRESS_LABEL_MAX = 40;

/** One address in the book, on the wire. */
export interface HouseholdAddressEntry {
  id: string;
  /** e.g. `Previous address`, `Lake house`. Null when nobody named it. */
  label: string | null;
  address: StoredAddress;
  /** ISO instant the entry joined the book — added, or moved off primary. */
  addedAt: string | null;
}

/**
 * `POST /households/:id/addresses`.
 *
 * Street, city, state and ZIP are required, matching the New Lead form: this
 * is a person typing an address they have in front of them, not a migrated row
 * that arrived half-filled.
 *
 * `makePrimary` moves the current primary into the book as a previous address
 * (see the module note). `label` names the entry when it is *not* made primary;
 * a primary address carries no label.
 */
export interface AddHouseholdAddressInput {
  street: string;
  street2?: string | null;
  city: string;
  state: string;
  zip: string;
  label?: string | null;
  makePrimary: boolean;
}
