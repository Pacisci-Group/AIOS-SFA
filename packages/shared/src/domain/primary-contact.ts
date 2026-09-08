/**
 * Primary-contact reassignment and the deceased-contact lifecycle (PAC-91 §7).
 *
 * Two owner facts arrived together (David, 2026-09-04): *a contact can die*,
 * and *when the deceased was a household's primary contact, another member has
 * to take over*. Neither half existed — there was no lifecycle field on a
 * contact anywhere in the repo, and `Household.primaryContactId` was only ever
 * *filled*, never changed, so **there was no supported way to reassign a
 * household's primary contact at all**, for any reason.
 *
 * Reassignment is therefore built as the first-class operation, and the death
 * flow calls it — not the other way round. Divorce, a wrong primary picked at
 * intake, and a member promoted after a death are the same operation with
 * different reasons.
 *
 * Every failure below is a **409 with a `code`**, never a message match: the
 * messages are written for a human and will be reworded, and a client that
 * branched on their text would break silently when they were. Same convention
 * as {@link AMBIGUOUS_HOUSEHOLD_CODE}.
 */

/**
 * The household's primary contact is not a stored copy of anything — it is one
 * ref, and the flags below are what a caller needs *about* that ref.
 */

/** `code` when the proposed primary is not a current member of the household. */
export const CONTACT_NOT_A_MEMBER_CODE = 'contact_not_a_member';

/**
 * `code` when the proposed primary already leads a different household.
 *
 * A contact is the primary of **at most one** household, enforced by the
 * partial unique index on `{ agencyId, primaryContactId }`. The API checks
 * first so the response can name the other household; the index is the backstop
 * for the concurrent case, and an E11000 is mapped onto this same shape.
 */
export const PRIMARY_ELSEWHERE_CODE = 'primary_of_another_household';

/** `code` when the contact named is recorded as deceased. */
export const CONTACT_DECEASED_CODE = 'contact_deceased';

/**
 * `code` when marking a household's primary contact deceased would leave the
 * household without one.
 *
 * The owner's rule, written down: **(a) name the successor in the same
 * operation**, falling back to **(c) a deliberate, flagged gap**. Auto-promotion
 * by role precedence — the (b) that was considered — guesses at something the
 * producer knows, on the record that decides which policies and which producer
 * everything about this family hangs off.
 *
 * The 409 carries the eligible successors so the caller can choose without a
 * second request.
 */
export const SUCCESSION_REQUIRED_CODE = 'primary_contact_succession_required';

/**
 * Why a household is flagged for someone's attention.
 *
 * One value today, and deliberately a scalar rather than an array: a second
 * flag would have to mean something, and nothing here can say what. Widen it
 * when a second reason exists.
 *
 * `no_primary` is written **only** by the explicit "leave this household
 * without a primary" path — a household that simply never had one (77 of them
 * on the 2026-09-04 production data, and every household whose SmartSuite row
 * carried no `Primary Contact`) is not flagged, because nobody decided that.
 * The distinction is the whole value of the field: `primaryContactId: null`
 * says *what*, this says *somebody chose it and it still needs an answer*.
 */
export const HOUSEHOLD_DATA_QUALITY_FLAGS = ['no_primary'] as const;

export type HouseholdDataQualityFlag =
  (typeof HOUSEHOLD_DATA_QUALITY_FLAGS)[number];

/**
 * `POST /households/:id/primary-contact`.
 *
 * `contactId: null` is a real answer — "this household deliberately has no
 * primary contact" — and it has to be said explicitly, hence
 * {@link SetPrimaryContactInput.allowNoPrimary}. A body that clears the ref by
 * accident is the one mistake a household record cannot survive quietly.
 */
export interface SetPrimaryContactInput {
  /** The new primary, or `null` together with `allowNoPrimary: true`. */
  contactId: string | null;
  /** Required to clear the primary. Ignored when `contactId` is given. */
  allowNoPrimary?: boolean;
}

/** One option the {@link SUCCESSION_REQUIRED_CODE} 409 offers. */
export interface SuccessorCandidate {
  id: string;
  name: string;
  /** Their role in *this* household, from the membership (PAC-91 §5). */
  role: string | null;
}

/**
 * The {@link SUCCESSION_REQUIRED_CODE} 409 body.
 *
 * `candidates` is every current member who could take over — alive, and not
 * already the primary of another household. It can be **empty**, and that is
 * not an error: a household whose only member has died has nobody to promote,
 * and the honest next step is `allowNoPrimary`.
 */
export interface SuccessionRequiredError {
  statusCode: 409;
  error: 'Conflict';
  code: typeof SUCCESSION_REQUIRED_CODE;
  message: string;
  contactId: string;
  householdId: string;
  /** `HH-2614`, or null for a household migrated before refs existed. */
  householdRef: string | null;
  householdName: string | null;
  candidates: SuccessorCandidate[];
}
