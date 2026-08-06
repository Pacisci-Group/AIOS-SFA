import type { QuoteRecapPolicyInput } from "@sfa/shared";
import { POLICY_TYPES } from "@sfa/shared";
import { z } from "zod";
import { requirePropertyAddress } from "@/lib/property-address-rule";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/quote-recaps-api";
import { numericString } from "@/lib/zod-helpers";

/**
 * Premium and item count stay **strings** in form state and are converted at
 * the submit boundary ({@link toPolicyInputs}) — see {@link numericString} for
 * why coercion in the schema is the wrong shape here.
 */
const quotedPolicySchema = z.object({
  policyType: z.enum(POLICY_TYPES),
  premium: numericString({
    required: "Enter a premium",
    min: 0,
    max: 1_000_000,
    tooSmall: "Premium must be 0 or greater",
    tooLarge: "Too large",
  }),
  itemCount: numericString({
    required: "Enter an item count",
    min: 1,
    max: 99,
    tooSmall: "At least 1 item",
    tooLarge: "Too many",
    integer: "Whole numbers only",
  }),
});

export const quoteRecapSchema = z
  .object({
    policies: z
      .array(quotedPolicySchema)
      .min(1, "Add at least one policy")
      .max(12, "At most 12 policies"),
    sameAsHousehold: z.boolean(),
    propertyAddress: z.object({
      street: z.string().trim().max(200, "Too long"),
      city: z.string().trim().max(120, "Too long"),
      state: z.string().trim().max(60, "Too long"),
      zip: z.string().trim().max(20, "Too long"),
    }),
    notes: z.string().trim().max(2000, "Too long").optional(),
    /** Required (PAC-39 decision 4) — no recap without its carrier quote. */
    quoteDocument: z
      .instanceof(File, { message: "Attach the quote document" })
      .refine(
        (f) => (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(f.type),
        "Use a PDF, JPG or PNG",
      )
      .refine(
        (f) => f.size > 0 && f.size <= MAX_UPLOAD_BYTES,
        "File must be under 10MB",
      ),
  })
  // The prototype's address fields are bare `z.string()`, so a Property policy
  // with a completely blank address validates there — that bug is not ported.
  .superRefine(
    requirePropertyAddress((value) => value.policies.map((p) => p.policyType)),
  );

export type QuoteRecapFormValues = z.infer<typeof quoteRecapSchema>;

/** Form strings → the numeric wire shape, once validation has passed. */
export function toPolicyInputs(
  policies: QuoteRecapFormValues["policies"],
): QuoteRecapPolicyInput[] {
  return policies.map((p) => ({
    policyType: p.policyType,
    premium: Number(p.premium),
    itemCount: Number(p.itemCount),
  }));
}

/**
 * What the form **holds while being filled**, as distinct from what is valid on
 * submit: `quoteDocument` legitimately starts unset, while the schema requires
 * it. Only that one field differs, so the gap is stated here rather than
 * loosening every field (which is what react-hook-form's `DefaultValues<T>`
 * did, and why nothing downstream was properly typed).
 *
 * {@link parseQuoteRecap} closes the gap at the submit boundary.
 */
export type QuoteRecapFormState = Omit<QuoteRecapFormValues, "quoteDocument"> & {
  quoteDocument?: File;
};

/**
 * Form state → validated values. Validation has already run by the time this is
 * called, so this is a real check that also narrows `quoteDocument` to present —
 * not a cast pretending it is.
 */
export function parseQuoteRecap(state: QuoteRecapFormState): QuoteRecapFormValues {
  return quoteRecapSchema.parse(state);
}

/**
 * Premium starts blank so the field reads empty rather than pre-seeded with a
 * misleading 0.
 */
export function emptyQuoteRecap(sameAsHousehold: boolean): QuoteRecapFormState {
  return {
    policies: [{ policyType: "Auto", premium: "", itemCount: "1" }],
    sameAsHousehold,
    propertyAddress: { street: "", city: "", state: "", zip: "" },
    notes: "",
    quoteDocument: undefined,
  };
}
