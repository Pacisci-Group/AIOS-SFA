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
  /**
   * Canonical `HOUSEHOLD_MEMBER_ROLES` value, or the stored free text — and
   * **only meaningful in a household-scoped response** (PAC-91 §5). Role and
   * primacy belong to a membership, not to the person: the same contact is a
   * Named Insured at home and a Driver on a parent's policy. `GET /leads/:id`
   * resolves both against the lead's household; `PATCH /contacts/:id`, which
   * has no household in hand, returns `null` / `false` rather than a stored
   * flag that meant "primary of *something*".
   */
  role: string | null;
  isPrimary: boolean;
  /**
   * `YYYY-MM-DD` when this person has died, otherwise `null` (PAC-91 §7).
   *
   * A date, not a boolean and not a delete: the person stays on every historical
   * policy, quote, activity and ticket, all of which must keep rendering their
   * name. What changes is everything *forward-looking* — a deceased contact is
   * no longer matched by intake, not offered as a successor, and not the source
   * of a click-to-call, a mailto or a quote prefill.
   *
   * Date-only for the same reason as {@link ContactDetail.dateOfBirth}: a death
   * is a calendar date, and shipping it as `…T00:00:00Z` moves it a day west of
   * Greenwich.
   */
  deceasedAt: string | null;
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
  /**
   * `YYYY-MM-DD` to record a death, or `null` to undo one (PAC-91 §7).
   *
   * Marking the **primary contact** of a household deceased is the one edit
   * here that cannot stand alone: it would leave that household led by a dead
   * person. So the same request must also answer who takes over — either
   * {@link UpdateContactInput.successorContactId}, or
   * {@link UpdateContactInput.allowNoPrimary} to leave the seat open
   * deliberately. Without either, the request is refused with
   * `primary_contact_succession_required`, which carries the eligible members.
   */
  deceasedAt?: string | null;
  /**
   * Who becomes primary of the household this contact currently leads. Only
   * meaningful alongside a `deceasedAt` that is being *set*.
   *
   * Must be a current member of that household, alive, and not already the
   * primary of another one — the same three rules
   * `POST /households/:id/primary-contact` applies, because it is the same
   * operation.
   */
  successorContactId?: string;
  /**
   * Leave the household without a primary contact, deliberately, and flag it
   * `no_primary` for the office to come back to.
   *
   * The fallback, not the default: a household whose only member has died has
   * nobody to promote, and refusing the death would be worse than recording the
   * gap. Ignored when `successorContactId` is given.
   */
  allowNoPrimary?: boolean;
}
