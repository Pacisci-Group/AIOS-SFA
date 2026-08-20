import type { LeadDetailPolicy, PolicyType, UpdatePolicyInput } from "@sfa/shared";
import {
  IMPLIED_ITEM_COUNT,
  POLICY_TYPES,
  isCanonicalPolicyType,
  policyTypeHasItemCount,
} from "@sfa/shared";
import { z } from "zod";
import { numericString } from "@/lib/zod-helpers";

/**
 * The Sold card's "edit policy" form (PAC-56 #27).
 *
 * Mirrors `policies/dto/update-policy.dto.ts` but accepts `""` where the API
 * accepts `null`: an empty text input is how a producer says "remove this", and
 * a text field cannot express `null`. The two are reconciled in
 * {@link toUpdatePolicyInput} at the submit boundary.
 *
 * Nothing is required. Every field on a migrated policy can legitimately be
 * blank, and demanding a carrier in order to fix a typo'd policy number would
 * force invented data — the same reasoning as `contact-schema.ts`.
 */
export const policyFormSchema = z.object({
  policyNumber: z.string().trim().max(60, "Too long"),
  /**
   * Canonical labels only, matching the DTO — plus `""`.
   *
   * `POLICY_TYPES` has no "Other" or "Unknown", and a migrated policy can hold
   * a value that doesn't normalize to any of them. `""` is how the form says
   * "leave whatever is stored alone"; picking an arbitrary canonical type to
   * seed with would rewrite the record on the first unrelated save.
   */
  policyType: z.union([z.enum(POLICY_TYPES), z.literal("")]),
  carrier: z.string().trim().max(120, "Too long"),
  /**
   * Strings, not numbers — see `numericString`. Both are optional here, so
   * `""` is allowed through and dropped from the patch rather than sent as 0.
   */
  premium: z.union([
    numericString({
      required: "Enter a premium",
      min: 0,
      max: 1_000_000,
      tooSmall: "Cannot be negative",
      tooLarge: "That looks too high",
    }),
    z.literal(""),
  ]),
  items: z.union([
    numericString({
      required: "Enter a count",
      min: 0,
      max: 100,
      tooSmall: "Cannot be negative",
      tooLarge: "That looks too high",
      integer: "Whole numbers only",
    }),
    z.literal(""),
  ]),
  effectiveDate: z.union([
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    z.literal(""),
  ]),
  expirationDate: z.union([
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    z.literal(""),
  ]),
  status: z.string().trim().max(60, "Too long"),
});

export type PolicyFormValues = z.infer<typeof policyFormSchema>;

/**
 * Seed the form from a policy.
 *
 * An unrecognised stored type seeds as `""` — the select shows its placeholder
 * and the patch omits the field. See the schema for why there is no fallback
 * canonical value.
 *
 * Dates arrive as `YYYY-MM-DD`, which is exactly what `<input type="date">`
 * wants — no parsing on either side.
 */
export function toPolicyFormValues(policy: LeadDetailPolicy): PolicyFormValues {
  const policyType = POLICY_TYPES.includes(policy.policyType as PolicyType)
    ? (policy.policyType as PolicyType)
    : "";

  return {
    policyNumber: policy.policyNumber ?? "",
    policyType,
    carrier: policy.carrier ?? "",
    premium: policy.premium ? String(policy.premium) : "",
    items: policy.items ? String(policy.items) : "",
    effectiveDate: policy.effectiveDate ?? "",
    expirationDate: policy.expirationDate ?? "",
    status: policy.status ?? "",
  };
}

/** `""` → `null`, the API's "clear this field" signal. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Form values → patch.
 *
 * `premium` and `items` are **omitted** when blank rather than sent as 0: the
 * API has no way to clear a number (they default to 0 on the schema), and
 * sending 0 for an untouched field would overwrite a real premium with nothing.
 * Every other field is clearable, so `""` becomes an explicit `null`.
 *
 * `items` is the exception to that "omitted when blank" rule, in one direction:
 * a policy type nobody is asked to count has an item count of exactly 1, so
 * the patch **states** it rather than leaving whatever the row happened to
 * carry. That is what lets correcting a Home policy's type also correct the
 * stale count the old form collected for it. An unrecognised type (`""`) is
 * left alone — see `EditPolicyDialog`, which keeps the field visible for it.
 */
export function toUpdatePolicyInput(
  values: PolicyFormValues,
): UpdatePolicyInput {
  const input: UpdatePolicyInput = {
    policyNumber: orNull(values.policyNumber),
    carrier: orNull(values.carrier),
    effectiveDate: orNull(values.effectiveDate),
    expirationDate: orNull(values.expirationDate),
    status: orNull(values.status),
  };

  // Omitted, not cleared: the API has no "unset the policy type", and a
  // migrated policy whose type never normalized should keep it.
  if (values.policyType) input.policyType = values.policyType;
  if (values.premium.trim()) input.premium = Number(values.premium);

  if (
    isCanonicalPolicyType(values.policyType) &&
    !policyTypeHasItemCount(values.policyType)
  ) {
    input.items = IMPLIED_ITEM_COUNT;
  } else if (values.items.trim()) {
    input.items = Number(values.items);
  }

  return input;
}
