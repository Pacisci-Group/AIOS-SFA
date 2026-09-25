/**
 * Address normalization for the shapes that are still untyped.
 *
 * ## History — households are no longer one of them
 *
 * `households.propertyAddress` / `mailingAddress` used to be
 * `Record<string, unknown>`, written with three different key sets:
 *
 * | Writer | Keys |
 * |---|---|
 * | Lead intake | `street, city, state, zip` |
 * | Demo seed | `line1, city, state, zip` |
 * | SmartSuite migration | `location_address, location_address2, location_city, location_state, location_zip` |
 *
 * PAC-101 made them a typed sub-schema (`HouseholdAddress`) and migrated every
 * stored document onto `street/street2/city/state/zip`, because a Mongo query
 * cannot apply a coercion that happens after the fetch — which is why the
 * Clients list's Location column could not be searched. The `line1` and
 * `location_*` aliases are **gone from `pick` below**: after the migration they
 * can only match data the schema is no longer able to produce.
 *
 * ## What this is still for
 *
 * `Lead.address` and `Lead.propertyAddress` are still `@Prop({ type: Object })`
 * carrying `LeadAddress`, and the intake DTO is a plain object too. Those are
 * what `normalizeStoredAddress` reads now.
 *
 * `resolveHouseholdAddress` is unchanged and permanent: it encodes a
 * *precedence* (lead → property → mailing), not a key shape.
 */

// The normalized shape lives in `@sfa/shared` so the wire contracts and this
// coercion agree by construction. Re-exported because every caller of
// `normalizeStoredAddress` wants the type alongside it.
import type { StructuredAddress } from '@sfa/shared';

export type { StructuredAddress };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** First non-empty of the candidate keys. */
function pick(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return '';
}

/**
 * Coerce any stored address shape into one structure.
 *
 * Returns `null` when street, city and zip are all blank — a state-only address
 * is not usable as a property address and should not pre-fill the form.
 */
export function normalizeStoredAddress(raw: unknown): StructuredAddress | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;

  const address: StructuredAddress = {
    street: pick(source, 'street'),
    city: pick(source, 'city'),
    state: pick(source, 'state'),
    zip: pick(source, 'zip'),
  };

  if (!address.street && !address.city && !address.zip) return null;
  return address;
}

/**
 * The household's address, preferring the most specific source available.
 *
 * Lead first: a lead captured through intake carries the address the producer
 * actually typed. Then the household's own property address, then its mailing
 * address as a last resort.
 */
export function resolveHouseholdAddress(
  leadAddress: unknown,
  propertyAddress: unknown,
  mailingAddress: unknown,
): StructuredAddress | null {
  return (
    normalizeStoredAddress(leadAddress) ??
    normalizeStoredAddress(propertyAddress) ??
    normalizeStoredAddress(mailingAddress)
  );
}
