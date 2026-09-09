import { z } from 'zod';

/**
 * `POST /households/:id/primary-contact` — name (or deliberately clear) the
 * household's primary contact (PAC-91 §7).
 *
 * The operation that did not exist. `Household.primaryContactId` was only ever
 * *filled* — set on create, or when currently unset, and never reassigned so a
 * second lead could not steal it — which left no supported way to change it at
 * all: not after a death, not after a divorce, not to correct a primary picked
 * wrongly at intake.
 *
 * `contactId: null` is a legitimate answer, and it is why {@link
 * setPrimaryContactSchema} refuses a bare `null`. "This household has no
 * primary contact" is a decision somebody makes and the office has to come back
 * to (it sets `dataQuality: 'no_primary'`); a request that cleared the ref
 * because a field arrived empty is the one mistake a household record cannot
 * survive quietly. Requiring `allowNoPrimary` makes the two impossible to
 * confuse.
 */
export const setPrimaryContactSchema = z
  .object({
    /** The new primary. `null` only together with `allowNoPrimary`. */
    contactId: z.string().trim().min(1).nullable(),
    /** Confirms that leaving the household without a primary is intended. */
    allowNoPrimary: z.boolean().optional(),
  })
  .refine(
    (value) => value.contactId !== null || value.allowNoPrimary === true,
    {
      message:
        'Send allowNoPrimary: true to leave this household without a primary contact.',
      path: ['contactId'],
    },
  );

export type SetPrimaryContactDto = z.infer<typeof setPrimaryContactSchema>;
