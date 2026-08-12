import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DataScope } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Deal, DealDocument } from '../../deals/schemas/deal.schema';
import { normalizePolicyNumber } from '../../policies/policy-number';
import { Policy, PolicyDocument } from '../../policies/schemas/policy.schema';
import type { SoldIntakeDto } from '../dto/create-sold-deal.dto';
import { parseFormDate } from './sold.normalize';
import { SoldStepDeps, sessionOptions } from './sold-intake.types';

/** What one policy row resolved to, for the steps that link to it. */
export interface UpsertedPolicy {
  policyId: Types.ObjectId;
  policyType: string;
  isNew: boolean;
  /**
   * Which `dto.policies` row produced this, so downstream steps can look the
   * policy up by row rather than by array position.
   *
   * The loop below pushes exactly one result per row with no `continue`, so
   * position *happens* to line up today — but nothing enforced that, and
   * `InterestedPartiesStep` was zipping the two arrays on the assumption. The
   * failure mode is silent and serious: any future filter here would attach an
   * escrow mortgagee to the wrong dwelling, with nothing downstream able to
   * tell. Carrying the index makes the coupling explicit instead of emergent.
   */
  sourceIndex: number;
}

/**
 * Create a policy per row — or re-point an existing one when the producer
 * confirmed the duplicate check's match.
 *
 * The re-point path is why `GET /policies/check` exists: without it a re-entered
 * sale silently doubles the household's policy count and the deal's premium.
 */
@Injectable()
export class UpsertPoliciesStep {
  constructor(
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
  ) {}

  async run(
    dto: SoldIntakeDto,
    dealId: Types.ObjectId,
    access: AccessContext,
    deps: SoldStepDeps,
  ): Promise<UpsertedPolicy[]> {
    const { ctx } = deps;
    const results: UpsertedPolicy[] = [];

    for (const [sourceIndex, row] of dto.policies.entries()) {
      // On the transfer path the row names the policy it replaces. Retire it
      // *before* writing the replacement so a failed retire aborts the whole
      // transaction rather than leaving two active policies for one coverage.
      const retiredId = row.fromPolicyId
        ? await this.retireTransferred(row.fromPolicyId, deps)
        : null;

      const shared = {
        policyNumber: row.policyNumber,
        policyNumberKey: normalizePolicyNumber(row.policyNumber) ?? undefined,
        policyType: row.policyType,
        carrier: row.carrier,
        effectiveDate: parseFormDate(row.effectiveDate),
        premium: row.premium,
        items: row.itemCount,
        active: true,
        policyStatus: 'Active',
        discounts: row.discounts,
        // `uploadedAt` is stamped here, not taken from the client (PAC-56 #23).
        newBusinessApplication: {
          ...row.newBusinessApplication,
          uploadedAt: new Date(),
        },
        householdId: ctx.householdId,
        dealId,
        transferredFromPolicyId: retiredId,
      };

      if (row.existingPolicyId) {
        const policyId = await this.repointExisting(
          row.existingPolicyId,
          shared,
          access,
          deps,
        );
        await this.linkRetired(retiredId, policyId, deps);
        results.push({
          policyId,
          policyType: row.policyType,
          isNew: false,
          sourceIndex,
        });
        continue;
      }

      const [policy] = await this.policyModel.create(
        [
          {
            agencyId: ctx.agencyId,
            branchId: ctx.branchId,
            ...shared,
            isTestRecord: false,
          },
        ],
        sessionOptions(deps.session),
      );
      deps.created.track(this.policyModel, policy._id);
      await this.linkRetired(retiredId, policy._id, deps);
      results.push({
        policyId: policy._id,
        policyType: row.policyType,
        isNew: true,
        sourceIndex,
      });
    }

    return results;
  }

  /**
   * Retire the policy a transfer replaces.
   *
   * Deactivated rather than deleted: the client genuinely held it, and the
   * household's history — and any audit or ticket that referenced it — has to
   * survive the move. `active: false` is also what keeps the household's
   * premium total and active-policy count honest once the replacement lands.
   *
   * The household check is the real gate. `fromPolicyId` comes straight from the
   * client, and the transfer's only scope clamp is the *ticket*; without this a
   * CSR could retire any policy in the agency by naming its id.
   */
  private async retireTransferred(
    fromPolicyId: string,
    deps: SoldStepDeps,
  ): Promise<Types.ObjectId> {
    const { ctx } = deps;

    const existing = await this.policyModel
      .findOne({
        _id: new Types.ObjectId(fromPolicyId),
        agencyId: ctx.agencyId,
      })
      .session(deps.session);

    if (!existing) {
      throw new NotFoundException('That policy could not be found.');
    }

    if (String(existing.householdId ?? '') !== ctx.householdId.toString()) {
      throw new BadRequestException(
        'That policy belongs to a different household and cannot be transferred here.',
      );
    }

    await this.policyModel.updateOne(
      { _id: existing._id, agencyId: ctx.agencyId },
      { $set: { active: false, policyStatus: 'Cancelled' } },
      sessionOptions(deps.session),
    );

    // Deliberately NOT tracked in `created` — the compensating-delete fallback
    // would destroy a policy that existed long before this submission.
    return existing._id;
  }

  /** Close the loop: point the retired policy forward at its replacement. */
  private async linkRetired(
    retiredId: Types.ObjectId | null,
    replacementId: Types.ObjectId,
    deps: SoldStepDeps,
  ): Promise<void> {
    if (!retiredId) return;
    await this.policyModel.updateOne(
      { _id: retiredId, agencyId: deps.ctx.agencyId },
      { $set: { transferredToPolicyId: replacementId } },
      sessionOptions(deps.session),
    );
  }

  /**
   * Re-point a policy the producer identified as the same one.
   *
   * ⚠ Both checks below are load-bearing. `existingPolicyId` comes straight
   * from the client, and `GET /policies/check` deliberately reports
   * *out-of-scope* matches (masked) so a producer can be warned about a
   * colleague's duplicate. Without re-validation here, that id would let a
   * producer attach another producer's policy — and its premium — to their own
   * deal. The check endpoint informs; it does not authorize.
   */
  private async repointExisting(
    existingPolicyId: string,
    update: Record<string, unknown>,
    access: AccessContext,
    deps: SoldStepDeps,
  ): Promise<Types.ObjectId> {
    const { ctx } = deps;

    const existing = await this.policyModel
      .findOne({
        _id: new Types.ObjectId(existingPolicyId),
        agencyId: ctx.agencyId,
      })
      .session(deps.session);

    if (!existing) {
      throw new NotFoundException('That policy could not be found.');
    }

    if (access.dataScope === DataScope.Own) {
      // A policy carries no producer of its own; ownership is its deal's.
      const owner = existing.dealId
        ? await this.dealModel
            .findOne({ _id: existing.dealId, agencyId: ctx.agencyId })
            .select('producerId')
            .session(deps.session)
        : null;

      const ownerId = owner?.producerId?.toString();
      // An unattached policy (migrated, never sold through the app) has no
      // owner to conflict with, so claiming it is allowed. One already on
      // another producer's deal is not.
      if (ownerId && ownerId !== access.userId) {
        throw new ForbiddenException(
          'That policy belongs to another producer and cannot be linked to this deal.',
        );
      }
    }

    await this.policyModel.updateOne(
      { _id: existing._id, agencyId: ctx.agencyId },
      { $set: update },
      sessionOptions(deps.session),
    );

    // Deliberately NOT tracked in `created`: the compensating-delete fallback
    // would destroy a pre-existing policy on failure.
    return existing._id;
  }
}
