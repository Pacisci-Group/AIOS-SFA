import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PriorInsurance,
  PriorInsuranceDocument,
} from '../../prior-insurance/schemas/prior-insurance.schema';
import {
  PriorPolicy,
  PriorPolicyDocument,
} from '../../prior-policies/schemas/prior-policy.schema';
import type { CreateSoldDealDto } from '../dto/create-sold-deal.dto';
import { derivePriorCarriers, parseFormDate, yesNo } from './sold.normalize';
import { SoldStepDeps, sessionOptions } from './sold-intake.types';

/**
 * Cards 6 and 7 — prior coverage and its cancellation.
 *
 * These land in **two** collections, which is legacy's shape and worth
 * understanding before changing it:
 *
 *  - `priorInsurance` — one row per deal, with *separate* auto and home carrier
 *    columns plus an "auto & home same carrier?" flag. It is the deal-level
 *    summary the service team reads.
 *  - `priorPolicies` — one row per policy line, carrying that line's carrier and
 *    its own cancellation status. This is what the CRM actually works through.
 *
 * The form captures prior insurance per policy, so the deal-level row is
 * derived (first declared carrier of each kind) rather than asked for twice.
 */
@Injectable()
export class PriorInsuranceStep {
  constructor(
    @InjectModel(PriorInsurance.name)
    private readonly priorInsuranceModel: Model<PriorInsuranceDocument>,
    @InjectModel(PriorPolicy.name)
    private readonly priorPolicyModel: Model<PriorPolicyDocument>,
  ) {}

  async run(
    dto: CreateSoldDealDto,
    dealId: Types.ObjectId,
    deps: SoldStepDeps,
  ): Promise<void> {
    const { ctx } = deps;

    const declared = dto.policies.filter((p) => !p.priorInsurance.none);
    // Every line said "no prior insurance" — a genuinely new-to-market client.
    // Writing an empty summary row would tell the service team there is prior
    // coverage to chase when there is none.
    if (!declared.length) return;

    const carriers = derivePriorCarriers(dto.policies);
    const cancellations = declared
      .filter((p) => p.cancellation.cancelled && p.cancellation.effectiveDate)
      .map((p) => parseFormDate(p.cancellation.effectiveDate as string));
    // Earliest: the date coverage actually lapsed is the one that matters for a
    // gap, and the service team chases from there.
    const earliestCancellation = cancellations.length
      ? new Date(Math.min(...cancellations.map((d) => d.getTime())))
      : undefined;

    const [summary] = await this.priorInsuranceModel.create(
      [
        {
          agencyId: ctx.agencyId,
          branchId: ctx.branchId,
          title: ctx.clientName
            ? `${ctx.clientName} — Prior Insurance`
            : undefined,
          previousCarrierAuto: carriers.auto,
          previousCarrierHome: carriers.home,
          previousAgentName: declared.find((p) =>
            p.priorInsurance.agentName?.trim(),
          )?.priorInsurance.agentName,
          // Legacy stores these yes/no answers as strings, not booleans.
          cancelledPreviousInsurance: yesNo(cancellations.length > 0),
          cancellationDate: earliestCancellation,
          autoHomeSameCarrier: yesNo(carriers.sameCarrier),
          dealId,
          householdId: ctx.householdId,
          producerId: ctx.producerId,
          isTestRecord: false,
        },
      ],
      sessionOptions(deps.session),
    );
    deps.created.track(this.priorInsuranceModel, summary._id);

    for (const policy of declared) {
      const [row] = await this.priorPolicyModel.create(
        [
          {
            agencyId: ctx.agencyId,
            branchId: ctx.branchId,
            title: policy.priorInsurance.carrier,
            policyType: policy.policyType,
            previousCarrier: policy.priorInsurance.carrier,
            // Already cancelled ⇒ nothing to chase. Still on cover ⇒ the CRM
            // has to cancel it, which is the whole point of the row.
            needsCancellation: yesNo(!policy.cancellation.cancelled),
            cancellationStatus: policy.cancellation.cancelled
              ? 'complete'
              : 'backlog',
            cancellationDate: policy.cancellation.effectiveDate
              ? parseFormDate(policy.cancellation.effectiveDate)
              : undefined,
            dealId,
            householdId: ctx.householdId,
            isTestRecord: false,
          },
        ],
        sessionOptions(deps.session),
      );
      deps.created.track(this.priorPolicyModel, row._id);
    }
  }
}
