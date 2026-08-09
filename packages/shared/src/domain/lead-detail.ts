/**
 * Lead Detail wire contracts (PAC-38) — everything `/leads/:id` renders, plus
 * the inline-edit patch.
 *
 * Deliberately plain TypeScript, for the reason given in `lead-intake.ts`: zod
 * is not a dependency of this package. The API validates the patch with its own
 * zod DTO (`leads/dto/update-lead.dto.ts`).
 *
 * These types live here rather than api-local (as `LeadRow` does in
 * `api/src/leads/leads.types.ts`) because the web hand-duplicated `LeadRow` in
 * `lib/leads-api.ts` and has had to keep the copy in sync by eye ever since.
 * `LeadDetail` is ten nested interfaces; a second copy would be a guaranteed
 * drift source. Precedent: `QuoteRecapLeadContext` / `SoldDealLeadContext`.
 *
 * The `LeadRow` output discipline carries over verbatim — **what is not here
 * matters as much as what is**. No `legacy*` ids, no `isTestRecord`, no
 * `agencyId`/`branchId`, no storage keys, and no raw select codes: `status` and
 * every policy type are always canonical labels.
 */

import type { StructuredAddress } from './address';
import type { ActivityOrigin, ActivityType } from './activity';
import type { ContactDetail } from './contact';
import type { IntakeChannel } from './lead-intake';
import type { NormalizedLeadSource } from './lead-source';
import type { LeadTemperature } from './lead-temperature';

/**
 * One person on the household roster.
 *
 * An alias rather than a parallel interface: this is the same record the
 * primary-contact edit returns, and two definitions would drift.
 */
export type LeadDetailContact = ContactDetail;

/**
 * A bound policy on the household.
 *
 * Note there is no contact attribution — `Policy` links to `Household` and
 * `Deal` and **never to a contact**, so the mockup's per-member policy icons
 * are not derivable. Policies are therefore reported at household level.
 */
export interface LeadDetailPolicy {
  id: string;
  /** Canonical label via `normalizePolicyType` — migrated docs hold raw codes. */
  policyType: string;
  carrier: string | null;
  policyNumber: string | null;
  active: boolean;
  status: string | null;
  premium: number;
  items: number;
  /** ISO date-only. */
  effectiveDate: string | null;
  expirationDate: string | null;
}

export interface LeadDetailHousehold {
  id: string;
  /**
   * The household's agency-unique number — `HH-2614` (PAC-56 #7).
   *
   * `Household.householdRef`, read straight through rather than derived: it is a
   * real identifier, so it is safe to quote in a support conversation and to
   * resolve back to this record. Empty string for a household migrated before
   * the field existed and not yet backfilled; clients hide the affordance rather
   * than render a bare prefix. See `record-reference.ts`.
   */
  reference: string;
  name: string | null;
  address: StructuredAddress | null;
  /** Primary contact first, then `memberContactIds` order. */
  members: LeadDetailContact[];
  /** Household-level, not per-member — see {@link LeadDetailPolicy}. */
  policies: LeadDetailPolicy[];
  totalActivePolicies: number;
}

/** A quote recap reduced to what the "earlier recaps" list shows. */
export interface LeadDetailQuoteRecapSummary {
  id: string;
  /** ISO. `null` on a migrated recap that never carried a quote date. */
  quoteDate: string | null;
  premium: number;
  itemCount: number;
  /** Canonical labels — `normalizePolicyType` on read. */
  productsQuoted: string[];
  status: string | null;
}

export interface LeadDetailQuoteRecapPolicy {
  policyType: string;
  premium: number;
  itemCount: number;
  /**
   * The dwelling this row insures (PAC-56 #14), already resolved: a row the
   * producer marked "same as household" holds the household address itself, not
   * a flag to re-interpret.
   *
   * `null` on non-property rows, and on every recap written before the address
   * moved onto the row — those carry {@link LeadDetailQuoteRecap.propertyAddress}
   * instead.
   */
  propertyAddress: StructuredAddress | null;
}

/**
 * The current recap, rendered in full.
 *
 * This is a **summary of what was quoted**, not the mockup's current-vs-proposed
 * coverage comparison. That table needs carrier, liability limits, collision and
 * comprehensive deductibles, UM/UIM and med pay — none of which the Quote Recap
 * form captures (PAC-39 shipped the spec's field set), and there is no "current
 * coverage" source anywhere in the system. Extending it is a product call, not
 * something to fake with empty rows.
 */
export interface LeadDetailQuoteRecap extends LeadDetailQuoteRecapSummary {
  policies: LeadDetailQuoteRecapPolicy[];
  /**
   * The **recap-level** property address, which only pre-PAC-56-#14 recaps have.
   * Newer ones put the address on each policy row; render this only as the
   * fallback for a recap whose rows carry none.
   */
  propertyAddress: StructuredAddress | null;
  notes: string | null;
  /**
   * Who recorded the recap, resolved from `producerId`. `null` on a migrated
   * recap with no producer on file.
   *
   * The card needs it to attribute {@link LeadDetailQuoteRecap.notes} (PAC-56
   * #13/#29). A note rendered as bare prose beside system-derived totals gives
   * the reader no way to tell which is which; "Pat Producer · 9 Aug" does.
   */
  producerName: string | null;
  /** ISO. When the recap was recorded, as opposed to when it was quoted. */
  createdAt: string | null;
  /**
   * Metadata only. The storage `key` is deliberately withheld: it is an
   * internal path, and downloading the document needs its own presigned-URL
   * endpoint rather than a client that knows where the bytes live.
   */
  document: {
    filename: string;
    contentType: string;
    size: number;
    uploadedAt: string;
  } | null;
}

export interface LeadDetailDeal {
  id: string;
  soldDate: string | null;
  premium: number;
  itemCount: number;
  policyCount: number;
  dealType: string;
  isBundle: boolean;
  /** Canonical labels. */
  policyTypes: string[];
  /**
   * The policies this sale bound (PAC-56 #27).
   *
   * A subset of `household.policies` — the same {@link LeadDetailPolicy} shape,
   * filtered to `Policy.dealId === this deal`. Repeated rather than referenced
   * by id so the Sold card renders from one field; a household can hold
   * policies from earlier deals and from the migration that this sale did not
   * write, and those must not appear under it.
   *
   * Empty on a migrated deal whose policies were never linked back to it.
   */
  policies: LeadDetailPolicy[];
}

export interface LeadDetailPriorPolicy {
  id: string;
  policyType: string | null;
  previousCarrier: string | null;
  cancellationStatus: string | null;
  needsCancellation: string | null;
  cancellationDate: string | null;
  accordFormNeeded: string | null;
  completedDate: string | null;
}

/**
 * Prior coverage, as captured by the Sold form (PAC-40).
 *
 * Only fields the platform actually stores. The mockup additionally shows a
 * policy number, limits, deductibles, current premium and a continuous-coverage
 * figure — none of those exist on `priorInsurance` or `priorPolicies`, so they
 * are omitted rather than fabricated.
 */
export interface LeadDetailPriorInsurance {
  id: string;
  cancellationResponsibility: string | null;
  cancelledPreviousInsurance: string | null;
  cancellationDate: string | null;
  autoHomeSameCarrier: string | null;
  previousCarrierAuto: string | null;
  previousCarrierHome: string | null;
  previousAgentName: string | null;
  /** One row per prior policy line. */
  policies: LeadDetailPriorPolicy[];
}

/**
 * One row of "what they asked us to quote", as captured at intake (PAC-56 #2).
 *
 * Read-side twin of `LeadPolicyOfInterestInput`: `policyType` is a canonical
 * label here even if a raw code somehow reached the collection.
 */
export interface LeadDetailPolicyOfInterest {
  policyType: string;
  itemCount: number;
  /**
   * The dwelling this row is about (PAC-56 #14), already resolved server-side.
   * `null` on non-property rows and on every lead captured before the address
   * moved onto the row — those carry {@link LeadDetail.propertyAddress}.
   */
  propertyAddress: StructuredAddress | null;
}

export interface LeadDetailActivity {
  id: string;
  type: ActivityType;
  summary: string | null;
  occurredAt: string | null;
  /** Resolved from `producerId`; `null` for system and migrated rows. */
  producerName: string | null;
  /**
   * Which surface the row was written from (PAC-56 #29).
   *
   * Derived server-side from the activity's own refs — see
   * {@link ActivityOrigin}. The timeline needs it because a note left on the
   * lead, on a quote recap and during the sold flow are otherwise
   * indistinguishable once they are all rows in the same list.
   */
  origin: ActivityOrigin;
}

/**
 * `GET /leads/:id` — the whole 360° view in one round trip.
 *
 * The one deliberate exception to "no raw codes" is `leadSource.code`. That is
 * not a display value leaking: it is the stable vocabulary key that both
 * `POST /leads` (`leadSourceCode`) and `PATCH /leads/:id` accept, and the
 * inline Select needs it to round-trip a selection. `leadSource.label` is what
 * is rendered.
 */
export interface LeadDetail {
  id: string;
  /** `First Last`, or `Unknown Lead` when both are empty. */
  name: string;
  firstName: string;
  lastName: string;
  /** Canonical status label — `arW7O` is normalized to `Requote`. */
  status: string;
  temperature: LeadTemperature;
  leadSource: NormalizedLeadSource;
  emails: string[];
  phones: string[];
  /** The household's living address, resolved from lead → household. */
  address: StructuredAddress | null;
  quoteControlNumber: string | null;
  /**
   * What the submitter asked to be quoted (PAC-56 #2), canonical labels.
   *
   * Always an array — empty on every migrated lead and on any submitted before
   * the field existed. It is an intent signal captured at intake, **not** a
   * record of what was actually quoted; that is `latestQuoteRecap.policies`.
   */
  policiesOfInterest: LeadDetailPolicyOfInterest[];
  /**
   * The **lead-level** insured dwelling. Only leads captured before PAC-56 #14
   * moved the address onto each policy row have one, plus whatever the
   * migration carried over from SmartSuite's `Property Address` (`sfd5ba053e`).
   * `null` otherwise — read `policiesOfInterest[].propertyAddress` first and
   * fall back to this.
   */
  propertyAddress: StructuredAddress | null;
  /** Recomputed live from `createdDate`, not the value migration froze in. */
  agingDays: number;
  createdDate: string | null;
  lastActivityAt: string | null;
  /** How the lead arrived; `null` on migrated records. */
  intakeChannel: IntakeChannel | null;
  producerName: string | null;
  primaryContact: LeadDetailContact | null;
  /** `null` when the lead is not linked to a household — a real migrated gap. */
  household: LeadDetailHousehold | null;
  /** Newest by `quoteDate`. `null` when the lead has never been quoted. */
  latestQuoteRecap: LeadDetailQuoteRecap | null;
  /**
   * The rest, newest first — the "N earlier recaps" expander. A lead can hold
   * several: `quoteRecaps.leadId` is a plain index and the status vocabulary
   * includes `Requote`.
   *
   * Full recaps, not summaries. The expander used to show a date, a status and
   * a total, which is not enough to answer the only question anyone opens it to
   * ask — *what changed between this quote and the one before it?* That needs
   * the policy rows, and the requote's own notes and document. A lead holds a
   * handful of recaps, so returning them whole costs a few hundred bytes and
   * removes the need for a second endpoint keyed by recap id.
   */
  earlierQuoteRecaps: LeadDetailQuoteRecap[];
  /** `null` until the lead is sold. */
  deal: LeadDetailDeal | null;
  /** Only reachable through a deal or household — `null` on an unsold lead. */
  priorInsurance: LeadDetailPriorInsurance | null;
  /** Newest first, capped. */
  activities: LeadDetailActivity[];
}

/**
 * `PATCH /leads/:id`. At least one field must be present.
 *
 * Status is intentionally **not** forward-only, unlike the automatic advance the
 * Quote and Sold forms perform: a producer correcting a mis-clicked Sold back to
 * Requote is a real operation, and a one-way control would strand the record.
 */
export interface UpdateLeadInput {
  /** A canonical `LEAD_STATUSES` label. */
  status?: string;
  /** `Unknown` is display-only and never selectable — see `LEAD_TEMPERATURE_OPTIONS`. */
  temperature?: LeadTemperature;
  /**
   * A `SELECTABLE_LEAD_SOURCE_OPTIONS` code, or `LEAD_SOURCE_NONE` to clear it.
   * Codes, not labels — the same vocabulary `POST /leads` takes.
   *
   * This control exists because PAC-37 share-link leads arrive with no source at
   * all; without it those leads could never be corrected.
   */
  leadSourceCode?: string;
}

/**
 * `PATCH /leads/:id` response — only the fields the patch can change, in their
 * server-canonical form.
 *
 * Deliberately **not** a whole {@link LeadDetail}: re-running the
 * ten-collection assembly on every dropdown change would make an inline edit
 * cost more than the page load.
 */
export interface UpdateLeadResult {
  id: string;
  status: string;
  temperature: LeadTemperature;
  leadSource: NormalizedLeadSource;
  /** Always bumped — the Leads list sorts on it, and an edit is activity. */
  lastActivityAt: string;
}
