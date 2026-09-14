import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AccessContext } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { TransactionRunner } from '../../common/mongo/transaction.runner';
import { Deal, DealDocument } from '../../deals/schemas/deal.schema';
import { Policy, PolicyDocument } from '../../policies/schemas/policy.schema';
import type { SoldIntakeDto } from '../dto/create-sold-deal.dto';
import { InterestedPartiesStep } from './interested-parties.step';
import { PriorInsuranceStep } from './prior-insurance.step';
import {
  deriveAuditTriggers,
  deriveMortgagee,
  derivePersistedDealAggregates,
  mergeAuditTriggers,
  type PersistedDealAggregates,
  type PersistedPolicyTotals,
} from './sold.normalize';
import { SoldIntakeContext, sessionOptions } from './sold-intake.types';
import { UpsertPoliciesStep } from './upsert-policies.step';

export interface SoldDealAmendmentOutcome {
  /** The token had already been applied, and nothing was written. */
  replayed: boolean;
  addedPolicyIds: Types.ObjectId[];
  /** The deal's recomputed roll-ups, or `null` on a replay. */
  totals: PersistedDealAggregates | null;
}

/**
 * Thrown inside the transaction when the addition's token is already on the
 * deal. Throwing is what aborts the transaction, so whatever this attempt had
 * written is rolled back rather than committed a second time.
 */
class AdditionAlreadyApplied extends Error {
  constructor() {
    super('This policy addition has already been applied.');
  }
}

/**
 * Add policies to a deal that is already booked (PAC-104).
 *
 * ## The create pipeline's steps, against a deal that exists
 *
 * `SoldDealIntakeService.process` opens with `ResolveDealStep`, which **inserts**
 * a deal — its title, lead source, `premiumSource` and totals are all
 * create-only. Rather than fork that step on a flag, this is a second entry
 * point that skips it and runs the three steps that only ever read the policy
 * rows: `UpsertPoliciesStep` and `InterestedPartiesStep` unchanged, and
 * `PriorInsuranceStep` through its merge variant (a deal has one summary row,
 * which an addition must not duplicate).
 *
 * ## What it writes to the deal
 *
 * Totals are **recomputed from the stored policies**, not added to: the same
 * `derivePersistedDealAggregates` that `PATCH /policies/:id` uses, so the two
 * edit paths cannot disagree about what a deal adds up to. Audit triggers and
 * the mortgagee flag are OR-ed in, since the stored per-policy discounts have
 * changed shape over time and cannot be re-derived reliably.
 *
 * `premiumSource` becomes `snapshot` even on a migrated deal. Its totals are now
 * this app's own roll-up (decided with the product owner), and leaving the
 * migrated marker would stop every later per-policy correction from keeping
 * them in step — `recomputeDealTotals` only recomputes a `snapshot` deal.
 *
 * ## Idempotency
 *
 * The token guard and the totals write are **one conditional update, done
 * last**: `policyAdditionTokens: { $ne: token }` with a `$push` of the token. A
 * concurrent duplicate write-conflicts on the deal document, `withTransaction`
 * retries it, and the retry finds the token and aborts — so a double-click adds
 * one set of policies under real concurrency, not only on a sequential retry.
 * Additions with *different* tokens queue on the same write the same way, which
 * is what stops two of them from losing each other's totals.
 */
@Injectable()
export class SoldDealAmendmentService {
  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    private readonly transactions: TransactionRunner,
    private readonly policies: UpsertPoliciesStep,
    private readonly priorInsurance: PriorInsuranceStep,
    private readonly interestedParties: InterestedPartiesStep,
  ) {}

  /**
   * `ctx` is built from the **deal** by the caller — its producer, branch, lead
   * and household — never from whoever is making the request.
   */
  async addPolicies(
    ctx: SoldIntakeContext,
    dealId: Types.ObjectId,
    dto: SoldIntakeDto,
    access: AccessContext,
  ): Promise<SoldDealAmendmentOutcome> {
    const token = ctx.submissionToken;
    if (!token) {
      // The DTO requires one; reaching here without it is a programming error.
      throw new Error('A policy addition needs a submission token.');
    }

    try {
      return await this.transactions.run(async (session, created) => {
        const deps = { ctx, session, created };

        const current = await this.dealModel
          .findOne({ _id: dealId, agencyId: ctx.agencyId })
          .select('auditTriggers mortgagee policyAdditionTokens')
          .session(session);
        if (!current) throw new NotFoundException('Deal not found.');
        if (current.policyAdditionTokens?.includes(token)) {
          throw new AdditionAlreadyApplied();
        }

        const upserted = await this.policies.run(dto, dealId, access, deps);
        await this.priorInsurance.runForExistingDeal(dto, dealId, deps);
        // After the policies: an escrow row links to the policy it secures.
        await this.interestedParties.run(dto, upserted, deps);

        const stored = await this.policyModel
          .find({
            agencyId: ctx.agencyId,
            dealId,
            isTestRecord: { $ne: true },
          })
          .select('policyType premium items')
          .session(session)
          .lean<PersistedPolicyTotals[]>();
        const totals = derivePersistedDealAggregates(stored);

        const result = await this.dealModel.updateOne(
          {
            _id: dealId,
            agencyId: ctx.agencyId,
            policyAdditionTokens: { $ne: token },
          },
          {
            $set: {
              ...totals,
              auditTriggers: mergeAuditTriggers(
                current.auditTriggers,
                deriveAuditTriggers(dto.policies),
              ),
              mortgagee:
                current.mortgagee === true || deriveMortgagee(dto.policies),
              premiumSource: 'snapshot',
            },
            $push: { policyAdditionTokens: token },
          },
          sessionOptions(session),
        );
        if (result.matchedCount === 0) throw new AdditionAlreadyApplied();

        return {
          replayed: false,
          addedPolicyIds: upserted.map((policy) => policy.policyId),
          totals,
        };
      });
    } catch (error) {
      if (error instanceof AdditionAlreadyApplied) {
        return { replayed: true, addedPolicyIds: [], totals: null };
      }
      throw error;
    }
  }
}
