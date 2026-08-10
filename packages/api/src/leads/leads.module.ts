import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import {
  PriorInsurance,
  PriorInsuranceSchema,
} from '../prior-insurance/schemas/prior-insurance.schema';
import {
  PriorPolicy,
  PriorPolicySchema,
} from '../prior-policies/schemas/prior-policy.schema';
import {
  QuoteRecap,
  QuoteRecapSchema,
} from '../quote-recaps/schemas/quote-recap.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { LeadIntakeService } from './intake/lead-intake.service';
import { LinkEntitiesStep } from './intake/link-entities.step';
import { ResolveContactStep } from './intake/resolve-contact.step';
import { ResolveHouseholdStep } from './intake/resolve-household.step';
import { ResolveLeadStep } from './intake/resolve-lead.step';
import { HotLeadsService } from './hot-leads.service';
import { LeadAccessService } from './lead-access.service';
import { LeadDetailService } from './lead-detail.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { Lead, LeadSchema } from './schemas/lead.schema';

@Module({
  imports: [
    // The intake pipeline writes across four collections in one transaction.
    // `TransactionRunner` comes from the global MongoModule.
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: Activity.name, schema: ActivitySchema },
      // The Lead Detail read (PAC-38) joins across the rest of the pipeline.
      { name: Policy.name, schema: PolicySchema },
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
      { name: Deal.name, schema: DealSchema },
      { name: PriorInsurance.name, schema: PriorInsuranceSchema },
      { name: PriorPolicy.name, schema: PriorPolicySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    LeadDetailService,
    HotLeadsService,
    LeadIntakeService,
    LeadAccessService,
    ResolveContactStep,
    ResolveHouseholdStep,
    ResolveLeadStep,
    LinkEntitiesStep,
  ],
  // `LeadIntakeService` so the public share-link controller can run the same
  // pipeline; `LeadAccessService` so every lead-scoped write path (quote
  // recaps, sold deals) shares one scope clamp and one household resolver.
  exports: [LeadIntakeService, LeadAccessService],
})
export class LeadsModule {}
