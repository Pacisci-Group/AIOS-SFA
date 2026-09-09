/**
 * The **Unlinked records** work list (PAC-91 §10).
 *
 * David's answer to "what about the records the link backfill cannot repair":
 * leave them unlinked, but give the team a list to work from. The three kinds
 * below are exactly the three gaps the Phase 1 backfill reported and could not
 * close on its own — a policy nobody can attribute to a household, a person
 * nobody has put in one, and a household nobody leads.
 *
 * Nothing here is new schema. Each kind is a predicate over data that already
 * exists, which is why the counts double as the ongoing data-quality signal:
 * they go down as the team works, and back up if a writer regresses.
 *
 * Conventions match `client-records.ts`: ids are strings, instants are ISO
 * strings, calendar dates are `YYYY-MM-DD`, and every optional field is
 * normalized to `| null`.
 */

/** Which gap is being listed. The query param and the response discriminant. */
export const UNLINKED_RECORD_KINDS = [
  'policies',
  'contacts',
  'households',
] as const;

export type UnlinkedRecordKind = (typeof UNLINKED_RECORD_KINDS)[number];

/**
 * The three numbers, for the filter chips — one request, whichever kind is
 * being shown.
 *
 * Its own endpoint rather than a fourth `kind`, because the page needs all
 * three at once *and* one page of one of them: two questions, two cache keys,
 * and a paginated envelope with no `items` would be a lie about its own shape.
 */
export interface UnlinkedCounts {
  policies: number;
  contacts: number;
  households: number;
}

/** A policy with no `householdId` — 136 of them on the 2026-09-04 export. */
export interface UnlinkedPolicyRow {
  id: string;
  policyNumber: string | null;
  policyType: string | null;
  carrier: string | null;
  policyStatus: string | null;
  active: boolean;
  premium: number;
  items: number;
  /** ISO instant, or null. */
  effectiveDate: string | null;
  createdAt: string | null;
}

/**
 * A contact with no **current membership** in any household.
 *
 * "No household" is a `householdMembers` question since PAC-91 §5 — the contact
 * carries no household of its own any more — so this is the absence of a row
 * with `endedAt: null`, not an empty field. Somebody who *left* every household
 * they were in is therefore listed, which is right: they are a person the book
 * no longer connects to anything.
 */
export interface UnlinkedContactRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  /** ISO instant, or null. */
  dateOfBirth: string | null;
  /** `YYYY-MM-DD` when this person has died (PAC-91 §7). */
  deceasedAt: string | null;
  createdAt: string | null;
}

/**
 * A household with no `primaryContactId`.
 *
 * Two situations satisfy that predicate and the row carries both signals rather
 * than the view splitting into two lists:
 *
 * - {@link dataQuality} `'no_primary'` — somebody **decided** to leave it
 *   without one (PAC-91 §7), almost always a death with no successor. Still
 *   work: the answer is to add a member and name them.
 * - `null` — nobody has ever looked. 77 households on the 2026-09-04
 *   production data.
 *
 * {@link memberCount} is what makes a row actionable at a glance: a household
 * with members needs somebody picked out of the roster, one with none needs a
 * member added first, and those are different jobs.
 */
export interface UnlinkedHouseholdRow {
  id: string;
  householdRef: string | null;
  name: string | null;
  status: string | null;
  city: string | null;
  state: string | null;
  totalActivePolicies: number;
  /** Current memberships (`endedAt: null`) — the pool a primary can come from. */
  memberCount: number;
  /** `'no_primary'` when the gap was deliberate, else null. */
  dataQuality: string | null;
  createdAt: string | null;
}

/** Paginated envelope, mirroring `HouseholdListResponse` plus the `kind`. */
interface UnlinkedPage<K extends UnlinkedRecordKind, T> {
  kind: K;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: T[];
}

/**
 * `GET /clients/unlinked` — discriminated on `kind`, so a client narrows the
 * row type from the response it already has rather than from the query it sent.
 */
export type UnlinkedRecordsResponse =
  | UnlinkedPage<'policies', UnlinkedPolicyRow>
  | UnlinkedPage<'contacts', UnlinkedContactRow>
  | UnlinkedPage<'households', UnlinkedHouseholdRow>;
