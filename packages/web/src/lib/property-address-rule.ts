import { isPropertyPolicyType, type PolicyType } from "@sfa/shared";
import { z } from "zod";
import { ADDRESS_FIELDS, type AddressField } from "@/lib/format-address";

export { ADDRESS_FIELDS };

/**
 * The address block every policy row carries, ready to spread into a row
 * schema.
 *
 * Both forms declare the same four strings plus the toggle, so they are
 * declared once here — which is also what lets one refinement below validate
 * either form's rows.
 */
export const policyAddressShape = {
  sameAsHousehold: z.boolean(),
  propertyAddress: z.object({
    street: z.string().trim().max(200, "Too long"),
    city: z.string().trim().max(120, "Too long"),
    state: z.string().trim().max(60, "Too long"),
    zip: z.string().trim().max(20, "Too long"),
  }),
};

/** The slice of a policy row the rule below reads. */
export interface PolicyAddressRow {
  policyType: PolicyType;
  sameAsHousehold: boolean;
  propertyAddress: Record<AddressField, string>;
}

/**
 * "A property policy needs an address to insure" — **per row** (PAC-56 #14).
 *
 * The rule used to sit on the whole form: one `propertyAddress` and one
 * `sameAsHousehold` for a New Lead submission or a Quote Recap. That cannot
 * describe a household insuring the home they live in *and* a rental they let
 * out, which is the case this revision exists for — so the address moved onto
 * the policy row, and the rule moved with it.
 *
 * Nothing is required while `sameAsHousehold` is set: the server copies the
 * household address and discards whatever the row sent. Mirrors the API's own
 * `requirePolicyPropertyAddress`, so the two cannot drift.
 *
 * @example
 * const row = z.object({ policyType, itemCount, ...policyAddressShape })
 *   .superRefine(requirePolicyPropertyAddress);
 */
export function requirePolicyPropertyAddress<T extends PolicyAddressRow>(
  row: T,
  ctx: z.core.$RefinementCtx<T>,
): void {
  if (!isPropertyPolicyType(row.policyType)) return;
  if (row.sameAsHousehold) return;

  for (const field of ADDRESS_FIELDS) {
    if (!row.propertyAddress[field]?.trim()) {
      ctx.addIssue({ code: "custom", path: ["propertyAddress", field], message: "Required" });
    }
  }
}

/**
 * The address to send for one row, or `undefined` when the row does not own
 * one.
 *
 * A non-property row has no dwelling, and a "same as household" row has one the
 * server derives for itself — sending four strings it is contractually obliged
 * to discard is noise on the wire and a lie in the request log.
 */
export function policyAddressInput<T extends PolicyAddressRow>(
  row: T,
): Record<AddressField, string> | undefined {
  if (!isPropertyPolicyType(row.policyType)) return undefined;
  if (row.sameAsHousehold) return undefined;
  return row.propertyAddress;
}

/** A blank address, for a freshly opened policy drawer. */
export function emptyPolicyAddress(): Record<AddressField, string> {
  return { street: "", city: "", state: "", zip: "" };
}
