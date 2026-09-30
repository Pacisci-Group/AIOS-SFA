/**
 * The **Unlinked records** work list (PAC-91 §10, extended by PAC-126).
 *
 * David's answer to "what about the records the link backfill cannot repair":
 * leave them unlinked, but give the team a list to work from. The first three
 * kinds below are the three gaps the Phase 1 backfill reported and could not
 * close on its own — a policy nobody can attribute to a household, a person
 * nobody has put in one, and a household nobody leads.
 *
 * ## The fourth kind is a different sort of gap
 *
 * `unanchored` lists **active policies with no renewal anchor** (PAC-126). It is
 * not a missing *link*, it is a missing *date*, and it is here because it is the
 * same job for the same people: a record the automation cannot act on until
 * somebody types in what it is missing. The renewal scan simply skips these —
 * `rollForwardRenewalDates` gives up when the fallback chain yields nothing and,
 * in its own words, leaves "the migration's report be what surfaces it". Nothing
 * in the app surfaced that report, which is exactly the complaint §10 was
 * written to answer.
 *
 * That makes the page's title narrower than its contents. Kept anyway: a second
 * near-identical work list is worse for the team than one whose fourth chip does
 * not quite match the heading, and the counts belong in the same place.
 *
 * ## Naming
 *
 * The first three kinds name *the record type* being listed. The fourth cannot —
 * it also lists policies — so it names *the gap* instead. There is no way to
 * keep both conventions once one entity has two kinds.
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
  'unanchored',
] as const;

export type UnlinkedRecordKind = (typeof UNLINKED_RECORD_KINDS)[number];

/**
 * The numbers behind the filter chips — one request, whichever kind is being
 * shown.
 *
 * Its own endpoint rather than another `kind`, because the page needs all of
 * them at once *and* one page of one of them: two questions, two cache keys,
 * and a paginated envelope with no `items` would be a lie about its own shape.
 *
 * One key per {@link UnlinkedRecordKind}, spelled out rather than mapped, so
 * adding a kind is a compile error here and at every read site.
 */
export interface UnlinkedCounts {
  policies: number;
  contacts: number;
  households: number;
  unanchored: number;
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

/**
 * An **active policy with no renewal anchor** (PAC-126).
 *
 * `Policy.renewalDate` is the date every renewal call counts backwards from,
 * derived from the effective date and the policy type. A policy reaches this
 * list when the whole fallback chain the renewal scan uses —
 * `renewalDate ?? effectiveDate ?? expirationDate` — is empty, so there is
 * nothing to derive from and outreach silently skips it forever. The 2026-09-08
 * backfill reported these rather than guessing a date that would call real
 * clients on the wrong day; this is that report, in the app.
 *
 * ## No date fields, deliberately
 *
 * Every date on one of these rows is null by definition — that is the predicate.
 * Carrying them would be three empty columns. What makes a row actionable is
 * **whose policy it is**, so the household comes along instead: the rep opens it,
 * finds the effective date on the declaration page, and types it in. Entering
 * one is what removes the row.
 *
 * The household is nullable because a policy can be in both this list and the
 * `policies` list — unattributed *and* undated.
 */
export interface UnanchoredPolicyRow {
  id: string;
  policyNumber: string | null;
  policyType: string | null;
  carrier: string | null;
  policyStatus: string | null;
  premium: number;
  items: number;
  householdId: string | null;
  householdRef: string | null;
  householdName: string | null;
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
  | UnlinkedPage<'households', UnlinkedHouseholdRow>
  | UnlinkedPage<'unanchored', UnanchoredPolicyRow>;
