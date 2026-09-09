import { z } from 'zod';

const name = z.string().trim().min(1).max(60);

/** The fields that actually change the contact — the "at least one" refine. */
const EDITABLE_FIELDS = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'email',
  'phone',
  'deceasedAt',
] as const;

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
    /**
     * `YYYY-MM-DD` to record a death, `null` to undo one (PAC-91 §7).
     *
     * Same string-not-`z.coerce.date()` rule as `dateOfBirth`, for the same
     * reason: a death is a calendar date and coercing it through the server's
     * timezone moves it a day.
     *
     * No upper bound on how far back it may be, but a **future** date is always
     * a typo — the same guard the intake form puts on a date of birth.
     */
    deceasedAt: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of death must be YYYY-MM-DD')
      .refine((value) => value <= new Date().toISOString().slice(0, 10), {
        message: 'Date of death cannot be in the future',
      })
      .nullable()
      .optional(),
    /**
     * Who takes over the household this contact currently leads.
     *
     * Only read when `deceasedAt` is being *set*, and only when the contact is
     * in fact a household's primary — the two together are the one edit that
     * cannot stand alone, because it would leave a household led by a dead
     * person. Rule (a) of §7: the caller names the successor in the same
     * operation.
     */
    successorContactId: z.string().trim().min(1).optional(),
    /**
     * Leave that household without a primary contact, deliberately.
     *
     * Rule (c), the fallback — required rather than assumed, because a
     * household silently losing its primary is precisely the outcome §7 exists
     * to prevent. Ignored when `successorContactId` is given.
     */
    allowNoPrimary: z.boolean().optional(),
  })
  .refine(
    (value) => EDITABLE_FIELDS.some((field) => value[field] !== undefined),
    { message: 'Provide at least one field to update.' },
  )
  /*
   * The two succession answers are meaningless on their own — they exist to
   * resolve the household a *death* leaves leaderless. Accepting them without
   * `deceasedAt` would silently do nothing, which is the shape of request a
   * caller writes when they have misunderstood the endpoint and the shape a
   * response should therefore refuse rather than 200.
   */
  .refine(
    (value) =>
      !(value.successorContactId ?? value.allowNoPrimary) || !!value.deceasedAt,
    {
      message:
        'successorContactId / allowNoPrimary apply only when marking a contact deceased.',
      path: ['successorContactId'],
    },
  );

export type UpdateContactDto = z.infer<typeof updateContactSchema>;
