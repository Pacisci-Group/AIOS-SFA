import type { StoredAddress } from '@sfa/shared';

/**
 * `"<street>|<zip>"`, both lowercased and trimmed. Null unless **both** parts
 * are present — a key built from half an address would collapse unrelated
 * records onto one key.
 *
 * (Legacy lowercased the street but only trimmed the zip, so `90210 ` and
 * `90210` produced different keys.)
 *
 * Moved here from `leads/intake/intake.normalize.ts` by PAC-101, which made it
 * a second caller's business: `HouseholdSchema` now stamps `addressKey` in a
 * pre-hook, and a schema reaching into the lead intake pipeline for a pure
 * string function is the wrong direction of dependency. `intake.normalize.ts`
 * re-exports it so existing imports keep working — same arrangement as
 * `policies/policy-number.ts`.
 */
export function buildAddressKey(
  street?: string | null,
  zip?: string | null,
): string | null {
  const s = street?.trim().toLowerCase();
  const z = zip?.trim().toLowerCase();
  return s && z ? `${s}|${z}` : null;
}

/**
 * The same key from a stored address.
 *
 * ⚠ Built from `street`, never `street` + `street2`. Two households in the same
 * building must land on the same key — the index is deliberately non-unique
 * precisely because an apartment block legitimately yields several — and
 * folding the unit line in would split them.
 */
export function householdAddressKey(
  address: StoredAddress | null | undefined,
): string | null {
  return buildAddressKey(address?.street, address?.zip);
}
