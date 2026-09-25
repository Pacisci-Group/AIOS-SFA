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

import type { StoredAddress, StructuredAddress } from '../domain/address';

/** A household member, from the `contacts` collection. */
export interface ContactSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /**
   * One email, one phone — a contact is one person (PAC-91 §1). These were
   * `emails: string[]` / `phones: string[]`, mirroring SmartSuite's field type
   * rather than the domain, and every consumer read `[0]`.
   */
  email: string | null;
  phone: string | null;
  /**
   * e.g. "Named Insured", "Spouse", "Driver", "Child" — the role in **this**
   * household, read from the membership (PAC-91 §5). The contact carries no
   * role of its own: the same person can be a Named Insured at home and a
   * Driver on a parent's policy.
   */
  roleInHousehold: string | null;
  /**
   * Resolved per household, never a stored flag: the API compares the contact
   * against `household.primaryContactId`, so at most one contact in a roster
   * carries it and that contact leads the list. `false` in a response with no
   * household in hand — `Contact.isPrimary` is gone, because it could not say
   * primary *of what* (PAC-91 §5).
   */
  isPrimary: boolean;
  /** ISO date, or null when unknown. */
  dateOfBirth: string | null;
  /**
   * `YYYY-MM-DD` when this person has died, otherwise `null` (PAC-91 §7).
   *
   * The roster keeps listing them — they are on the household's policies and
   * its history — but every forward-looking affordance reads this first: no
   * click-to-call, no mailto, no quote prefill, and not offered as a successor
   * when a new primary contact is named.
   */
  deceasedAt: string | null;
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
  /**
   * Resolved from the household's primary contact, not stored on the household
   * (PAC-91 §4 — the stored copy was written only by intake, so every migrated
   * household rendered an em dash). Null when there is no primary contact.
   */
  primaryContactName: string | null;
  /**
   * `YYYY-MM-DD` when the primary contact has died (PAC-91 §7).
   *
   * Carried beside the name rather than replacing it: the name still identifies
   * the household on every list and drawer, while `primaryEmail` / `primaryPhone`
   * beside it must stop being offered as a way to reach anybody. A list row has
   * no roster to look this up in, which is why it rides on the summary.
   */
  primaryContactDeceasedAt: string | null;
  /**
   * Why this household is flagged for someone's attention — today only
   * `no_primary`, written when a caller deliberately left it without a primary
   * contact (PAC-91 §7). Null for every household nobody has made that choice
   * about, including the ones that simply never had a primary.
   */
  dataQuality: string | null;
  totalActivePolicies: number;
}

/** Full household read-model returned by `GET /households/:id`. */
export interface HouseholdView extends HouseholdSummary {
  /**
   * The household's address, already coerced into one shape by the API's
   * `resolveHouseholdAddress` — property address first, mailing address as the
   * fallback.
   *
   * Read this, not the raw objects below. `propertyAddress` is a loose
   * `Record<string, unknown>` whose keys differ per writer (`street` from lead
   * intake, `line1` from the demo seed, `location_address` from the SmartSuite
   * migration), and every client that re-implemented that lookup table got it
   * wrong for at least one writer.
   */
  address: StructuredAddress | null;
  /**
   * The stored addresses, typed since PAC-101.
   *
   * These used to be `Record<string, unknown>` and existed only so a caller
   * could reach `location_address2`, the one key the normalized shape dropped.
   * The household now stores a typed sub-schema that carries it as `street2`,
   * so these are ordinary objects — but {@link HouseholdView.address} is still
   * what a display should read: it applies the lead → property → mailing
   * precedence, which neither of these knows about.
   */
  propertyAddress: StoredAddress | null;
  mailingAddress: StoredAddress | null;
  /**
   * The primary contact's email and phone, **resolved from that contact** —
   * the household no longer stores a copy of either (PAC-91 §1/§4). Null when
   * the household has no primary contact, or the primary has no such value.
   */
  primaryEmail: string | null;
  primaryPhone: string | null;
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
