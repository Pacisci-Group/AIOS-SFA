/**
 * Household address normalization.
 *
 * `households.propertyAddress` / `mailingAddress` are `Record<string, unknown>`,
 * and three writers have each used their own key names:
 *
 * | Writer | Keys |
 * |---|---|
 * | Lead intake (`resolve-household.step.ts`) | `street, city, state, zip` |
 * | Demo seed (`demo-seed.service.ts`) | `line1, city, state, zip` |
 * | SmartSuite migration (`asObject`, raw) | `location_address, location_address2, location_city, location_state, location_zip` |
 *
 * Anything reading an address back therefore has to coerce. Doing it here means
 * the web never sees the mess — without it, the Quote Recap form's "Same as
 * Household Address" toggle silently yields four blank fields for every
 * migrated household and a blank street for every demo-seeded one.
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
    street: pick(source, 'street', 'line1', 'location_address'),
    city: pick(source, 'city', 'location_city'),
    state: pick(source, 'state', 'location_state'),
    zip: pick(source, 'zip', 'location_zip'),
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
