import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AccessContext } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../../activities/schemas/activity.schema';
import { TransactionRunner } from '../../common/mongo/transaction.runner';
import { Deal, DealDocument } from '../../deals/schemas/deal.schema';
import type { LeadDocument } from '../../leads/schemas/lead.schema';
import type { CreateSoldDealDto } from '../dto/create-sold-deal.dto';
import { AdvanceLeadStep } from './advance-lead.step';
import { InterestedPartiesStep } from './interested-parties.step';
import { PriorInsuranceStep } from './prior-insurance.step';
import { ResolveDealStep } from './resolve-deal.step';
import { SoldIntakeContext, SoldIntakeOutcome } from './sold-intake.types';
import { UpsertPoliciesStep } from './upsert-policies.step';

/** Mongo duplicate-key error. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

/**
 * The sold-deal write pipeline (PAC-40) — a port of legacy's
 * `processSoldLogFromFillout` + `mark-sold`, collapsed into one transaction.
 *
 * ## Why a transaction, unlike the quote recap
 *
 * PAC-39 deliberately skips `TransactionRunner` because a recap is a single
 * insert. A sold deal writes `deals` + N `policies` + `priorInsurance` + N
 * `priorPolicies`; a partial write orphans policies against no deal and leaves
 * the household's premium double-counted. That is exactly what the runner is
 * for.
 *
 * ## What legacy did that we do not
 *
 * Fillout subforms wrote the child rows themselves, each stamped with the
 * submission token, and the webhook only *back-linked* them afterwards. We
 * receive the whole policy array in one request, so we create the children
 * directly and the token-reconciliation dance disappears.
 */
@Injectable()
export class SoldDealIntakeService {
  private readonly logger = new Logger(SoldDealIntakeService.name);

  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    private readonly transactions: TransactionRunner,
    private readonly deals: ResolveDealStep,
    private readonly policies: UpsertPoliciesStep,
    private readonly priorInsurance: PriorInsuranceStep,
    private readonly interestedParties: InterestedPartiesStep,
    private readonly leads: AdvanceLeadStep,
  ) {}

  async process(
    ctx: SoldIntakeContext,
    dto: CreateSoldDealDto,
    access: AccessContext,
    lead: LeadDocument,
  ): Promise<SoldIntakeOutcome> {
    // Probe BEFORE opening a transaction, the same reasoning as lead intake: a
    // replay should not re-run policy upserts or re-derive anything.
    if (ctx.submissionToken) {
      const replay = await this.findByToken(ctx.agencyId, ctx.submissionToken);
      if (replay) return replay;
    }

    try {
      const outcome = await this.transactions.run(async (session, created) => {
        const deps = { ctx, session, created };

        const { dealId, aggregates } = await this.deals.run(
          dto,
          lead.leadSource,
          deps,
        );
        const policies = await this.policies.run(dto, dealId, access, deps);
        await this.priorInsurance.run(dto, dealId, deps);
        // After the policies: an escrow row links to the policy it secures.
        await this.interestedParties.run(dto, policies, deps);

        return {
          dealId,
          dealIsNew: true,
          premium: aggregates.premium,
          itemCount: aggregates.itemCount,
          policyCount: aggregates.policyCount,
          policyTypes: aggregates.policyTypes,
          dealType: aggregates.dealType,
          isBundle: aggregates.isBundle,
          soldDate: aggregates.soldDate,
        } satisfies SoldIntakeOutcome;
      });

      return outcome;
    } catch (error) {
      // A concurrent double-submit — two in-flight requests with the same token
      // — loses the race on the unique `{agencyId, submissionToken}` index.
      // This CANNOT be handled inside the transaction: E11000 is not transient,
      // so `withTransaction` does not retry it and the session is already
      // aborted by the time we see it. Re-reading here is what makes "a
      // double-submit books one deal" true under real concurrency rather than
      // only for a sequential retry.
      if (isDuplicateKeyError(error) && ctx.submissionToken) {
        const winner = await this.findByToken(
          ctx.agencyId,
          ctx.submissionToken,
        );
        if (winner) return winner;
      }
      throw error;
    }
  }

  /**
   * Advance the lead and record the timeline entry.
   *
   * Post-commit and best-effort, each independently: the deal is the only
   * irreplaceable thing in the request, and rolling it back because a timeline
   * row failed would fail in the wrong direction. Same precedent as
   * `LeadIntakeService.recordCreatedActivity`.
   */
  async recordSideEffects(
    ctx: SoldIntakeContext,
    outcome: SoldIntakeOutcome,
  ): Promise<{ leadStatus: string }> {
    const leadStatus = await this.leads.run(ctx.leadId, ctx.agencyId);

    if (outcome.dealIsNew) {
      try {
        await this.activityModel.create({
          agencyId: ctx.agencyId,
          branchId: ctx.branchId,
          type: 'sold',
          subjectType: 'deal',
          leadId: ctx.leadId,
          dealId: outcome.dealId,
          producerId: ctx.producerId,
          occurredAt: outcome.soldDate,
          summary: 'Deal marked as sold',
          // Explicit: `source` defaults to 'migration', so omitting it would
          // label an app-created activity as migrated.
          source: 'internal',
          isTestRecord: false,
        });
      } catch (error) {
        this.logger.error(
          `Failed to record sold activity for deal ${outcome.dealId.toString()}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return { leadStatus };
  }

  private async findByToken(
    agencyId: string,
    token: string,
  ): Promise<SoldIntakeOutcome | null> {
    const existing = await this.dealModel
      .findOne({ agencyId, submissionToken: token })
      .select(
        '_id premium itemCount policyCount policyTypes dealType isBundle soldDate producerId branchId',
      );
    if (!existing) return null;

    return {
      dealId: existing._id,
      dealIsNew: false,
      premium: existing.premium,
      itemCount: existing.itemCount,
      policyCount: existing.policyCount,
      policyTypes: existing.policyTypes,
      dealType: existing.dealType,
      isBundle: existing.isBundle,
      soldDate: existing.soldDate ?? new Date(),
    };
  }

  /** The replay path needs the stored deal to run the ownership clamp against. */
  async loadByToken(
    agencyId: string,
    token: string,
  ): Promise<DealDocument | null> {
    return this.dealModel.findOne({ agencyId, submissionToken: token });
  }

  /** Used by the caller to attach generation/CRM telemetry post-commit. */
  async stampTelemetry(
    dealId: Types.ObjectId,
    update: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.dealModel.updateOne({ _id: dealId }, { $set: update });
    } catch (error) {
      this.logger.error(
        `Failed to stamp telemetry on deal ${dealId.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
