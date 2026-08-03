import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import { ClientsService } from './clients.service';
import { HouseholdRecordsController } from './household-records.controller';
import { PolicyRecordsController } from './policy-records.controller';

/**
 * Read-only APIs over the migrated client-record schemas. Exporting
 * `MongooseModule` also makes these models injectable in the seed scripts.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Household.name, schema: HouseholdSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: Contact.name, schema: ContactSchema },
    ]),
  ],
  controllers: [HouseholdRecordsController, PolicyRecordsController],
  providers: [ClientsService],
  exports: [ClientsService, MongooseModule],
})
export class ClientsModule {}
