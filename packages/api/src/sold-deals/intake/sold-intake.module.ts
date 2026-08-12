import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../../activities/schemas/activity.schema';
import { CarriersModule } from '../../carriers/carriers.module';
import { Deal, DealSchema } from '../../deals/schemas/deal.schema';
import {
  InterestedParty,
  InterestedPartySchema,
} from '../../interested-parties/schemas/interested-party.schema';
import { Lead, LeadSchema } from '../../leads/schemas/lead.schema';
import { Policy, PolicySchema } from '../../policies/schemas/policy.schema';
import {
  PriorInsurance,
  PriorInsuranceSchema,
} from '../../prior-insurance/schemas/prior-insurance.schema';
import {
  PriorPolicy,
  PriorPolicySchema,
} from '../../prior-policies/schemas/prior-policy.schema';
import { AdvanceLeadStep } from './advance-lead.step';
import { InterestedPartiesStep } from './interested-parties.step';
import { PriorInsuranceStep } from './prior-insurance.step';
import { ResolveDealStep } from './resolve-deal.step';
import { SoldDealIntakeService } from './sold-deal-intake.service';
import { SoldSubmissionValidator } from './sold-submission.validator';
import { UpsertPoliciesStep } from './upsert-policies.step';

/**
 * The policy-writing pipeline, on its own so **two** modules can drive it.
 *
 * Split out of `SoldDealsModule` when Policy Transfer arrived: `CrmModule` needs
 * the same intake, but `SoldDealsModule` already imports `CrmModule` (for
 * `LeadTicketsService`), so importing it back would close a cycle. This module
 * deliberately imports **no feature module** — only schemas and the carrier
 * catalog — which is what keeps it safe for both to depend on.
 *
 * `StorageService` and `TransactionRunner` come from the global StorageModule /
 * MongoModule.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: PriorInsurance.name, schema: PriorInsuranceSchema },
      { name: PriorPolicy.name, schema: PriorPolicySchema },
      { name: InterestedParty.name, schema: InterestedPartySchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
    // Each carrier's policy-number rule, enforced before the transaction opens.
    CarriersModule,
  ],
  providers: [
    SoldDealIntakeService,
    SoldSubmissionValidator,
    ResolveDealStep,
    UpsertPoliciesStep,
    PriorInsuranceStep,
    InterestedPartiesStep,
    AdvanceLeadStep,
  ],
  exports: [SoldDealIntakeService, SoldSubmissionValidator],
})
export class SoldIntakeModule {}
