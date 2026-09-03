/**
 * Human-readable record references (PAC-56 #7).
 *
 * `HH-2614` — the identifier a producer reads down the phone and a support rep
 * pastes into a search box. Legacy had one for free: SmartSuite titled every
 * household record `#HH2614` and the app passed it straight through as
 * `householdTitle`. Our migration dropped it (the household field map carried no
 * `title` entry, though the policies map carried its equivalent), and the first
 * replacement here derived a label from the ObjectId's trailing hex instead.
 *
 * That derived label was not safe. The last 6 hex characters of an ObjectId are
 * its 3-byte counter, seeded randomly **per process** — records minted by one
 * process run sequentially and never collide, but each API instance, migration
 * run and seed draws its own starting point, so across those groups it is a
 * birthday problem over 16^6. At ~2,600 households that is roughly a 20% chance
 * some pair already shares a label.
 *
 * So the reference is now **stored and allocated**, not derived:
 * `Household.householdRef`, taken from a per-agency sequence in the `counters`
 * collection. Migrated households keep the number they already had (legacy
 * `#HH2614` -> `HH-2614`), and the sequence continues above the highest one
 * imported, so the series looks unbroken to the agency.
 *
 * Because it is unique per agency it is a genuine lookup key, not merely a
 * display string — which is the point, since the Lead Detail card's copy button
 * exists so that someone can find the record again.
 *
 * Two deliberate departures from the legacy format: no `#` (that was
 * SmartSuite's own prefix convention, and it reads as noise), and no
 * zero-padding, so the sequence renders `HH-1` .. `HH-2614` rather than
 * `HH-0001`.
 */

/** Distinguishes a household reference from other record types at a glance. */
export const HOUSEHOLD_REFERENCE_PREFIX = 'HH';

/**
 * Accepts every shape the number has been written in: the legacy SmartSuite
 * title (`#HH2614`), our own format (`HH-2614`), and the unseparated middle
 * ground, in any case, with or without zero padding.
 */
const HOUSEHOLD_REFERENCE_PATTERN = /^#?HH-?0*(\d+)$/i;

/**
 * `HH-2614` from a sequence number.
 *
 * Throws rather than coercing: every caller gets its argument from a counter, so
 * a non-positive or fractional value means the counter is broken, and writing
 * `HH-0` or `HH-NaN` into a unique index would turn that into corrupt data that
 * outlives the bug.
 */
export function formatHouseholdRef(seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new RangeError(
      `Household reference sequence must be a positive integer, received ${seq}`,
    );
  }
  return `${HOUSEHOLD_REFERENCE_PREFIX}-${seq}`;
}

/**
 * The sequence number inside a reference, or `null` if it isn't one.
 *
 * Used on two paths: importing the legacy title, and seeding an agency's counter
 * from the highest reference already in its data. Returning `null` rather than
 * throwing is what lets both treat an unrecognised value as "no number here" and
 * allocate a fresh one, instead of failing the whole run over one odd record.
 */
export function parseHouseholdRef(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const match = HOUSEHOLD_REFERENCE_PATTERN.exec(value.trim());
  if (!match) return null;
  const seq = Number(match[1]);
  return Number.isSafeInteger(seq) && seq >= 1 ? seq : null;
}

/**
 * Legacy service-ticket numbers.
 *
 * SmartSuite titled every ticket `#SFAS-030`, and the agency reads those numbers
 * off printed notes and call logs, so a migrated ticket keeps its number rather
 * than being reallocated under the CRM's per-category prefixes (`ENDR-101`).
 * Same two departures as the household reference: no `#`, no zero padding —
 * `#SFAS-030` becomes `SFAS-30`, next to `HH-30`, not `HH-0030`.
 *
 * The prefix is taken from the title rather than fixed to `SFAS`, so a second
 * agency's `#XYZ-12` imports as `XYZ-12` without a code change.
 */
const LEGACY_TICKET_NUMBER_PATTERN = /^#?([A-Z]+)-?0*(\d+)$/i;

/**
 * `SFAS-30` from a legacy ticket title, or `null` when the title is not a
 * number — a ticket without one cannot be imported, since the CRM requires a
 * number and inventing one would collide with the live allocator.
 */
export function parseLegacyTicketNumber(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const match = LEGACY_TICKET_NUMBER_PATTERN.exec(value.trim());
  if (!match) return null;
  const seq = Number(match[2]);
  if (!Number.isSafeInteger(seq) || seq < 1) return null;
  return `${match[1].toUpperCase()}-${seq}`;
}
