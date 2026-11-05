import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Branch, type BranchDocument } from '../branches/schemas/branch.schema';
import { Carrier } from '../carriers/schemas/carrier.schema';
import { Chargeback } from '../chargebacks/schemas/chargeback.schema';
import type { PayoutModels } from '../common/payouts/generate-run';
import { Contact } from '../contacts/schemas/contact.schema';
import { DealAudit } from '../deal-audits/schemas/deal-audit.schema';
import { Deal } from '../deals/schemas/deal.schema';
import { Household } from '../households/schemas/household.schema';
import { LeadSource } from '../lead-sources/schemas/lead-source.schema';
import { UserRole } from '../permissions/schemas/user-role.schema';
import { Agency } from '../platform/schemas/agency.schema';
import { Policy } from '../policies/schemas/policy.schema';
import {
  AgencyRole,
  type AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, type UserDocument } from '../users/schemas/user.schema';
import { PaymentStructure } from './schemas/payment-structure.schema';
import { PayoutRun } from './schemas/payout-run.schema';
import { PayStatement } from './schemas/pay-statement.schema';

/**
 * The models the statement engine reads, as the one bag
 * `common/payouts/generate-run.ts` takes — the same bag the monthly job
 * builds in the worker, so the API and the job cannot read different
 * collections.
 */
@Injectable()
export class PayoutModelsService {
  readonly models: PayoutModels;

  constructor(
    @InjectModel(Agency.name) agency: Model<Agency>,
    @InjectModel(Deal.name) deal: Model<Deal>,
    @InjectModel(Policy.name) policy: Model<Policy>,
    @InjectModel(Chargeback.name) chargeback: Model<Chargeback>,
    @InjectModel(DealAudit.name) dealAudit: Model<DealAudit>,
    @InjectModel(Household.name) household: Model<Household>,
    @InjectModel(Contact.name) contact: Model<Contact>,
    @InjectModel(Carrier.name) carrier: Model<Carrier>,
    @InjectModel(LeadSource.name) leadSource: Model<LeadSource>,
    @InjectModel(PaymentStructure.name)
    paymentStructure: Model<PaymentStructure>,
    @InjectModel(PayoutRun.name) payoutRun: Model<PayoutRun>,
    @InjectModel(PayStatement.name) payStatement: Model<PayStatement>,
    @InjectModel(User.name) user: Model<UserDocument>,
    @InjectModel(AgencyRole.name) role: Model<AgencyRoleDocument>,
    @InjectModel(UserRole.name) userRole: Model<UserRole>,
    @InjectModel(Branch.name) branch: Model<BranchDocument>,
  ) {
    this.models = {
      agency,
      deal,
      policy,
      chargeback,
      dealAudit,
      household,
      contact,
      carrier,
      leadSource,
      paymentStructure,
      payoutRun,
      payStatement,
      user,
      role,
      userRole,
      branch,
    };
  }
}
