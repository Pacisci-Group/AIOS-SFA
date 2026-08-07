/** The four parts of an address, in the order every form renders them. */
export const ADDRESS_FIELDS = ["street", "city", "state", "zip"] as const;

export type AddressField = (typeof ADDRESS_FIELDS)[number];

/**
 * Loose on purpose: the API's `StructuredAddress` has four required strings,
 * form state holds the same four, and a stored address may be missing any of
 * them. One formatter serves all three.
 */
export type AddressLike = Partial<Record<AddressField, string>>;

/**
 * `4821 Maple Grove Dr, Austin TX 78745`, skipping whatever is missing.
 *
 * Returns **`null`** rather than an em-dash when there is nothing to show, so a
 * caller can choose between rendering a placeholder (`?? "—"`) and omitting the
 * row entirely — the per-policy address lists do the latter, since a permanent
 * dash beside a non-property policy reads as missing data rather than as a
 * question that was never asked.
 */
export function formatAddress(address: AddressLike | null | undefined): string | null {
  if (!address) return null;
  const cityLine = [address.city, address.state, address.zip]
    .filter(Boolean)
    .join(" ");
  const line = [address.street, cityLine].filter(Boolean).join(", ");
  return line || null;
}
