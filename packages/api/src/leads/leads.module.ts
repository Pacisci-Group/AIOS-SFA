import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { LeadIntakeService } from './intake/lead-intake.service';
import { LinkEntitiesStep } from './intake/link-entities.step';
import { ResolveContactStep } from './intake/resolve-contact.step';
import { ResolveHouseholdStep } from './intake/resolve-household.step';
import { ResolveLeadStep } from './intake/resolve-lead.step';
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
    ]),
  ],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    LeadIntakeService,
    ResolveContactStep,
    ResolveHouseholdStep,
    ResolveLeadStep,
    LinkEntitiesStep,
  ],
  // Exported so the public share-link controller can run the same pipeline.
  exports: [LeadIntakeService],
})
export class LeadsModule {}
