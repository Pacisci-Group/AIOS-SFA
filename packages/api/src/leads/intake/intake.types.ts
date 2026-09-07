import type {
  HouseholdMemberRole,
  IntakeChannel,
  LeadMailerMatchedBy,
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

/** A mailer the caller has already resolved. See `IntakeInput.mailer`. */
export interface IntakeMailerLink {
  mailerId: Types.ObjectId;
  campaignId: string;
  /** The mailer's own normalized key, never what the submitter typed. */
  controlNumberKey: string;
  matchedBy: LeadMailerMatchedBy;
}

export interface IntakeInput {
  primaryContact: IntakePerson;
  address?: IntakeAddress;
  members: IntakeMember[];
  /**
   * Canonical labels; empty when the submitter selected nothing.
   *
   * Each property-type row carries its own dwelling address (PAC-56 #14). When
   * a row sets `sameAsHousehold` the pipeline stores a copy of `address` on it
   * and ignores that row's `propertyAddress` entirely — a submission cannot
   * claim "same as household" and store something else.
   */
  policiesOfInterest?: LeadPolicyOfInterestInput[];
  quoteControlNumber?: string;
  /**
   * An **already-resolved** mailer link (PAC-71).
   *
   * Set only by the drawer's log-lead, which knows for certain which mailer the
   * producer is looking at. Every other caller passes {@link quoteControlNumber}
   * and lets `ResolveLeadStep` resolve it — passing a link here that the caller
   * merely guessed at would write `matchedBy: 'drawer'` onto a match nobody
   * made.
   */
  mailer?: IntakeMailerLink;
  /** Raw client token; the orchestrator namespaces it before use. */
  submissionToken?: string;
  /**
   * Pin the whole intake to an existing household instead of deriving one from
   * the resolved contact (the Household page's "Start Quote" flow).
   *
   * **Authenticated path only** — `publicCreateLeadSchema` does not accept it,
   * so a share-link submission can never name the household it lands in.
   *
   * When set it changes three steps, each for the same reason — the household
   * is known, so nothing may be inferred that could contradict it:
   * 1. `ResolveHouseholdStep` uses it verbatim (404 if it is not in the agency).
   * 2. `ResolveContactStep` matches only against contacts **in** that household,
   *    so a name collision elsewhere cannot drag a stranger's contact across.
   * 3. `ResolveLeadStep`'s address dedupe is confined to it, so a lead at the
   *    same street in a different household is not returned as this one.
   */
  householdId?: string;
}

/** Threaded through every step so they share one session and one registry. */
export interface StepDeps {
  ctx: IntakeContext;
  session: ClientSession | null;
  created: CreatedRegistry;
}

/**
 * A submitted contact detail that disagrees with the one already stored
 * (PAC-91 §1).
 *
 * A contact holds **one** email and **one** phone. Intake used to `$addToSet`
 * the submitted value as a second array element, which is how those arrays grew
 * in the first place — an intake form is a weak source of truth about an
 * existing client, and silently recording a second identity for them is worse
 * than recording none. The stored value wins, and the disagreement is carried
 * back here so the pipeline can put it on the lead's timeline for a human.
 */
export interface ContactFieldConflict {
  contactId: Types.ObjectId;
  field: 'email' | 'phone';
  stored: string;
  submitted: string;
}

export interface ResolvedContact {
  contactId: Types.ObjectId;
  isNew: boolean;
  /** Present when the matched contact already belonged to a household. */
  householdId?: Types.ObjectId;
  legacyHouseholdId?: string;
  /** Empty unless the submission disagreed with the stored contact. */
  conflicts?: ContactFieldConflict[];
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
  /**
   * Contact details the submission disagreed with, written to the lead's
   * timeline after the transaction commits. Absent on a token replay, which
   * short-circuits before any contact is resolved.
   */
  contactConflicts?: ContactFieldConflict[];
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
