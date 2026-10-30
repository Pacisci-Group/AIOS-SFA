import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContactsModule } from '../../contacts/contacts.module';
import { Contact, ContactSchema } from '../../contacts/schemas/contact.schema';
import { HouseholdMembersModule } from '../../households/household-members.module';
import {
  Household,
  HouseholdSchema,
} from '../../households/schemas/household.schema';
import { ResolveContactStep } from './resolve-contact.step';
import { ResolveHouseholdStep } from './resolve-household.step';

/**
 * The household half of lead intake: find or create the person, then the
 * household they head. Lead intake runs it before the lead; the 1-800 service
 * intake (PAC-173 PR 5, `ServicedPolicyIntakeService`) runs it with no lead at
 * all.
 *
 * A module of its own rather than an export of `LeadsModule`, because the
 * service intake is reached from `CarrierReconciliationModule`, which
 * `LeadsModule` imports: importing `LeadsModule` back would be a cycle. These
 * two steps need only contacts, memberships and the global `SequenceService`
 * (household refs), so nothing here reaches back.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Household.name, schema: HouseholdSchema },
      { name: Contact.name, schema: ContactSchema },
    ]),
    ContactsModule,
    HouseholdMembersModule,
  ],
  providers: [ResolveContactStep, ResolveHouseholdStep],
  exports: [ResolveContactStep, ResolveHouseholdStep],
})
export class HouseholdIntakeModule {}
