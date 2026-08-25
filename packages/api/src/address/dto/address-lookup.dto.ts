import { z } from 'zod';

/**
 * Request shapes for the address proxy (PAC-60).
 *
 * ## Why both are POST, including autocomplete
 *
 * A partially-typed home address in a query string lands in the API access log,
 * in every proxy along the path, and in whatever aggregates them. The body
 * keeps it out of all three. Google's own autocomplete endpoint is POST for
 * unrelated reasons; this one is POST for that one.
 */

/**
 * Opaque per-session identifier minted by the browser.
 *
 * Bounded rather than pattern-matched: Google accepts any string it has not
 * seen expire, we generate UUIDs, and pinning the format here would break the
 * day the client's fallback generator (non-secure contexts have no
 * `crypto.randomUUID`) emits something else. The bounds exist so an unbounded
 * string cannot be smuggled into an outbound URL.
 */
const sessionToken = z.string().trim().min(8).max(64);

export const addressAutocompleteSchema = z.object({
  /*
   * Three characters is where predictions start being worth a billed request —
   * a one- or two-letter fragment returns everything and helps nobody. The
   * client debounces as well; this is the backstop.
   */
  input: z.string().trim().min(3, 'Too short').max(200, 'Too long'),
  sessionToken,
});

export const addressResolveSchema = z.object({
  placeId: z.string().trim().min(1, 'Required').max(300, 'Too long'),
  sessionToken,
});

export type AddressAutocompleteDto = z.infer<typeof addressAutocompleteSchema>;
export type AddressResolveDto = z.infer<typeof addressResolveSchema>;
