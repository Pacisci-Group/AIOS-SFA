import type { QuoteRecapPolicyInput } from "@sfa/shared";
import { POLICY_TYPES, isPropertyPolicyType } from "@sfa/shared";
import type { DefaultValues } from "react-hook-form";
import { z } from "zod";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/quote-recaps-api";
import { numericString } from "@/lib/zod-helpers";

const ADDRESS_FIELDS = ["street", "city", "state", "zip"] as const;

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
  .superRefine((value, ctx) => {
    // Mirrors the API rule. The prototype's address fields are bare
    // `z.string()`, so a Property policy with a completely blank address
    // validates there — that bug is not ported.
    if (value.sameAsHousehold) return;
    if (!value.policies.some((p) => isPropertyPolicyType(p.policyType))) return;

    for (const field of ADDRESS_FIELDS) {
      if (!value.propertyAddress[field]?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["propertyAddress", field],
          message: "Required",
        });
      }
    }
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
  }));
}

/**
 * `DefaultValues<T>` rather than the value type: `quoteDocument` legitimately
 * starts unset. Premium starts blank so the field reads empty rather than
 * pre-seeded with a misleading 0.
 */
export function emptyQuoteRecap(
  sameAsHousehold: boolean,
): DefaultValues<QuoteRecapFormValues> {
  return {
    policies: [{ policyType: "Auto", premium: "", itemCount: "1" }],
    sameAsHousehold,
    propertyAddress: { street: "", city: "", state: "", zip: "" },
    notes: "",
    quoteDocument: undefined,
  };
}
