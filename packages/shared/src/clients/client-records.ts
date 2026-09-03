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

import type { StructuredAddress } from '../domain/address';

/** A household member, from the `contacts` collection. */
export interface ContactSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  emails: string[];
  phones: string[];
  /** e.g. "Named Insured", "Spouse", "Driver", "Child". */
  roleInHousehold: string | null;
  /**
   * Inside a `HouseholdView` this is **resolved**, not the stored flag: the API
   * consults `household.primaryContactId` first (see `pickPrimaryContact`), so
   * at most one contact in the roster carries it and that contact leads the
   * list. Elsewhere it is the contact's own stored flag.
   */
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
   * The raw stored objects, kept for callers that need a key the normalized
   * shape drops (`location_address2`). Prefer {@link HouseholdView.address}.
   */
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
