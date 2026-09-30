import type { BusinessType, PolicyReplacementReason } from '@sfa/shared';
import { ClientSession, Types } from 'mongoose';
import type { CreatedRegistry } from '../../common/mongo/transaction.runner';
import type { SoldIntakeDto } from '../dto/create-sold-deal.dto';

/**
 * Tenancy + actor for one sold submission.
 *
 * Mirrors `IntakeContext` from lead intake: the steps read tenancy from this
 * and nothing else, so no request body can influence which agency a deal lands
 * in. Unlike lead intake there is no public channel — a sale is always recorded
 * by an authenticated producer.
 */
export interface SoldIntakeContext {
  /** String, matching `TenantRecord.agencyId` — NOT the ObjectId on `User`. */
  agencyId: string;
  branchId: string;
  /** The authenticated caller; becomes `Deal.producerId`. */
  producerId: Types.ObjectId;
  /**
   * The lead this sale came from — **absent on a policy transfer**, which is
   * anchored on a household and a ticket instead.
   *
   * Optional rather than forked because everything downstream of the deal
   * already keys off `householdId`; the lead is load-bearing only for the lead
   * status advance and the deal title fallback, both of which now check.
   */
  leadId?: Types.ObjectId;
  /** The service ticket a transfer was recorded from. Absent on a sale. */
  ticketId?: Types.ObjectId;
  /** New business, or an intra-book company transfer. */
  businessType: BusinessType;
  /**
   * Why the policies named by `fromPolicyId` are being retired.
   *
   * Read only by `UpsertPoliciesStep`, and only for rows that name one — it
   * decides the status the retired policy is stamped with. Absent on the plain
   * sold path, which retires nothing.
   *
   * **Deliberately separate from `businessType`**, which they are tempting to
   * collapse into one field because a transfer is `company_transfer` on both.
   * A rewrite breaks the tie: its replacement is genuinely `new_business`, while
   * the policy it replaced was retired for `cancel_rewrite`. One field records
   * what the new deal *is*, the other what happened to the old policy.
   */
  replacementReason?: PolicyReplacementReason;
  householdId: Types.ObjectId;
  quoteRecapId?: Types.ObjectId;
  primaryContactId?: Types.ObjectId;
  clientName?: string;
  /**
   * Display names for every `cancellation.cancelledByUserId` in the submission
   * (PAC-65 #11), keyed by id.
   *
   * Resolved *and agency-checked* before the transaction opens, so the step can
   * denormalize a name without a query of its own — and so an id from another
   * tenant has already been rejected by the time anything is written.
   */
  staffNameById?: Map<string, string>;
  /** Namespaced (`SOLD|…` / `XFER|…`) or null when the client sent no token. */
  submissionToken: string | null;
}

/** Threaded through every step so they share one session and one registry. */
export interface SoldStepDeps {
  ctx: SoldIntakeContext;
  session: ClientSession | null;
  created: CreatedRegistry;
}

export interface SoldIntakeInput {
  dto: SoldIntakeDto;
}

export interface SoldIntakeOutcome {
  dealId: Types.ObjectId;
  /** False on the replay path, so the caller can skip re-doing side effects. */
  dealIsNew: boolean;
  premium: number;
  itemCount: number;
  policyCount: number;
  policyTypes: string[];
  dealType: string;
  isBundle: boolean;
  soldDate: Date;
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
