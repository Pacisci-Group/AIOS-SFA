import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  InterestedParty,
  InterestedPartyDocument,
} from '../../interested-parties/schemas/interested-party.schema';
import type { CreateSoldDealDto } from '../dto/create-sold-deal.dto';
import type { UpsertedPolicy } from './upsert-policies.step';
import { SoldStepDeps, sessionOptions } from './sold-intake.types';

/**
 * Card 5's escrow sub-card — the mortgagee on a property policy.
 *
 * Legacy stored this in its own **Interested Parties** table rather than on the
 * deal, and the same split is kept: escrow is a fact about one policy (a
 * lender's interest in a specific dwelling), not about the sale. A bundled
 * Auto + Home + Landlord deal can have two mortgagees with different loan
 * numbers, which a deal-level field could not express.
 *
 * The deal's `mortgagee` boolean is separate and derived — it is what gates the
 * `Home Mortgagee` / `Landlord Mortgagee` audit items, while these rows carry
 * the detail the service team actually verifies.
 */
@Injectable()
export class InterestedPartiesStep {
  constructor(
    @InjectModel(InterestedParty.name)
    private readonly interestedPartyModel: Model<InterestedPartyDocument>,
  ) {}

  async run(
    dto: CreateSoldDealDto,
    policies: UpsertedPolicy[],
    deps: SoldStepDeps,
  ): Promise<void> {
    const { ctx } = deps;

    for (const [index, row] of dto.policies.entries()) {
      // `escrow` details are only required — and only meaningful — when the
      // discount was ticked. The DTO already rejects one without the other.
      if (!row.discounts?.escrow || !row.escrow) continue;

      const policy = policies[index];

      const [party] = await this.interestedPartyModel.create(
        [
          {
            agencyId: ctx.agencyId,
            branchId: ctx.branchId,
            title: row.escrow.companyName,
            mortgagee: row.escrow.companyName,
            loanNumber: row.escrow.loanNumber,
            address: { ...row.escrow.address },
            // Not "verified" — that is exactly what the generated
            // `Home/Landlord Mortgagee` audit item asks the service team to do.
            status: 'backlog',
            policyId: policy?.policyId,
            householdId: ctx.householdId,
            isTestRecord: false,
          },
        ],
        sessionOptions(deps.session),
      );

      deps.created.track(this.interestedPartyModel, party._id);
    }
  }
}
