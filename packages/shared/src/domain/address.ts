/**
 * The one structured US address shape used across the wire.
 *
 * Every field is **required**, because this is the post-coercion shape a form
 * pre-fills and a wire contract carries: a caller reading it should not have to
 * re-check four optionals. {@link StoredAddress} is the *storage* counterpart,
 * where each field is genuinely optional.
 *
 * Until PAC-101 this docblock described `households.propertyAddress` as a loose
 * `Record<string, unknown>` written with three different key sets. That is
 * history now — the household stores {@link StoredAddress} — but the coercion
 * in `common/address/household-address.ts` survives for `Lead.address`, which
 * is still an untyped object.
 */
export interface StructuredAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * A US address as **stored**, where every part may legitimately be absent.
 *
 * A household with a city and no street is a real, storable record — a
 * migrated row whose SmartSuite entry was half-filled, or an intake form where
 * the submitter knew the town and not the number. {@link StructuredAddress} is
 * what that becomes once it has been coerced for display.
 *
 * `street2` exists to stop PAC-101 repeating a data loss: the SmartSuite import
 * wrote `location_address2` (apartment and unit lines), and the coercion that
 * read those records dropped it on the floor. Folding it into `street` was the
 * other option and is worse — `addressKey` is `"<street>|<zip>"`, so
 * `"123 main st apt 4|74101"` and `"123 main st|74101"` would become different
 * keys for the same building.
 */
export interface StoredAddress {
  street?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/**
 * What an address form pre-fills `state` with (PAC-56 #3).
 *
 * The agency operates out of Oklahoma, so all but a handful of submissions
 * carry it — defaulting removes a field the average submitter would otherwise
 * have to fill in by hand.
 *
 * **Spelled out, not `OK`.** Legacy SmartSuite stored the full name (see the
 * Property Address sample in `docs/smartsuite-tables/The Leads Table.md`), and
 * migrated households therefore hold `Oklahoma`. A two-letter default would
 * sort new records apart from old ones in exactly the support lookup this is
 * meant to serve. Note the demo seed disagrees — it writes `IL` — so the field
 * is not consistent across all data today; matching *migrated* data is what
 * matters, since that is what a real agency queries against.
 *
 * **Agency-scoped in all but name.** This is tenant data living as a constant:
 * correct for the one agency on the platform, wrong for the second one. When
 * agencies become configurable it moves onto the agency record and reaches the
 * public form through `PublicLeadFormResponse`, which already carries
 * `agencyName` for the same reason. Grep this symbol to find every site.
 */
export const DEFAULT_ADDRESS_STATE = 'Oklahoma';
