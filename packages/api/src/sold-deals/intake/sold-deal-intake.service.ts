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
import {
  Household,
  HouseholdDocument,
} from '../../households/schemas/household.schema';
import { Policy, PolicyDocument } from '../../policies/schemas/policy.schema';
import type { SoldIntakeDto } from '../dto/create-sold-deal.dto';
import { AdvanceLeadStep } from './advance-lead.step';
import { InterestedPartiesStep } from './interested-parties.step';
import { PriorInsuranceStep } from './prior-insurance.step';
import { ResolveDealStep } from './resolve-deal.step';
import {
  SoldIntakeContext,
  SoldIntakeOutcome,
  SoldStepDeps,
} from './sold-intake.types';
import { UpsertPoliciesStep, UpsertedPolicy } from './upsert-policies.step';

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
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    private readonly transactions: TransactionRunner,
    private readonly deals: ResolveDealStep,
    private readonly policies: UpsertPoliciesStep,
    private readonly priorInsurance: PriorInsuranceStep,
    private readonly interestedParties: InterestedPartiesStep,
    private readonly leads: AdvanceLeadStep,
  ) {}

  /**
   * `leadSourceId` rather than the lead document: it is the only field of the
   * lead this pipeline ever read, and taking the narrower input is what lets a
   * leadless policy transfer run the identical steps. A transfer passes
   * `undefined`, and the deal simply carries no source.
   */
  async process(
    ctx: SoldIntakeContext,
    dto: SoldIntakeDto,
    access: AccessContext,
    leadSourceId: Types.ObjectId | undefined,
    /**
     * Extra work to commit **with** the deal, run after every step inside the
     * same transaction.
     *
     * Exists for the Cancel Rewrite chargeback, which is money: a replacement
     * written but a claw-back lost would take a producer's credit and never give
     * it back, and nothing would ever notice. Every other post-submission side
     * effect here (audit generation, the household recount, the ticket timeline)
     * is deliberately best-effort post-commit, because re-running it is cheap
     * and failing the request would tell a CSR their work did not happen when it
     * did. A ledger row is the one thing that is neither.
     *
     * A callback rather than another step so the shared pipeline keeps knowing
     * nothing about chargebacks — the two write paths that use it have no such
     * concept, and a step that no-ops for both of them is a step in the wrong
     * module.
     */
    afterSteps?: (
      deps: SoldStepDeps,
      policies: UpsertedPolicy[],
      dealId: Types.ObjectId,
    ) => Promise<void>,
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
          leadSourceId,
          deps,
        );
        const policies = await this.policies.run(dto, dealId, access, deps);
        await this.priorInsurance.run(dto, dealId, deps);
        // After the policies: an escrow row links to the policy it secures.
        await this.interestedParties.run(dto, policies, deps);
        // Last, so a caller's extra write sees everything the steps produced.
        await afterSteps?.(deps, policies, dealId);

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
   *
   * The household recount runs first and for **every** deal, lead or not. The
   * other two are lead-scoped: there is no lead to advance on a leadless
   * booking.
   *
   * **A Company Transfer writes no `sold` activity.** It runs through a lead
   * now (PAC-126), but it is not a sale — a package change within the client's
   * own book, kept off the leaderboard for that reason — and `ACTIVITY_TYPES`
   * has no member meaning "transferred". Writing a `sold` row for it would be
   * worse than nothing: the feed and every "sold" activity count would read a
   * transfer as new business. The deal itself, `businessType: company_transfer`,
   * is on the lead page regardless. The lead *is* still advanced: it was
   * created for this one action, `Sold` is the pipeline's "done, with a deal"
   * state, and leaving it open would list a finished lead as workable forever.
   * A rewrite keeps the row — it books genuine new business.
   */
  async recordSideEffects(
    ctx: SoldIntakeContext,
    outcome: SoldIntakeOutcome,
  ): Promise<{ leadStatus: string | null }> {
    await this.recountHouseholdPolicies(ctx.householdId);

    if (!ctx.leadId) {
      return { leadStatus: null };
    }
    const leadId = ctx.leadId;
    const leadStatus = await this.leads.run(leadId, ctx.agencyId);

    if (outcome.dealIsNew && ctx.replacementReason !== 'company_transfer') {
      try {
        await this.activityModel.create({
          agencyId: ctx.agencyId,
          branchId: ctx.branchId,
          type: 'sold',
          subjectType: 'deal',
          leadId,
          dealId: outcome.dealId,
          userId: ctx.producerId,
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

  /**
   * Bring `Household.totalActivePolicies` back in line with reality.
   *
   * Lived on the ticket-anchored transfer until PAC-126 retired it, which
   * meant the **sold path never recounted at all** — every ordinary sale left
   * the stored count where the migration put it. The household card computes
   * its headline from the live policy list so nobody saw it there, but the
   * Clients list sorts on the stored field, and a replacement that splits one
   * policy into two moves it. It belongs here, where every booking passes.
   *
   * Recounted rather than incremented so a re-run is still correct, and
   * best-effort like the activity row: the deal is committed by now, and a
   * stale count is a worse reason to fail a request than no reason.
   */
  private async recountHouseholdPolicies(
    householdId: Types.ObjectId,
  ): Promise<void> {
    try {
      const active = await this.policyModel.countDocuments({
        householdId,
        active: true,
      });
      await this.householdModel.updateOne(
        { _id: householdId },
        { $set: { totalActivePolicies: active } },
      );
    } catch (error) {
      this.logger.warn(
        `Household policy recount failed for ${householdId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
