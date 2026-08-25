/**
 * The one structured US address shape used across the wire.
 *
 * Stored addresses are messy — `households.propertyAddress` is a loose
 * `Record<string, unknown>` that three writers have populated with three
 * different key sets (see `common/address/household-address.ts` on the API
 * side, which coerces them). This is the *normalized* shape everything agrees
 * on once that coercion has happened.
 */
export interface StructuredAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
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
