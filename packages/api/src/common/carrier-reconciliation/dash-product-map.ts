import { POLICY_TYPES, type PolicyType } from '@sfa/shared';

/**
 * Dash's product names → the app's policy types, so the Sold form an assignee
 * opens from a Dash row arrives with the line already picked (PAC-173 PR 4).
 *
 * The names are the ones the agency's own exports carry (September 2026),
 * which Dash prints in both `Product` and `Product Description`. Motor Club is
 * absent on purpose: it is never a sale (`classify-row.ts`), so no row asking
 * for one is ever recorded as sold.
 *
 * Keys are {@link productKey}s, so `Non-Standard Auto` and `NON STANDARD AUTO`
 * read alike.
 */
const DASH_PRODUCTS: Record<string, PolicyType> = {
  'standard auto': 'Auto',
  'non standard auto': 'Auto',
  'specialty auto': 'Auto - Special',
  homeowners: 'Home',
  renters: 'Renters',
  landlords: 'Landlord',
  'inland marine boatowners': 'Boat Owners',
  'personal umbrella policy': 'Umbrella',
  'valuable items protection': 'Valuable Item Protection',
};

/** A product named exactly as an app policy type (`Condominium`, `Auto - Special`). */
const APP_TYPES = new Map<string, PolicyType>(
  POLICY_TYPES.map((type) => [productKey(type), type]),
);

/**
 * The app policy type a Dash line is, or `null` when neither column names one
 * — the form then asks, rather than guessing a line the producer would have to
 * notice and undo. `product` is read first; `productDescription` is the
 * fallback for an export that leaves it blank.
 */
export function dashProductPolicyType(
  product: string | null | undefined,
  productDescription: string | null | undefined,
): PolicyType | null {
  for (const raw of [product, productDescription]) {
    const key = productKey(raw);
    if (!key) continue;
    const type = DASH_PRODUCTS[key] ?? APP_TYPES.get(key);
    if (type) return type;
  }
  return null;
}

/** Lower-cased, every run of punctuation and space folded to one space. */
function productKey(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
