/**
 * Lead intake wire contracts (PAC-37) — shared by the NestJS write path and the
 * two web forms (`/leads/new` and the public `/f/lead/:token`).
 *
 * Deliberately plain TypeScript: `zod` is not a dependency of this package, and
 * adding it would put a validator in the shared build for the sake of one DTO.
 * The API validates with its own zod schema (`dto/create-lead.dto.ts`) and the
 * web app with its own (`features/lead/components/lead-intake-schema.ts`); these
 * interfaces are what both agree the shape is.
 */
import type { HouseholdMemberRole } from './household-role';
import type { PolicyType } from './policy-type';

/** How a lead entered the platform. Stored on `leads.intakeSource.channel`. */
export type IntakeChannel = 'internal' | 'share_link';

export interface LeadIntakePerson {
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD`. Parsed as UTC midnight — never `new Date(str)` in local time. */
  dateOfBirth: string;
  phone: string;
  email: string;
}

/**
 * The household's **living** address — explicitly distinct from any insured
 * property address captured later in the Quote/Sold forms.
 */
export interface LeadIntakeAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface LeadIntakeMember {
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD`, optional for members. */
  dateOfBirth?: string;
  role: HouseholdMemberRole;
}

/**
 * One policy the submitter wants quoted (PAC-56 #2).
 *
 * The Quote Recap's policy row minus premium — this is asked before a quote
 * exists, so there is no figure to give. Same vocabulary on purpose: the
 * prospect naming "Landlord" here and the producer recording a Landlord policy
 * later must be saying the same word.
 *
 * ## The address belongs to the policy, not to the submission (PAC-56 #14)
 *
 * A household can hold several property policies at once — the home they live
 * in *and* a landlord policy on a rental — so a single submission-level
 * property address cannot represent them. It rides with the row that needs it,
 * which is also why the intake drawer captures both together.
 */
export interface LeadPolicyOfInterestInput {
  policyType: PolicyType;
  /** Vehicles, dwellings, items — whatever the type counts. 1–99. */
  itemCount: number;
  /**
   * Property-type rows only (Home, Renters, Condominium, Landlord). When true
   * the server copies the household `address` onto **this row** and
   * **discards** `propertyAddress`, so a row cannot claim one thing and store
   * another. Ignored entirely on a non-property row.
   */
  sameAsHousehold?: boolean;
  propertyAddress?: LeadIntakeAddress;
}

export interface LeadIntakeInput {
  primaryContact: LeadIntakePerson;
  address?: LeadIntakeAddress;
  members: LeadIntakeMember[];
  /**
   * What to quote. Empty is accepted by the API; the forms require one.
   *
   * The insured dwelling (PAC-56 #6) lives on the rows that need it rather than
   * beside them — see {@link LeadPolicyOfInterestInput}.
   */
  policiesOfInterest?: LeadPolicyOfInterestInput[];
  /**
   * Canonical lead-source code. Required on the authenticated form; **absent on
   * public submissions**, which store no source until a producer sets one
   * (PAC-38 inline edits).
   */
  leadSourceCode?: string;
  quoteControlNumber?: string;
  /**
   * Client-generated per-form-session idempotency key. The server namespaces it
   * by channel before storing, so a double-click or a retried request resolves
   * to the same lead instead of creating a second one.
   */
  submissionToken?: string;
}

/** `POST /leads`. The public endpoint deliberately returns no id. */
export interface CreateLeadResponse {
  id: string;
}

/**
 * `GET /public/lead-form/:token`. This is the **complete** public payload — no
 * producer identity, no internal ids, no client data. Widening it is a leak.
 */
export interface PublicLeadFormInfo {
  agencyName: string;
  isActive: true;
}

/** `POST /public/leads/:token`. No record details reach the submitter. */
export interface PublicLeadSubmitResponse {
  submitted: true;
}

export interface ShareLinkRow {
  id: string;
  token: string;
  url: string;
  /** Display only — a producer's own note ("Referrals from Dave"). Never affects the lead. */
  label: string | null;
  isActive: boolean;
  submissionCount: number;
  lastSubmissionAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}
