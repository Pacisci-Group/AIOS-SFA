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
import type {
  SoldIntakeDto,
  SoldIntakePolicy,
} from '../dto/create-sold-deal.dto';
import {
  derivePriorCarriers,
  mergePriorInsuranceSummary,
  parseFormDate,
  yesNo,
  type PriorInsuranceSummary,
} from './sold.normalize';
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
    dto: SoldIntakeDto,
    dealId: Types.ObjectId,
    deps: SoldStepDeps,
  ): Promise<void> {
    const declared = declaredPolicies(dto);
    // Every line said "no prior insurance" — a genuinely new-to-market client.
    // Writing an empty summary row would tell the service team there is prior
    // coverage to chase when there is none.
    if (!declared.length) return;

    await this.createSummary(
      this.deriveSummary(dto, declared, deps),
      dealId,
      deps,
    );
    await this.createPriorPolicies(declared, dealId, deps);
  }

  /**
   * The same records, for policies added to a deal that is already booked
   * (PAC-104).
   *
   * **Merges into the deal's existing summary row rather than writing a
   * second.** The summary is one row per deal, and Lead Detail reads it with an
   * unsorted `findOne({ agencyId, dealId })` — a second row would make which one
   * the page shows an accident of storage order. The merge only fills what the
   * deal does not already say (see `mergePriorInsuranceSummary`). A deal whose
   * original policies all said "no prior insurance" has no row yet, and gets
   * one exactly as on create. The per-line `priorPolicies` rows are appended
   * either way.
   */
  async runForExistingDeal(
    dto: SoldIntakeDto,
    dealId: Types.ObjectId,
    deps: SoldStepDeps,
  ): Promise<void> {
    const declared = declaredPolicies(dto);
    if (!declared.length) return;

    const { ctx } = deps;
    const incoming = this.deriveSummary(dto, declared, deps);

    const existing = await this.priorInsuranceModel
      .findOne({ agencyId: ctx.agencyId, dealId })
      .sort({ _id: 1 })
      .session(deps.session);

    if (existing) {
      const merged = mergePriorInsuranceSummary(
        {
          previousCarrierAuto: existing.previousCarrierAuto,
          previousCarrierHome: existing.previousCarrierHome,
          previousAgentName: existing.previousAgentName,
          cancelledPreviousInsurance: existing.cancelledPreviousInsurance,
          cancellationDate: existing.cancellationDate,
          cancellationResponsibility: existing.cancellationResponsibility,
          cancellationHandledByUserId: existing.cancellationHandledByUserId,
          cancellationHandledByName: existing.cancellationHandledByName,
          autoHomeSameCarrier: existing.autoHomeSameCarrier,
        },
        incoming,
      );
      await this.priorInsuranceModel.updateOne(
        { _id: existing._id, agencyId: ctx.agencyId },
        { $set: definedFields(merged) },
        sessionOptions(deps.session),
      );
    } else {
      await this.createSummary(incoming, dealId, deps);
    }

    await this.createPriorPolicies(declared, dealId, deps);
  }

  /** The deal-level summary of the declared policies in one submission. */
  private deriveSummary(
    dto: SoldIntakeDto,
    declared: SoldIntakePolicy[],
    deps: SoldStepDeps,
  ): PriorInsuranceSummary {
    const carriers = derivePriorCarriers(dto.policies);
    const cancellations = declared
      .filter((p) => p.cancellation.cancelled && p.cancellation.effectiveDate)
      .map((p) => parseFormDate(p.cancellation.effectiveDate as string));
    // Earliest: the date coverage actually lapsed is the one that matters for a
    // gap, and the service team chases from there.
    const earliestCancellation = cancellations.length
      ? new Date(Math.min(...cancellations.map((d) => d.getTime())))
      : undefined;

    // The first declared policy that named someone. One deal, one answer — the
    // wizard asks per policy because the cancellation date can differ per line.
    const cancelledBy = declared.find(
      (p) => p.cancellation?.cancelled && p.cancellation.cancelledBy,
    )?.cancellation;

    return {
      previousCarrierAuto: carriers.auto,
      previousCarrierHome: carriers.home,
      previousAgentName: declared.find((p) =>
        p.priorInsurance.agentName?.trim(),
      )?.priorInsurance.agentName,
      // Legacy stores these yes/no answers as strings, not booleans.
      cancelledPreviousInsurance: yesNo(cancellations.length > 0),
      cancellationDate: earliestCancellation,
      // Who cancelled it (PAC-65 #11). Taken from the first declared policy
      // that answered, exactly as `previousAgentName` above is — this summary
      // row is per deal, and the wizard asks per policy.
      cancellationResponsibility: cancelledBy?.cancelledBy,
      cancellationHandledByUserId: cancelledBy?.cancelledByUserId
        ? new Types.ObjectId(cancelledBy.cancelledByUserId)
        : undefined,
      cancellationHandledByName: cancelledBy?.cancelledByUserId
        ? deps.ctx.staffNameById?.get(cancelledBy.cancelledByUserId)
        : undefined,
      autoHomeSameCarrier: yesNo(carriers.sameCarrier),
    };
  }

  private async createSummary(
    summary: PriorInsuranceSummary,
    dealId: Types.ObjectId,
    deps: SoldStepDeps,
  ): Promise<void> {
    const { ctx } = deps;

    const [row] = await this.priorInsuranceModel.create(
      [
        {
          agencyId: ctx.agencyId,
          branchId: ctx.branchId,
          title: ctx.clientName
            ? `${ctx.clientName} — Prior Insurance`
            : undefined,
          ...summary,
          dealId,
          householdId: ctx.householdId,
          producerId: ctx.producerId,
          isTestRecord: false,
        },
      ],
      sessionOptions(deps.session),
    );
    deps.created.track(this.priorInsuranceModel, row._id);
  }

  private async createPriorPolicies(
    declared: SoldIntakePolicy[],
    dealId: Types.ObjectId,
    deps: SoldStepDeps,
  ): Promise<void> {
    const { ctx } = deps;

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

/** The policy lines that declared prior coverage. */
function declaredPolicies(dto: SoldIntakeDto): SoldIntakePolicy[] {
  return dto.policies.filter((p) => !p.priorInsurance.none);
}

/**
 * Drop `undefined` keys before a `$set`, so a field the merge left empty is
 * left alone in storage rather than written as an explicit absence.
 */
function definedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>;
}
