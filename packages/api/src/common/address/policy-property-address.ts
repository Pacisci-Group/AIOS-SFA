/**
 * "A property policy needs an address to insure" — applied **per policy row**
 * (PAC-56 #14).
 *
 * The rule used to sit on the submission: one `propertyAddress` plus one
 * `sameAsHousehold` toggle for a whole lead or a whole quote recap. That cannot
 * describe a household with a home policy *and* a landlord policy on a rental,
 * which is exactly the case David raised — so the address moved onto the row
 * that needs it, and this rule moved with it.
 *
 * Shared by `create-lead.dto.ts` and `create-quote-recap.dto.ts` so the two
 * forms cannot drift apart, and mirrored on the web side by
 * `packages/web/src/lib/property-address-rule.ts`.
 */

import { isPropertyPolicyType } from '@sfa/shared';
import { z } from 'zod';
import { normalizeStoredAddress } from './household-address';
import type { StructuredAddress } from './household-address';

/** The four parts of an address, in the order the forms render them. */
export const ADDRESS_FIELDS = ['street', 'city', 'state', 'zip'] as const;

/**
 * The slice of a policy row this module reads.
 *
 * The address is spelled out field by field rather than as a
 * `Record<string, string | undefined>`: the wire types in `@sfa/shared` are
 * plain interfaces with no index signature, so a `Record` parameter would
 * reject every one of them at the call site.
 */
export interface PolicyAddressRow {
  policyType: string;
  sameAsHousehold?: boolean;
  propertyAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

/**
 * The address block every policy row carries, ready to spread into a row
 * schema.
 *
 * `sameAsHousehold` defaults to **true** so a client that sends neither field
 * for a property row gets the sane answer — the household's own address —
 * rather than a dwelling policy with no address at all.
 */
export const policyAddressFields = {
  sameAsHousehold: z.boolean().default(true),
  propertyAddress: z
    .object({
      street: z.string().trim().max(200),
      city: z.string().trim().max(120),
      state: z.string().trim().max(60),
      zip: z.string().trim().max(20),
    })
    .optional(),
};

/**
 * Row-level refinement: a property row that opts out of "same as household"
 * must supply a complete address.
 *
 * Nothing is required while `sameAsHousehold` is set — the server copies the
 * household's own address and discards whatever the client sent, so there is
 * nothing to validate. Issue paths are relative to the row; zod prefixes them
 * with the array index, so the client gets
 * `policies.1.propertyAddress.street`.
 */
export function requirePolicyPropertyAddress(
  row: PolicyAddressRow,
  ctx: z.RefinementCtx,
): void {
  if (!isPropertyPolicyType(row.policyType)) return;
  if (row.sameAsHousehold !== false) return;

  for (const field of ADDRESS_FIELDS) {
    if (!row.propertyAddress?.[field]?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['propertyAddress', field],
        message: 'Required when a property policy has its own address',
      });
    }
  }
}

/**
 * The address to persist on one row, with "same as household" already applied.
 *
 * Resolving on write rather than persisting the intent alone means nothing
 * downstream has to remember the rule — and a row claiming "same as household"
 * cannot smuggle in a different address, because its own `propertyAddress` is
 * discarded rather than merged.
 *
 * `undefined` for a non-property row: `sameAsHousehold` defaults to true, so
 * without that guard an Auto-only submission would silently acquire a copy of
 * the living address and Lead Detail would show a property nobody asked about.
 */
export function resolvePolicyPropertyAddress(
  row: PolicyAddressRow,
  householdAddress: StructuredAddress | null,
): StructuredAddress | undefined {
  if (!isPropertyPolicyType(row.policyType)) return undefined;
  if (row.sameAsHousehold !== false) return householdAddress ?? undefined;
  // Through the same coercion as every stored address, which also drops a row
  // whose every part is blank rather than persisting four empty strings.
  return normalizeStoredAddress(row.propertyAddress) ?? undefined;
}
