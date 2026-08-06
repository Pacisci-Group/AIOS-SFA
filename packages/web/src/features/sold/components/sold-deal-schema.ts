import type { SoldPolicyInput } from "@sfa/shared";
import { POLICY_TYPES } from "@sfa/shared";
import type { DeepKeys } from "@tanstack/react-form";
import { z } from "zod";
import { numericString } from "@/lib/zod-helpers";

/**
 * Validation for the Sold wizard (PAC-40).
 *
 * ## Why two schemas rather than one
 *
 * The wizard edits **one policy at a time** (Cards 2–7) and appends it to an
 * array (Card 8). Validating the whole array on every keystroke would revalidate
 * finished policies, turn error paths into `policies.3.priorInsurance.carrier`
 * soup, and — worst — leak `mode: "onBlur"` touched-state between policies, so
 * entering policy 2 would show policy 1's errors.
 *
 * So: `soldPolicySchema` validates the **draft** in its own form, and
 * `soldDealSchema` validates the assembled submission. The draft form is
 * remounted per policy, which is what actually delivers the ticket's
 * "keep per-policy state isolated so the loop doesn't leak selections".
 */

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a real date");

/** An uploaded proof, as the API returns it from the presign flow. */
const attachmentSchema = z.object({
  key: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().nonnegative(),
});

/**
 * A discount with the spec's "do you have proof?" fork.
 *
 * `hasProof: false` is a valid answer, not an omission — it routes the chase to
 * the service team instead of cancelling the discount.
 */
const proofSchema = z
  .object({
    selected: z.boolean(),
    hasProof: z.boolean(),
    attachment: attachmentSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.selected && value.hasProof && !value.attachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Attach the document, or answer "no".',
        path: ["attachment"],
      });
    }
  });

const discountsSchema = z.object({
  escrow: z.boolean(),
  fireSubscription: proofSchema,
  roofReceipt: proofSchema,
  acvPersonalProperty: z.boolean(),
  acvDwellingProtection: z.boolean(),
  drivewise: z.boolean(),
  defensiveDriver: z
    .object({
      selected: z.boolean(),
      drivers: z
        .array(
          z.object({
            name: z.string().trim().min(1, "Name the driver").max(120),
            contactId: z.string().optional(),
          }),
        )
        .max(10, "At most 10 drivers"),
    })
    .superRefine((value, ctx) => {
      if (value.selected && value.drivers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Add at least one driver.",
          path: ["drivers"],
        });
      }
    }),
  studentDiscount: proofSchema,
});

const escrowSchema = z.object({
  loanNumber: z.string().trim().min(1, "Enter the loan number").max(60),
  companyName: z.string().trim().min(1, "Enter the escrow company").max(160),
  address: z.object({
    street: z.string().trim().min(1, "Required").max(200),
    city: z.string().trim().min(1, "Required").max(120),
    state: z.string().trim().min(1, "Required").max(60),
    zip: z.string().trim().min(1, "Required").max(20),
  }),
});

export const soldPolicySchema = z
  .object({
    // Card 2
    policyType: z.enum(POLICY_TYPES),
    // Card 3
    effectiveDate: ymd,
    carrier: z.string().trim().min(1, "Enter the carrier").max(120, "Too long"),
    policyNumber: z
      .string()
      .trim()
      .min(1, "Enter the policy number")
      .max(60, "Too long"),
    /** Set when the producer confirmed the duplicate check's match. */
    existingPolicyId: z.string().optional(),
    // Card 4 — strings in form state; see `numericString` for why not coercion.
    premium: numericString({
      required: "Enter the premium",
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
    // Card 5
    discounts: discountsSchema,
    escrow: escrowSchema.optional(),
    // Card 6
    priorInsurance: z.object({
      none: z.boolean(),
      carrier: z.string().trim().max(120, "Too long").optional(),
      agentName: z.string().trim().max(120, "Too long").optional(),
    }),
    // Card 7
    cancellation: z.object({
      cancelled: z.boolean(),
      effectiveDate: z.union([ymd, z.literal("")]).optional(),
    }),
  })
  .superRefine((policy, ctx) => {
    if (!policy.priorInsurance.none && !policy.priorInsurance.carrier?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Name the prior carrier, or tick "no prior insurance".',
        path: ["priorInsurance", "carrier"],
      });
    }
    if (policy.cancellation.cancelled && !policy.cancellation.effectiveDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter the cancellation effective date.",
        path: ["cancellation", "effectiveDate"],
      });
    }
    // Ticking escrow is what makes its sub-card required: the audit item it
    // generates asks the service team to verify exactly these three things.
    if (policy.discounts.escrow && !policy.escrow) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter the escrow details.",
        path: ["escrow"],
      });
    }
  });

export type SoldPolicyFormValues = z.infer<typeof soldPolicySchema>;

export const soldDealSchema = z.object({
  soldDate: ymd,
  policies: z.array(soldPolicySchema).min(1, "Add at least one policy"),
});

export type SoldDealFormValues = z.infer<typeof soldDealSchema>;

export const EMPTY_DISCOUNTS: SoldPolicyFormValues["discounts"] = {
  escrow: false,
  fireSubscription: { selected: false, hasProof: false },
  roofReceipt: { selected: false, hasProof: false },
  acvPersonalProperty: false,
  acvDwellingProtection: false,
  drivewise: false,
  defensiveDriver: { selected: false, drivers: [] },
  studentDiscount: { selected: false, hasProof: false },
};

/**
 * A factory, not a shared constant: the nested `drivers: []` would otherwise be
 * one array instance handed to every policy, so adding a driver to policy 2
 * would silently add it to policy 1 as well.
 */
export function emptyPolicy(): SoldPolicyFormValues {
  return { ...EMPTY_POLICY, discounts: structuredClone(EMPTY_DISCOUNTS) };
}

const EMPTY_POLICY: SoldPolicyFormValues = {
  policyType: "Auto",
  discounts: EMPTY_DISCOUNTS,
  effectiveDate: "",
  carrier: "",
  policyNumber: "",
  premium: "",
  itemCount: "1",
  priorInsurance: { none: false, carrier: "", agentName: "" },
  cancellation: { cancelled: false, effectiveDate: "" },
};

/**
 * The wizard's cards, in order.
 *
 * Card 1 is outside the loop (one sold date per deal); Cards 2–7 are the loop
 * body; Card 8 decides whether to run it again.
 */
export const WIZARD_CARDS = [
  "soldDate",
  "policyType",
  "policyDetails",
  "financials",
  "discounts",
  "priorInsurance",
  "cancellation",
  "loop",
] as const;

export type WizardCard = (typeof WIZARD_CARDS)[number];

export const CARD_TITLES: Record<WizardCard, string> = {
  soldDate: "Sold date",
  policyType: "Policy type",
  policyDetails: "Policy details",
  financials: "Financials",
  discounts: "Discounts & documentation",
  priorInsurance: "Prior insurance",
  cancellation: "Cancellation",
  loop: "Add another policy?",
};

/**
 * Which draft fields each card owns.
 *
 * Data rather than scattered logic: "can I advance?" is
 * `validateCard(CARD_FIELDS[card])`, so adding a card cannot forget to validate
 * it.
 *
 * Entries are path **roots**, not necessarily leaves. The wizard validates every
 * path at or under each one, which is how errors zod reports deeper down get
 * caught — `discounts.defensiveDriver.drivers` from a `superRefine`, or an array
 * item like `…drivers[0].name` that no static list could name.
 *
 * Typed `DeepKeys` rather than `keyof`: `form.validateField` takes these
 * directly (the old `keyof` list needed a cast at the call site), and a nested
 * path such as `priorInsurance.carrier` is now nameable if a card ever needs one.
 */
export const CARD_FIELDS: Record<
  WizardCard,
  Array<DeepKeys<SoldPolicyFormValues>>
> = {
  soldDate: [],
  policyType: ["policyType"],
  policyDetails: ["effectiveDate", "carrier", "policyNumber"],
  financials: ["premium", "itemCount"],
  discounts: ["discounts", "escrow"],
  priorInsurance: ["priorInsurance"],
  cancellation: ["cancellation"],
  loop: [],
};

/** Form strings → the numeric wire shape, once validation has passed. */
export function toPolicyInput(values: SoldPolicyFormValues): SoldPolicyInput {
  return {
    discounts: values.discounts,
    // Only sent when escrow was actually ticked — the server rejects details
    // without the selection, and vice versa.
    escrow: values.discounts.escrow ? values.escrow : undefined,
    policyType: values.policyType,
    effectiveDate: values.effectiveDate,
    carrier: values.carrier,
    policyNumber: values.policyNumber,
    existingPolicyId: values.existingPolicyId || undefined,
    premium: Number(values.premium),
    itemCount: Number(values.itemCount),
    priorInsurance: values.priorInsurance.none
      ? { none: true }
      : {
          none: false,
          carrier: values.priorInsurance.carrier?.trim() || undefined,
          agentName: values.priorInsurance.agentName?.trim() || undefined,
        },
    cancellation: values.cancellation.cancelled
      ? {
          cancelled: true,
          effectiveDate: values.cancellation.effectiveDate || undefined,
        }
      : { cancelled: false },
  };
}
