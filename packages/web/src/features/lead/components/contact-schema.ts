import type { UpdateContactInput } from "@sfa/shared";
import { z } from "zod";

/**
 * The "Edit Primary Contact" form (PAC-38).
 *
 * Mirrors `contacts/dto/update-contact.dto.ts` but accepts `""` where the API
 * accepts `null`: an empty text input is how a producer says "remove this", and
 * a text field has no way to express `null`. The two are reconciled in
 * {@link toUpdateContactInput} at the submit boundary.
 *
 * Only the names are required — a migrated contact frequently has no DOB, and
 * demanding one in order to fix a typo'd surname would force invented data.
 */
export const contactFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  dateOfBirth: z.union([
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    z.literal(""),
  ]),
  email: z.union([
    z.string().trim().email("Enter a valid email").max(160),
    z.literal(""),
  ]),
  phone: z.union([
    z.string().trim().min(10, "Enter a full phone number").max(20),
    z.literal(""),
  ]),
  /**
   * Date of death — `""` when the person is alive (PAC-91 §7).
   *
   * A future date is always a typo, the same guard the form puts on a date of
   * birth. Nothing stops it being cleared: an erroneously recorded death has to
   * be undoable, which is half the reason this is a date rather than a delete.
   */
  deceasedAt: z.union([
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .refine((value) => value <= new Date().toISOString().slice(0, 10), {
        message: "Date of death can't be in the future",
      }),
    z.literal(""),
  ]),
});

export type ContactFormValues = z.infer<typeof contactFormSchema>;

/** `""` → `null`, the API's "clear this field" signal. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * @param succession how to resolve the household this contact leads, when the
 *   edit is marking them deceased (PAC-91 §7). Omitted on a first attempt —
 *   the API answers with the eligible members if it needs one, so the form only
 *   asks the question when there is really a question to ask.
 */
export function toUpdateContactInput(
  values: ContactFormValues,
  succession?: { successorContactId?: string; allowNoPrimary?: boolean },
): UpdateContactInput {
  return {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    dateOfBirth: orNull(values.dateOfBirth),
    email: orNull(values.email),
    phone: orNull(values.phone),
    deceasedAt: orNull(values.deceasedAt),
    ...(succession?.successorContactId
      ? { successorContactId: succession.successorContactId }
      : {}),
    ...(succession?.allowNoPrimary ? { allowNoPrimary: true } : {}),
  };
}
