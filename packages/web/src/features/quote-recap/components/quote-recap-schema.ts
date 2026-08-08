import type { QuoteRecapPolicyInput } from "@sfa/shared";
import { POLICY_TYPES } from "@sfa/shared";
import { z } from "zod";
import {
  emptyPolicyAddress,
  policyAddressInput,
  policyAddressShape,
  requirePolicyPropertyAddress,
} from "@/lib/property-address-rule";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/quote-recaps-api";
import { numericString } from "@/lib/zod-helpers";

/**
 * One quoted policy, dwelling included (PAC-56 #14).
 *
 * Premium and item count stay **strings** in form state and are converted at
 * the submit boundary ({@link toPolicyInputs}) — see {@link numericString} for
 * why coercion in the schema is the wrong shape here.
 *
 * The `sfaforms` prototype's address fields are bare `z.string()`, so a property
 * policy with a completely blank address validates there;
 * `requirePolicyPropertyAddress` is what does not port that bug.
 */
export const quotedPolicySchema = z
  .object({
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
    ...policyAddressShape,
  })
  .superRefine(requirePolicyPropertyAddress);

export type QuotedPolicyFormValues = z.infer<typeof quotedPolicySchema>;

/**
 * A blank row for a freshly opened drawer.
 *
 * Premium starts empty so the field reads blank rather than pre-seeded with a
 * misleading 0. "Same as household" defaults to whatever the caller can back up
 * — on with an address on file, off without, since a ticked box over four blank
 * disabled fields strands the producer.
 */
export function emptyQuotedPolicy(sameAsHousehold: boolean): QuotedPolicyFormValues {
  return {
    policyType: "Auto",
    premium: "",
    itemCount: "1",
    sameAsHousehold,
    propertyAddress: emptyPolicyAddress(),
  };
}

export const quoteRecapSchema = z.object({
  policies: z
    .array(quotedPolicySchema)
    .min(1, "Add at least one policy")
    .max(12, "At most 12 policies"),
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
});

export type QuoteRecapFormValues = z.infer<typeof quoteRecapSchema>;

/** Form strings → the numeric wire shape, once validation has passed. */
export function toPolicyInputs(
  policies: QuoteRecapFormValues["policies"],
): QuoteRecapPolicyInput[] {
  return policies.map((p) => ({
    policyType: p.policyType,
    premium: Number(p.premium),
    itemCount: Number(p.itemCount),
    sameAsHousehold: p.sameAsHousehold,
    // Dropped for a row that owns no address — see `policyAddressInput`.
    propertyAddress: policyAddressInput(p),
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
 * Blank form state.
 *
 * No seeded policy row: policies are added through the drawer (PAC-56 #15), and
 * an "Auto ×1" the producer never opened would be a row they never confirmed.
 * The schema's `.min(1)` is what insists on one.
 */
export function emptyQuoteRecap(): QuoteRecapFormState {
  return {
    policies: [],
    notes: "",
    quoteDocument: undefined,
  };
}
