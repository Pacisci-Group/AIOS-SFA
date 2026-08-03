import { ClientSession, Types } from 'mongoose';
import type { CreatedRegistry } from '../../common/mongo/transaction.runner';
import type { CreateSoldDealDto } from '../dto/create-sold-deal.dto';

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
  leadId: Types.ObjectId;
  householdId: Types.ObjectId;
  quoteRecapId?: Types.ObjectId;
  primaryContactId?: Types.ObjectId;
  clientName?: string;
  /** Namespaced (`SOLD|…`) or null when the client sent no token. */
  submissionToken: string | null;
}

/** Threaded through every step so they share one session and one registry. */
export interface SoldStepDeps {
  ctx: SoldIntakeContext;
  session: ClientSession | null;
  created: CreatedRegistry;
}

export interface SoldIntakeInput {
  dto: CreateSoldDealDto;
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
