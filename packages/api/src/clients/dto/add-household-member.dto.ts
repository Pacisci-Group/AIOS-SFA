import { HOUSEHOLD_MEMBER_ROLES } from '@sfa/shared';
import { z } from 'zod';

const name = z.string().trim().min(1).max(60);

/**
 * `POST /households/:id/members` — the "+ Member" dialog on the Household page.
 *
 * Deliberately the **same four fields** the New Lead form's member rows collect
 * (`HouseholdMembersField`), and the same vocabulary: `HOUSEHOLD_MEMBER_ROLES`
 * is shared precisely so the two entry points cannot drift into writing
 * different `roleInHousehold` strings for the same relationship.
 *
 * `Named Insured` is not offered. It is the *primary* contact's role, implied
 * by `contacts.isPrimary` and stamped by intake — a household has one, and
 * adding a second through this dialog would produce two primaries.
 *
 * Date of birth is optional here, as it is on the intake form: a producer
 * adding a child to a household often does not have it to hand, and refusing
 * the member over it just means the member never gets recorded.
 */
export const addHouseholdMemberSchema = z.object({
  firstName: name,
  lastName: name,
  /**
   * `YYYY-MM-DD`, or omitted. A string, deliberately not `z.coerce.date()` —
   * see the same note on `update-contact.dto.ts`: coercing through the server's
   * local timezone is how a birthday becomes the previous day.
   */
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD')
    .optional(),
  role: z.enum(HOUSEHOLD_MEMBER_ROLES),
});

export type AddHouseholdMemberDto = z.infer<typeof addHouseholdMemberSchema>;
