import type {
  LeadDetailPolicy,
  PolicyStatus,
  PolicySummary,
  PolicyType,
  UpdatePolicyInput,
} from "@sfa/shared";
import {
  IMPLIED_ITEM_COUNT,
  POLICY_STATUSES,
  POLICY_TYPES,
  isCanonicalPolicyType,
  normalizePolicyStatus,
  policyTypeHasItemCount,
} from "@sfa/shared";
import { z } from "zod";
import { numericString } from "@/lib/zod-helpers";

/**
 * The policy edit form, shared by the Lead Detail Sold card (PAC-56 #27) and the
 * household page's policy card (PAC-126).
 *
 * Lived in `features/lead/components/` until the household page needed the same
 * eight fields against the same DTO. One copy, because the reconciliations below
 * are the easy things to get subtly wrong — `""` versus `null`, which fields are
 * cleared and which are omitted, and the implied item count.
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
  /**
   * A vocabulary, not free text (PAC-126).
   *
   * David asked for staff to *select* the status, and the DTO now rejects
   * anything that does not normalize to a `POLICY_STATUSES` label. `""` carries
   * the same meaning it does for `policyType` — "whatever is stored is not one
   * of these, leave it alone" — which is what keeps the ~thousands of migrated
   * policies holding the uncatalogued codes `1943j` / `4krtk` editable on their
   * other fields instead of 400-ing the whole save.
   */
  status: z.union([z.enum(POLICY_STATUSES), z.literal("")]),
});

export type PolicyFormValues = z.infer<typeof policyFormSchema>;

/**
 * Seed the form from the Sold card's policy.
 *
 * An unrecognised stored type or status seeds as `""` — the select shows its
 * placeholder and the patch omits the field. See the schema for why there is no
 * fallback canonical value.
 *
 * Dates arrive as `YYYY-MM-DD`, which is exactly what `<input type="date">`
 * wants — no parsing on either side.
 */
export function toPolicyFormValues(policy: LeadDetailPolicy): PolicyFormValues {
  return {
    policyNumber: policy.policyNumber ?? "",
    policyType: canonicalTypeOrBlank(policy.policyType),
    carrier: policy.carrier ?? "",
    premium: policy.premium ? String(policy.premium) : "",
    items: policy.items ? String(policy.items) : "",
    effectiveDate: policy.effectiveDate ?? "",
    expirationDate: policy.expirationDate ?? "",
    status: canonicalStatusOrBlank(policy.status),
  };
}

/**
 * Seed the form from a household's policy (PAC-126).
 *
 * Same fields, one difference that matters: `PolicySummary` carries **full ISO
 * instants** where `LeadDetailPolicy` carries `YYYY-MM-DD`. `<input type="date">`
 * accepts only the latter, so the date half is truncated here. Truncating in UTC
 * is not a detail to get creative about — it is the same cut the API makes on
 * the way out (`policyDate` in `policy-view.ts`), so a date survives the round
 * trip instead of drifting a day per save in a negative-offset timezone.
 *
 * `renewalDate` is deliberately absent: it is derived from the effective date
 * and the policy type, the API refuses it from a client, and re-deriving it is
 * what this form's effective-date field is *for*.
 */
export function toPolicyFormValuesFromSummary(
  policy: PolicySummary,
): PolicyFormValues {
  return {
    policyNumber: policy.policyNumber ?? "",
    policyType: canonicalTypeOrBlank(policy.policyType),
    carrier: policy.carrier ?? "",
    premium: policy.premium ? String(policy.premium) : "",
    items: policy.items ? String(policy.items) : "",
    effectiveDate: toDateInput(policy.effectiveDate),
    expirationDate: toDateInput(policy.expirationDate),
    status: canonicalStatusOrBlank(policy.policyStatus),
  };
}

/** An ISO instant → what `<input type="date">` accepts. */
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function canonicalTypeOrBlank(value: string | null): PolicyType | "" {
  return POLICY_TYPES.includes(value as PolicyType) ? (value as PolicyType) : "";
}

/**
 * A stored status → the select's value.
 *
 * Normalized first, so a migrated row holding the code `QsrnM` seeds as
 * `'Active'` and can be saved back as a real label rather than reading as
 * unrecognised. Genuinely uncatalogued values still fall to `""`.
 */
function canonicalStatusOrBlank(value: string | null): PolicyStatus | "" {
  const normalized = normalizePolicyStatus(value);
  return POLICY_STATUSES.includes(normalized as PolicyStatus)
    ? (normalized as PolicyStatus)
    : "";
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
 *
 * `policyType` and `status` are omitted when blank for a different reason: `""`
 * on those two means "the stored value is not in the vocabulary", not "clear
 * it". Sending `null` would wipe a migrated policy's status because the form
 * could not name it, and the API would reject the raw code if we sent it back —
 * so the only correct move is to say nothing about the field at all.
 *
 * `items` is the exception to that "omitted when blank" rule, in one direction:
 * a policy type nobody is asked to count has an item count of exactly 1, so
 * the patch **states** it rather than leaving whatever the row happened to
 * carry. That is what lets correcting a Home policy's type also correct the
 * stale count the old form collected for it. An unrecognised type (`""`) is
 * left alone — see the dialog, which keeps the field visible for it.
 */
export function toUpdatePolicyInput(
  values: PolicyFormValues,
): UpdatePolicyInput {
  const input: UpdatePolicyInput = {
    policyNumber: orNull(values.policyNumber),
    carrier: orNull(values.carrier),
    effectiveDate: orNull(values.effectiveDate),
    expirationDate: orNull(values.expirationDate),
  };

  // Omitted, not cleared: the API has no "unset the policy type", and a
  // migrated policy whose type never normalized should keep it.
  if (values.policyType) input.policyType = values.policyType;
  if (values.status) input.status = values.status;
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
