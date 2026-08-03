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
