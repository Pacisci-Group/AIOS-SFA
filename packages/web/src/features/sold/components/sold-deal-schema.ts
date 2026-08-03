import type { SoldPolicyInput } from "@sfa/shared";
import { POLICY_TYPES } from "@sfa/shared";
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
  });

export type SoldPolicyFormValues = z.infer<typeof soldPolicySchema>;

export const soldDealSchema = z.object({
  soldDate: ymd,
  policies: z.array(soldPolicySchema).min(1, "Add at least one policy"),
});

export type SoldDealFormValues = z.infer<typeof soldDealSchema>;

export const EMPTY_POLICY: SoldPolicyFormValues = {
  policyType: "Auto",
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
 * body; Card 8 decides whether to run it again. Card 5 lands in PR4 — the
 * conditional discount matrix and its uploads — and is deliberately absent
 * here rather than stubbed, so the step machine never advertises a card the
 * producer cannot fill in.
 */
export const WIZARD_CARDS = [
  "soldDate",
  "policyType",
  "policyDetails",
  "financials",
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
  priorInsurance: "Prior insurance",
  cancellation: "Cancellation",
  loop: "Add another policy?",
};

/**
 * Which draft fields each card owns.
 *
 * Data rather than scattered logic: "can I advance?" is
 * `trigger(CARD_FIELDS[card])`, so adding a card cannot forget to validate it.
 */
export const CARD_FIELDS: Record<
  WizardCard,
  Array<keyof SoldPolicyFormValues>
> = {
  soldDate: [],
  policyType: ["policyType"],
  policyDetails: ["effectiveDate", "carrier", "policyNumber"],
  financials: ["premium", "itemCount"],
  priorInsurance: ["priorInsurance"],
  cancellation: ["cancellation"],
  loop: [],
};

/** Form strings → the numeric wire shape, once validation has passed. */
export function toPolicyInput(
  values: SoldPolicyFormValues,
): Omit<SoldPolicyInput, "discounts"> {
  return {
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
