import { isPropertyPolicyType, type PolicyType } from "@sfa/shared";
import type { z } from "zod";

/** The four parts of an address, in the order the forms render them. */
export const ADDRESS_FIELDS = ["street", "city", "state", "zip"] as const;

type AddressField = (typeof ADDRESS_FIELDS)[number];

/**
 * The slice of a form's values this rule reads.
 *
 * Deliberately not the policy list: the two forms name that array differently
 * (`policiesOfInterest` on New Lead, `policies` on Quote Recap) and hold
 * different row shapes, so it is supplied by the selector instead.
 */
export interface PropertyAddressRuleValues {
  sameAsHousehold: boolean;
  propertyAddress: Record<AddressField, string>;
}

/**
 * "A property policy needs an address to insure."
 *
 * The same question in both the New Lead form (PAC-56) and the Quote Recap form
 * (PAC-39), and it mirrors the API's own rule — so it lives in one place rather
 * than being kept in step by hand. Nothing is required while `sameAsHousehold`
 * is set: the server copies the household address and discards whatever was
 * sent.
 *
 * The policy types come from a **selector** rather than a fixed key, which is
 * what lets one rule serve two schemas that name their array differently. The
 * selector is checked against the parent's shape, so renaming that array is a
 * compile error here too.
 *
 * @example
 * .superRefine(requirePropertyAddress((v) => v.policies.map((p) => p.policyType)))
 */
export function requirePropertyAddress<T extends PropertyAddressRuleValues>(
  getPolicyTypes: (value: T) => readonly PolicyType[],
) {
  return (value: T, ctx: z.core.$RefinementCtx<T>) => {
    if (value.sameAsHousehold) return;
    if (!getPolicyTypes(value).some(isPropertyPolicyType)) return;

    for (const field of ADDRESS_FIELDS) {
      if (!value.propertyAddress[field]?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["propertyAddress", field],
          message: "Required",
        });
      }
    }
  };
}
