import { HOUSEHOLD_MEMBER_ROLES } from "@sfa/shared";
import { z } from "zod";

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

  return z.object({
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
    leadSourceCode: requireLeadSource
      ? z.string().min(1, "Select a lead source")
      : z.string().optional(),
  });
}

export type LeadIntakeFormValues = z.infer<
  ReturnType<typeof makeLeadIntakeSchema>
>;

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
  leadSourceCode: "",
};

/**
 * Per-form-session idempotency key.
 *
 * The `crypto` guard is not defensive padding: the public form is mobile-first
 * and will be opened over `http://192.168.x.x:5173` during testing, which is
 * **not a secure context**, so `crypto.randomUUID` is `undefined` there and the
 * page would crash on mount.
 */
export function newSubmissionToken(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
