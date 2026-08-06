import type { LeadPolicyOfInterestInput } from "@sfa/shared";
import {
  HOUSEHOLD_MEMBER_ROLES,
  POLICY_TYPES,
  isPropertyPolicyType,
} from "@sfa/shared";
import { z } from "zod";
import { numericString } from "@/lib/zod-helpers";

const ADDRESS_FIELDS = ["street", "city", "state", "zip"] as const;

/**
 * One policy the submitter wants quoted (PAC-56 #2).
 *
 * The same row the Quote Recap form uses, **minus premium** — this is asked
 * before a quote exists, so nobody can answer it yet. Item count stays a string
 * in form state; see {@link numericString}.
 */
const policyOfInterestSchema = z.object({
  policyType: z.enum(POLICY_TYPES),
  itemCount: numericString({
    required: "Enter an item count",
    min: 1,
    max: 99,
    tooSmall: "At least 1 item",
    tooLarge: "Too many",
    integer: "Whole numbers only",
  }),
});

/**
 * Validation for the New Lead form (PAC-37), shared by the authenticated page
 * and the public share-link page.
 *
 * A factory rather than two schemas so both pages keep a single
 * `LeadIntakeFormValues` type: only the lead-source rule differs, and it is a
 * runtime requirement rather than a difference in shape.
 */
export function makeLeadIntakeSchema(requireLeadSource: boolean) {
  const name = z.string().trim().min(1, "Required").max(60, "Too long");

  const dateOfBirth = z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    // A birth date in the future is always a typo, and it would poison contact
    // matching — DOB is the strongest signal the server has.
    .refine((value) => value <= new Date().toISOString().slice(0, 10), {
      message: "Date of birth can't be in the future",
    });

  return (
    z
      .object({
        primaryContact: z.object({
          firstName: name,
          lastName: name,
          dateOfBirth,
          phone: z
            .string()
            .trim()
            .refine((value) => {
              const digits = value.replace(/\D/g, "");
              return digits.length >= 10 && digits.length <= 11;
            }, "Enter a 10-digit phone number"),
          email: z.email("Enter a valid email").max(160, "Too long"),
        }),
        // Required in the UI even though the API accepts a partial address: the
        // address powers a dedupe signal, and a producer filling this in has it.
        address: z.object({
          street: z.string().trim().min(1, "Required").max(200, "Too long"),
          city: z.string().trim().min(1, "Required").max(120, "Too long"),
          state: z.string().trim().min(1, "Required").max(60, "Too long"),
          zip: z.string().trim().min(1, "Required").max(20, "Too long"),
        }),
        members: z
          .array(
            z.object({
              firstName: name,
              lastName: name,
              /** Optional for members — only the primary contact must supply one. */
              dateOfBirth: z.union([dateOfBirth, z.literal("")]).optional(),
              role: z.enum(HOUSEHOLD_MEMBER_ROLES),
            }),
          )
          .max(10, "At most 10 additional members"),
        /**
         * Named `policies` rather than `policiesOfInterest` because the shared
         * `PolicyRowsField` registers that path — the wire field keeps the
         * longer name, and {@link toPolicyOfInterestInputs} bridges the two.
         *
         * Required here while the API defaults it to `[]`, the same split
         * `address` uses: the form is where we can ask, so we insist; the
         * endpoint would rather store an incomplete lead than 400 and lose it.
         */
        policies: z
          .array(policyOfInterestSchema)
          .min(1, "Add at least one policy")
          .max(12, "At most 12 policies"),
        sameAsHousehold: z.boolean(),
        propertyAddress: z.object({
          street: z.string().trim().max(200, "Too long"),
          city: z.string().trim().max(120, "Too long"),
          state: z.string().trim().max(60, "Too long"),
          zip: z.string().trim().max(20, "Too long"),
        }),
        leadSourceCode: requireLeadSource
          ? z.string().min(1, "Select a lead source")
          : z.string().optional(),
      })
      // Identical rule to the Quote Recap form's, because it is the same
      // question: a property policy quoted against a blank address is useless.
      // Nothing to require while `sameAsHousehold` is set — the server copies
      // the household address and discards whatever was sent.
      .superRefine((value, ctx) => {
        if (value.sameAsHousehold) return;
        if (!value.policies.some((p) => isPropertyPolicyType(p.policyType))) {
          return;
        }

        for (const field of ADDRESS_FIELDS) {
          if (!value.propertyAddress[field]?.trim()) {
            ctx.addIssue({
              code: "custom",
              path: ["propertyAddress", field],
              message: "Required",
            });
          }
        }
      })
  );
}

export type LeadIntakeFormValues = z.infer<
  ReturnType<typeof makeLeadIntakeSchema>
>;

/** Form strings → the numeric wire shape, once validation has passed. */
export function toPolicyOfInterestInputs(
  policies: LeadIntakeFormValues["policies"],
): LeadPolicyOfInterestInput[] {
  return policies.map((p) => ({
    policyType: p.policyType,
    itemCount: Number(p.itemCount),
  }));
}

export const EMPTY_LEAD_INTAKE: LeadIntakeFormValues = {
  primaryContact: {
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    phone: "",
    email: "",
  },
  address: { street: "", city: "", state: "", zip: "" },
  members: [],
  policies: [{ policyType: "Auto", itemCount: "1" }],
  // On by default, unlike the Quote Recap: the household address is being typed
  // into this very form, so there is always something to copy — and most people
  // insure the home they live in.
  sameAsHousehold: true,
  propertyAddress: { street: "", city: "", state: "", zip: "" },
  leadSourceCode: "",
};

/**
 * Re-exported for the existing call sites. The implementation moved to
 * `@/lib/submission-token` when the Quote Recap form needed it too — a second
 * feature importing an idempotency primitive from this feature's schema file
 * was the wrong shape.
 */
export { newSubmissionToken } from "@/lib/submission-token";
