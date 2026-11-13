import { z } from 'zod';
import {
  allstateCodesForUpdate,
  allstateCodesShape,
} from '@/components/allstate-codes/allstate-codes-schema';
import type { UpdateMyProfileInput } from '@/lib/profile-api';

/**
 * The profile page's details form (PAC-81): name, and — for a member of an
 * agency — their own Allstate codes (PAC-173).
 *
 * **Both name halves are optional here, unlike the invite form.** Migrated
 * users often arrived with no split name at all, and forcing a value just to
 * press Save would make the first visit to their own profile an errand.
 * Clearing a field is also legitimate — the API's `clearable` PATCH semantics
 * exist for exactly that, and `toUpdateProfileInput` maps an emptied input to
 * `null`. The codes follow the same rule.
 */
export const profileFormSchema = z.object({
  firstName: z.string().trim().max(60, 'Keep it under 60 characters'),
  lastName: z.string().trim().max(60, 'Keep it under 60 characters'),
  ...allstateCodesShape,
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

/**
 * Form state → wire body. Empty means "clear it", which the API distinguishes
 * from "not sent".
 *
 * `includeCodes: false` leaves the Allstate codes out of the body entirely —
 * for an account with no agency (a platform admin), where the page does not
 * show them and they mean nothing.
 */
export function toUpdateProfileInput(
  values: ProfileFormValues,
  { includeCodes }: { includeCodes: boolean },
): UpdateMyProfileInput {
  return {
    firstName: values.firstName.trim() || null,
    lastName: values.lastName.trim() || null,
    ...(includeCodes ? allstateCodesForUpdate(values) : {}),
  };
}
