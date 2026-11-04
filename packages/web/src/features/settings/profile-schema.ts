import { PHONE_MAX_LENGTH } from '@sfa/shared';
import { z } from 'zod';

/**
 * The profile page's name form (PAC-81).
 *
 * **Both halves are optional here, unlike the invite form.** Migrated users
 * often arrived with no split name at all, and forcing a value just to press
 * Save would make the first visit to their own profile an errand. Clearing a
 * field is also legitimate — the API's `clearable` PATCH semantics exist for
 * exactly that, and `toUpdateProfileInput` maps an emptied input to `null`.
 */
export const profileFormSchema = z.object({
  firstName: z.string().trim().max(60, 'Keep it under 60 characters'),
  lastName: z.string().trim().max(60, 'Keep it under 60 characters'),
  /** Free text (PAC-162) — `(312) 555-0100` as the agency writes it. */
  phone: z.string().trim().max(PHONE_MAX_LENGTH, `Keep it under ${PHONE_MAX_LENGTH} characters`),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

/** Form state → wire body. Empty means "clear it", which the API distinguishes from "not sent". */
export function toUpdateProfileInput(values: ProfileFormValues): {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
} {
  return {
    firstName: values.firstName.trim() || null,
    lastName: values.lastName.trim() || null,
    phone: values.phone.trim() || null,
  };
}
