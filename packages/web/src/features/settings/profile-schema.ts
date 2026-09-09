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
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

/** Form state → wire body. Empty means "clear it", which the API distinguishes from "not sent". */
export function toUpdateProfileInput(values: ProfileFormValues): {
  firstName: string | null;
  lastName: string | null;
} {
  return {
    firstName: values.firstName.trim() || null,
    lastName: values.lastName.trim() || null,
  };
}
