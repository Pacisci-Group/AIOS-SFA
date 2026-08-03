import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  InterestedParty,
  InterestedPartySchema,
} from '../interested-parties/schemas/interested-party.schema';
import { LeadsModule } from '../leads/leads.module';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import {
  PriorInsurance,
  PriorInsuranceSchema,
} from '../prior-insurance/schemas/prior-insurance.schema';
import {
  PriorPolicy,
  PriorPolicySchema,
} from '../prior-policies/schemas/prior-policy.schema';
import { AdvanceLeadStep } from './intake/advance-lead.step';
import { InterestedPartiesStep } from './intake/interested-parties.step';
import { PriorInsuranceStep } from './intake/prior-insurance.step';
import { ResolveDealStep } from './intake/resolve-deal.step';
import { SoldDealIntakeService } from './intake/sold-deal-intake.service';
import { UpsertPoliciesStep } from './intake/upsert-policies.step';
import { SoldDealsController } from './sold-deals.controller';
import { SoldDealsService } from './sold-deals.service';

/**
 * Sold form write path (PAC-40).
 *
 * `StorageService` and `TenantContextResolver` come from the global
 * StorageModule / TenancyModule; `TransactionRunner` from the global
 * MongoModule. `LeadsModule` is imported for `LeadAccessService` — the shared
 * lead scope clamp and self-healing household resolver.
 */
@Module({
  imports: [
    // The intake pipeline writes across six collections in one transaction.
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: PriorInsurance.name, schema: PriorInsuranceSchema },
      { name: PriorPolicy.name, schema: PriorPolicySchema },
      { name: InterestedParty.name, schema: InterestedPartySchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
    LeadsModule,
  ],
  controllers: [SoldDealsController],
  providers: [
    SoldDealsService,
    SoldDealIntakeService,
    ResolveDealStep,
    UpsertPoliciesStep,
    PriorInsuranceStep,
    InterestedPartiesStep,
    AdvanceLeadStep,
  ],
  exports: [SoldDealIntakeService],
})
export class SoldDealsModule {}
