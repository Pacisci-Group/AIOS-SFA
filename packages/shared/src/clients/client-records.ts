/**
 * Shared read-model for client records (households, their members, and their
 * policies). Kept in `@sfa/shared` so the API serializers and the web app agree
 * on the exact serialized shape.
 *
 * Conventions, mirroring `ServiceTicketView`:
 * - ids are strings (never ObjectId)
 * - dates are ISO strings
 * - optional schema props are normalized to `| null` so the UI never has to
 *   distinguish `undefined` from `null`
 */

/** A household member, from the `contacts` collection. */
export interface ContactSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  emails: string[];
  phones: string[];
  /** e.g. "Named Insured", "Spouse", "Driver", "Child". */
  roleInHousehold: string | null;
  isPrimary: boolean;
  /** ISO date, or null when unknown. */
  dateOfBirth: string | null;
}

/** A policy as listed inside a household. */
export interface PolicySummary {
  id: string;
  policyNumber: string | null;
  policyType: string | null;
  carrier: string | null;
  active: boolean;
  policyStatus: string | null;
  premium: number;
  items: number;
  /** ISO dates, or null when unknown. */
  effectiveDate: string | null;
  expirationDate: string | null;
  renewalDate: string | null;
}

/** The household fields shown when a household is referenced from elsewhere. */
export interface HouseholdSummary {
  id: string;
  name: string | null;
  status: string | null;
  primaryContactName: string | null;
  totalActivePolicies: number;
}

/** Full household read-model returned by `GET /households/:id`. */
export interface HouseholdView extends HouseholdSummary {
  propertyAddress: Record<string, unknown> | null;
  mailingAddress: Record<string, unknown> | null;
  primaryEmails: string[];
  primaryPhones: string[];
  assignedCrmId: string | null;
  contacts: ContactSummary[];
  policies: PolicySummary[];
}

/**
 * A policy as returned by `GET /policies/search`. Carries the owning household
 * so pickers can disambiguate policies with similar numbers.
 */
export interface PolicySearchResult extends PolicySummary {
  householdId: string | null;
  householdName: string | null;
}

/** Full policy read-model returned by `GET /policies/:id`. */
export interface PolicyView extends PolicySummary {
  notes: string | null;
  /** Null when the policy has no household, or it is out of the caller's scope. */
  household: HouseholdSummary | null;
}

/**
 * Why a household appeared in a `GET /households` result.
 *
 * The Clients search spans three collections, so a row's own name frequently
 * matches nothing the caller typed — searching a policy number returns the
 * household that owns it, and searching a child's date of birth returns the
 * household they belong to. Without this the result list reads as broken, so
 * the row renders the record that actually matched.
 *
 * Only ever set for a match the row cannot already show: a member, their date
 * of birth, or a policy. A household matched on its own name or reference
 * leaves this `null`, because those are printed in the row's first column and
 * restating them would be noise.
 */
export interface HouseholdMatch {
  field: 'member' | 'dateOfBirth' | 'policy';
  /** Already formatted for display, e.g. `Jane Doe` or `AS-1234567`. */
  value: string;
}

/** One row of the Clients list, from `GET /households`. */
export interface HouseholdListRow extends HouseholdSummary {
  /** The `HH-2614` a producer reads aloud. Null until a backfill numbers it. */
  householdRef: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  /** From the household's property address, falling back to the mailing one. */
  city: string | null;
  state: string | null;
  assignedCrmId: string | null;
  /** ISO timestamp, or null. */
  updatedAt: string | null;
  matchedOn: HouseholdMatch | null;
}

/** Paginated envelope for `GET /households`, mirroring `LeadListResponse`. */
export interface HouseholdListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: HouseholdListRow[];
}
