import type {
  HouseholdMemberRole,
  IntakeChannel,
  LeadPolicyOfInterestInput,
  NormalizedLeadSource,
} from '@sfa/shared';
import { ClientSession, Types } from 'mongoose';
import type { CreatedRegistry } from '../../common/mongo/transaction.runner';

/**
 * Everything the pipeline needs about *who* is submitting and *where the record
 * belongs* — the single tenancy carrier for both entry points.
 *
 * `LeadIntakeService` reads tenancy from this and nothing else: never
 * `request`, never `@AgencyId()`, never `AccessContext`. That is what makes the
 * public path safe **by construction** rather than by review — those routes are
 * `@Public()`, so `TenantGuard` never runs and `request.access` is `undefined`.
 * There is no code path by which a request body could influence which agency a
 * lead lands in.
 */
export interface IntakeContext {
  /** String, matching `TenantRecord.agencyId` — NOT the ObjectId on `User`. */
  agencyId: string;
  branchId: string;
  /**
   * Always set. Manual entry credits the current user; a share-link submission
   * credits the link's producer. With round-robin out of scope (PAC-53) there
   * is no unassigned case to represent.
   */
  producerId: Types.ObjectId;
  channel: IntakeChannel;
  /** Provenance — present only for `share_link`. */
  shareLinkId?: Types.ObjectId;
  /**
   * Already normalised. **Null on the public path**: a share-link lead records
   * no source, because guessing one would write an assumption down as fact and
   * nothing afterwards could distinguish it from a real answer.
   */
  leadSource: NormalizedLeadSource | null;
  /** Activity attribution. Null on the public path — there is no actor. */
  actorUserId: Types.ObjectId | null;
}

export interface IntakePerson {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  phone?: string;
  email?: string;
}

export interface IntakeAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface IntakeMember extends IntakePerson {
  role: HouseholdMemberRole;
}

export interface IntakeInput {
  primaryContact: IntakePerson;
  address?: IntakeAddress;
  members: IntakeMember[];
  /** Canonical labels; empty when the submitter selected nothing. */
  policiesOfInterest?: LeadPolicyOfInterestInput[];
  /**
   * When true the pipeline stores `address` as the property address and ignores
   * `propertyAddress` entirely — a submission cannot claim "same as household"
   * and store something else.
   */
  sameAsHousehold?: boolean;
  propertyAddress?: IntakeAddress;
  quoteControlNumber?: string;
  /** Raw client token; the orchestrator namespaces it before use. */
  submissionToken?: string;
}

/** Threaded through every step so they share one session and one registry. */
export interface StepDeps {
  ctx: IntakeContext;
  session: ClientSession | null;
  created: CreatedRegistry;
}

export interface ResolvedContact {
  contactId: Types.ObjectId;
  isNew: boolean;
  /** Present when the matched contact already belonged to a household. */
  householdId?: Types.ObjectId;
  legacyHouseholdId?: string;
}

export interface ResolvedHousehold {
  householdId: Types.ObjectId;
  isNew: boolean;
}

export interface ResolvedLead {
  leadId: Types.ObjectId;
  isNew: boolean;
}

export interface IntakeOutcome {
  leadId: Types.ObjectId;
  leadIsNew: boolean;
  contactIsNew: boolean;
  householdIsNew: boolean;
}

/**
 * Mongoose rejects `{ session: null }` on some write paths, so build the option
 * bag rather than passing a nullable through.
 */
export function sessionOptions(session: ClientSession | null): {
  session?: ClientSession;
} {
  return session ? { session } : {};
}

/** Must match the collation on the `{ agencyId, lastName, firstName }` index. */
export const NAME_COLLATION = { locale: 'en', strength: 2 } as const;
