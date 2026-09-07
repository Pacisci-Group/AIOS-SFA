import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContactsModule } from '../contacts/contacts.module';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import { HouseholdMembersModule } from '../households/household-members.module';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import { ClientsService } from './clients.service';
import { HouseholdRecordsController } from './household-records.controller';
import { PolicyRecordsController } from './policy-records.controller';

/**
 * APIs over the migrated client-record schemas — reads, plus adding a member to
 * a household. Exporting `MongooseModule` also makes these models injectable in
 * the seed scripts.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Household.name, schema: HouseholdSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: Contact.name, schema: ContactSchema },
    ]),
    // The Household form creates contacts too, and must refuse the same
    // duplicates lead intake refuses (PAC-91 §9).
    ContactsModule,
    // The roster, its roles, and adding/ending a membership (PAC-91 §5).
    HouseholdMembersModule,
  ],
  controllers: [HouseholdRecordsController, PolicyRecordsController],
  providers: [ClientsService],
  exports: [ClientsService, MongooseModule],
})
export class ClientsModule {}
