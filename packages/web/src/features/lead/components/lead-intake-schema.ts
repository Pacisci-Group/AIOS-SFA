import type { LeadPolicyOfInterestInput } from "@sfa/shared";
import {
  DEFAULT_ADDRESS_STATE,
  HOUSEHOLD_MEMBER_ROLES,
  POLICY_TYPES,
} from "@sfa/shared";
import { z } from "zod";
import {
  emptyPolicyAddress,
  policyAddressInput,
  policyAddressShape,
  requirePolicyPropertyAddress,
} from "@/lib/property-address-rule";
import { numericString } from "@/lib/zod-helpers";

/**
 * One policy the submitter wants quoted (PAC-56 #2).
 *
 * The same row the Quote Recap form uses, **minus premium** — this is asked
 * before a quote exists, so nobody can answer it yet. Item count stays a string
 * in form state; see {@link numericString}.
 *
 * The insured dwelling rides on the row (PAC-56 #14) and is captured in the same
 * drawer, so a prospect asking about their home *and* a rental describes both.
 */
export const policyOfInterestSchema = z
  .object({
    policyType: z.enum(POLICY_TYPES),
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

export type LeadPolicyFormValues = z.infer<typeof policyOfInterestSchema>;

/**
 * A blank row for a freshly opened drawer.
 *
 * "Same as household" starts **on**, unlike the Quote Recap: the household
 * address is being typed into this very form, so there is always something to
 * copy — and most people insure the home they live in.
 */
export function emptyPolicyOfInterest(): LeadPolicyFormValues {
  return {
    policyType: "Auto",
    itemCount: "1",
    sameAsHousehold: true,
    propertyAddress: emptyPolicyAddress(),
  };
}

/**
 * Who is filling the form in. Both differences between the two entry points —
 * lead source, and policies of interest — track this one axis, so they hang off
 * one discriminator rather than a pair of always-inverse booleans.
 *
 * - `internal`: a producer at `/leads/new`. Asked for the lead source; **not**
 *   asked what to quote — that is the prospect's answer, and PAC-56 #2 scopes
 *   the question to the public form.
 * - `public`: an outside submitter on a share link. The reverse of both.
 */
export type LeadIntakeVariant = "internal" | "public";

/**
 * Validation for the New Lead form (PAC-37), shared by the authenticated page
 * and the public share-link page.
 *
 * A factory rather than two schemas so both pages keep a single
 * `LeadIntakeFormValues` type: what differs is which fields are *required*, a
 * runtime rule rather than a difference in shape.
 */
export function makeLeadIntakeSchema(variant: LeadIntakeVariant) {
  const isPublic = variant === "public";
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
      // No `.superRefine` here any more: the property-address rule moved onto
      // the policy row (PAC-56 #14), where the address now lives.
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
         * Public form only (PAC-56 #2) — the internal form leaves it empty and
         * never renders the section, so requiring a row there would block a
         * producer on a question only the prospect can answer. Rows are added
         * through the drawer (#15), each carrying its own dwelling (#14).
         *
         * Where it *is* asked, it is required here while the API defaults it to
         * `[]` — the same split `address` uses: the form is where we can ask, so
         * we insist; the endpoint would rather store an incomplete lead than 400
         * and lose it.
         */
        policiesOfInterest: isPublic
          ? z
              .array(policyOfInterestSchema)
              .min(1, "Add at least one policy")
              .max(12, "At most 12 policies")
          : z.array(policyOfInterestSchema).max(12, "At most 12 policies"),
        leadSourceCode: isPublic
          ? z.string().optional()
          : z.string().min(1, "Select a lead source"),
      })
  );
}

export type LeadIntakeFormValues = z.infer<
  ReturnType<typeof makeLeadIntakeSchema>
>;

/** Form strings → the numeric wire shape, once validation has passed. */
export function toPolicyOfInterestInputs(
  policies: LeadIntakeFormValues["policiesOfInterest"],
): LeadPolicyOfInterestInput[] {
  return policies.map((p) => ({
    policyType: p.policyType,
    itemCount: Number(p.itemCount),
    sameAsHousehold: p.sameAsHousehold,
    // Dropped for a row that owns no address — see `policyAddressInput`.
    propertyAddress: policyAddressInput(p),
  }));
}

/**
 * Blank form state. Takes no variant: the two entry points differ only in which
 * fields are *required*, and every default is now the same on both.
 */
export function emptyLeadIntake(): LeadIntakeFormValues {
  return {
    primaryContact: {
      firstName: "",
      lastName: "",
      dateOfBirth: "",
      phone: "",
      email: "",
    },
    // State pre-filled (PAC-56 #3) — see `DEFAULT_ADDRESS_STATE`. It is a real
    // answer, not a placeholder: the field validates and counts as complete on
    // the progress bar without being touched, which is the point.
    address: { street: "", city: "", state: DEFAULT_ADDRESS_STATE, zip: "" },
    members: [],
    // Always empty now, on both variants. Policies are added through the drawer
    // (PAC-56 #15), so a seeded row would be one the submitter never opened,
    // never confirmed, and — on the internal form, where the section is not even
    // rendered — never saw. The public form's `.min(1)` is what insists.
    policiesOfInterest: [],
    leadSourceCode: "",
  };
}

/**
 * Re-exported for the existing call sites. The implementation moved to
 * `@/lib/submission-token` when the Quote Recap form needed it too — a second
 * feature importing an idempotency primitive from this feature's schema file
 * was the wrong shape.
 */
export { newSubmissionToken } from "@/lib/submission-token";
