import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import { HouseholdMembersModule } from './household-members.module';
import { PrimaryContactService } from './primary-contact.service';
import { Household, HouseholdSchema } from './schemas/household.schema';

/**
 * The reassign-primary-contact operation (PAC-91 §7), on its own.
 *
 * Its own module because **two** feature modules perform it and neither owns
 * it: `clients` exposes it as `POST /households/:id/primary-contact`, and
 * `contacts` has to perform the same operation inside `PATCH /contacts/:id`
 * when the contact being marked deceased is a household's primary. Putting it
 * in either would make the other import a feature module for one method — and
 * `ClientsModule` already imports `ContactsModule`, so the dependency can only
 * run one way.
 *
 * Deliberately not folded into {@link HouseholdMembersModule}, which is
 * narrow on purpose: this needs `Household`, `Contact` and `Activity` as well,
 * and membership is a different fact from primacy — that separation is the
 * whole point of PAC-91 §5.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Household.name, schema: HouseholdSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
    HouseholdMembersModule,
  ],
  providers: [PrimaryContactService],
  exports: [PrimaryContactService],
})
export class PrimaryContactModule {}
