import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  InterestedParty,
  InterestedPartyDocument,
} from '../../interested-parties/schemas/interested-party.schema';
import type { SoldIntakeDto } from '../dto/create-sold-deal.dto';
import type { UpsertedPolicy } from './upsert-policies.step';
import { SoldStepDeps, sessionOptions } from './sold-intake.types';

/**
 * The escrow sub-card — the mortgagee on a property policy.
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
    dto: SoldIntakeDto,
    policies: UpsertedPolicy[],
    deps: SoldStepDeps,
  ): Promise<void> {
    const { ctx } = deps;

    /*
     * Keyed by the row that produced each policy, not by array position.
     *
     * This used to be `policies[index]`, which was correct only because
     * `UpsertPoliciesStep` happens to push one result per row — an invariant
     * nothing enforced. Any future filter there would have silently attached a
     * mortgagee to another dwelling, and no downstream reader could have told.
     */
    const byRow = new Map(policies.map((p) => [p.sourceIndex, p]));

    for (const [index, row] of dto.policies.entries()) {
      // `escrow` details are only required — and only meaningful — when the
      // discount was ticked. The DTO already rejects one without the other.
      if (!row.discounts?.escrow || !row.escrow) continue;

      const policy = byRow.get(index);

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
