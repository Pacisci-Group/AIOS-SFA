import { z } from 'zod';

const name = z.string().trim().min(1).max(60);

/**
 * `PATCH /contacts/:id` — the primary-contact edit on the Lead Detail page
 * (PAC-38).
 *
 * Every field is optional, and the three that can be absent from a record are
 * also **nullable** — `null` clears them.
 *
 * Deliberately laxer than `create-lead.dto.ts`'s `person`, which requires DOB,
 * email and phone. A migrated contact frequently has none of the three, and
 * demanding a date of birth in order to fix a typo'd surname would be hostile:
 * the producer would have to invent data or leave the error standing.
 */
export const updateContactSchema = z
  .object({
    firstName: name.optional(),
    lastName: name.optional(),
    /**
     * `YYYY-MM-DD`, or `null` to clear.
     *
     * A string, deliberately **not** `z.coerce.date()`: coercing "1978-04-12"
     * through the server's local timezone is how a birthday becomes the 11th.
     * The service parses it with the intake pipeline's `parseDateOfBirth`,
     * which builds UTC midnight from explicit components.
     */
    dateOfBirth: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD')
      .nullable()
      .optional(),
    email: z.string().trim().email().max(160).nullable().optional(),
    phone: z.string().trim().min(10).max(20).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type UpdateContactDto = z.infer<typeof updateContactSchema>;
