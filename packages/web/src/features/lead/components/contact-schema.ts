import type { UpdateContactInput } from "@sfa/shared";
import { z } from "zod";

/**
 * The "Edit Primary Contact" form (PAC-38).
 *
 * Mirrors `contacts/dto/update-contact.dto.ts` but accepts `""` where the API
 * accepts `null`: an empty text input is how a producer says "remove this", and
 * `react-hook-form` has no way to express `null` in a text field. The two are
 * reconciled in {@link toUpdateContactInput} at the submit boundary.
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
});

export type ContactFormValues = z.infer<typeof contactFormSchema>;

/** `""` → `null`, the API's "clear this field" signal. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function toUpdateContactInput(
  values: ContactFormValues,
): UpdateContactInput {
  return {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    dateOfBirth: orNull(values.dateOfBirth),
    email: orNull(values.email),
    phone: orNull(values.phone),
  };
}
