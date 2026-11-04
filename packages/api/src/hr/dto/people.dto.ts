import { PHONE_MAX_LENGTH, roundHours, TIME_OFF_HOURS_MAX } from '@sfa/shared';
import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';
import { clearable, trimmedText } from '../../common/dto/clearable';
import { isIsoDay } from '../../common/hr/employee-profile.rules';

/** `YYYY-MM-DD` naming a real day; the bounds are the service's (they need today). */
const isoDay = z.string().trim().refine(isIsoDay, 'Use a date, YYYY-MM-DD.');

/** Hours, two decimals, never negative. */
const hours = z
  .number()
  .min(0)
  .max(TIME_OFF_HOURS_MAX)
  .transform((value) => roundHours(value));

/**
 * `PATCH /hr/people/:userId` (PAC-162) — the facts an HR admin edits on a
 * person's profile. `null` clears, absent leaves alone (`clearable`); at
 * least one field.
 */
export const updatePersonFactsSchema = z
  .object({
    firstName: clearable(trimmedText(60)),
    lastName: clearable(trimmedText(60)),
    phone: clearable(trimmedText(PHONE_MAX_LENGTH)),
    hireDate: clearable(isoDay),
    dateOfBirth: clearable(isoDay),
    showBirthday: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Send at least one field.',
  });
export type UpdatePersonFactsDto = z.infer<typeof updatePersonFactsSchema>;

/**
 * `POST /hr/people/:userId/onboarding/complete` (PAC-162). The hire date is
 * the one required fact; the policies are enrolled in order, a starting
 * balance only meaning anything on a time off policy.
 */
export const completeOnboardingSchema = z.object({
  hireDate: isoDay,
  dateOfBirth: clearable(isoDay),
  showBirthday: z.boolean().optional(),
  phone: clearable(trimmedText(PHONE_MAX_LENGTH)),
  policies: z
    .array(
      z.object({
        policyId: objectId,
        startingBalanceHours: hours.optional(),
      }),
    )
    .max(50)
    .refine(
      (rows) => new Set(rows.map((row) => row.policyId)).size === rows.length,
      'Each policy once.',
    )
    .default([]),
});
export type CompleteOnboardingDto = z.infer<typeof completeOnboardingSchema>;

export const personIdParamSchema = objectId;
