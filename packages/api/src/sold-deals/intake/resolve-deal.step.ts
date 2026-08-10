import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { NormalizedLeadSource } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Deal, DealDocument } from '../../deals/schemas/deal.schema';
import type { CreateSoldDealDto } from '../dto/create-sold-deal.dto';
import {
  buildDealTitle,
  deriveAuditTriggers,
  deriveDealAggregates,
  deriveMortgagee,
  resolveLeadSource,
} from './sold.normalize';
import { SoldStepDeps, sessionOptions } from './sold-intake.types';

/**
 * Insert the deal, with every total derived server-side.
 *
 * Legacy wrote seven fields and let SmartSuite rollups do the rest. Mongo has
 * no rollup engine, so the aggregates become explicitly persisted values — and
 * they must be derived identically to the migration or the Sold scorecard
 * (PAC-11) reports two different numbers for the same kind of deal.
 */
@Injectable()
export class ResolveDealStep {
  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
  ) {}

  async run(
    dto: CreateSoldDealDto,
    leadSource: NormalizedLeadSource | undefined,
    deps: SoldStepDeps,
  ): Promise<{
    dealId: Types.ObjectId;
    aggregates: ReturnType<typeof deriveDealAggregates>;
  }> {
    const { ctx } = deps;
    const aggregates = deriveDealAggregates(dto.policies, dto.soldDate);

    const [deal] = await this.dealModel.create(
      [
        {
          agencyId: ctx.agencyId,
          branchId: ctx.branchId,
          title: buildDealTitle(ctx.clientName, ctx.leadId.toString()),
          soldDate: aggregates.soldDate,
          soldDateYmd: aggregates.soldDateYmd,
          premium: aggregates.premium,
          // Honest provenance: these totals were submitted with the deal, not
          // rolled up from linked rows the way a migrated deal's were.
          premiumSource: 'snapshot',
          itemCount: aggregates.itemCount,
          policyCount: aggregates.policyCount,
          dealType: aggregates.dealType,
          isBundle: aggregates.isBundle,
          policyTypes: aggregates.policyTypes,
          leadSource: resolveLeadSource(leadSource),
          clientName: ctx.clientName,
          producerId: ctx.producerId,
          leadId: ctx.leadId,
          householdId: ctx.householdId,
          quoteRecapId: ctx.quoteRecapId,
          primaryContactId: ctx.primaryContactId,
          submissionToken: ctx.submissionToken ?? undefined,
          mortgagee: deriveMortgagee(dto.policies),
          auditTriggers: deriveAuditTriggers(dto.policies),
          // Deliberately unset: `status` and `dealAuditStatus` carry SmartSuite
          // workflow codes whose value/label mapping is genuinely confusing
          // (`backlog` means "Sold"). Nothing in the new app reads them yet, and
          // guessing a code would write an assumption down as fact.
          isTestRecord: false,
        },
      ],
      sessionOptions(deps.session),
    );

    // Tracked so the no-transaction fallback can undo it. Never track a record
    // we merely *matched* — only ones this unit of work created.
    deps.created.track(this.dealModel, deal._id);

    return { dealId: deal._id, aggregates };
  }
}
