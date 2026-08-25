/**
 * Contact wire contracts (PAC-38) — the primary-contact edit on the Lead Detail
 * page.
 *
 * Deliberately plain TypeScript, for the reason given in `lead-intake.ts`: zod
 * is not a dependency of this package. The API validates with its own zod DTO
 * (`contacts/dto/update-contact.dto.ts`) and the web app with its own
 * (`features/lead/components/contact-schema.ts`).
 */

/**
 * One person as the API returns them. Shared with `LeadDetailContact` in
 * `lead-detail.ts`, which is the same shape by design — the household roster and
 * the edit response describe the same record.
 */
export interface ContactDetail {
  id: string;
  firstName: string;
  lastName: string;
  /** `First Last`, or `Unnamed contact` when both are empty. */
  name: string;
  /**
   * `YYYY-MM-DD`, date-only — never an ISO timestamp. A DOB is a calendar date;
   * shipping it as `…T00:00:00Z` is how a birthday becomes the 11th once a US
   * client renders it in local time.
   */
  dateOfBirth: string | null;
  /** First email on file; the contact may hold more. */
  email: string | null;
  /** First phone on file, unformatted — the client formats for display. */
  phone: string | null;
  /** Canonical `HOUSEHOLD_MEMBER_ROLES` value, or the stored free text. */
  role: string | null;
  isPrimary: boolean;
}

/**
 * `PATCH /contacts/:id`. Every field is optional; the nullable ones treat `null`
 * as "clear this".
 *
 * Unlike `LeadIntakePerson`, DOB / email / phone are **not** required. A
 * migrated contact frequently has no DOB, and demanding one in order to fix a
 * typo'd surname would be hostile.
 */
export interface UpdateContactInput {
  firstName?: string;
  lastName?: string;
  /** `YYYY-MM-DD`, or `null` to clear. */
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
}
