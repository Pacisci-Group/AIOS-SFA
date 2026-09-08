import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HouseholdMembersModule } from '../households/household-members.module';
import { PrimaryContactModule } from '../households/primary-contact.module';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { ContactAccessService } from './contact-access.service';
import { ContactIdentityService } from './contact-identity.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { Contact, ContactSchema } from './schemas/contact.schema';

/**
 * The first real owner of the `Contact` model (PAC-38). Until now the schema was
 * registered ad hoc by whichever feature module needed it, and the `contacts`
 * route was a generated `{status:'ready'}` stub.
 *
 * `Lead` is registered here because authorization depends on it:
 * {@link ContactAccessService} derives a producer's right to edit a contact from
 * the leads that reach it.
 *
 * {@link ContactIdentityService} is exported rather than duplicated: the
 * owner's "one person, one contact" rule (PAC-91 §9) has to read the same way
 * for lead intake, the Household form and the contact endpoints, and three
 * copies of a uniqueness check is three chances for one of them to drift.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contact.name, schema: ContactSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
    // `ContactAccessService` derives ownership through the contact's
    // households, and the duplicate 409 names them (PAC-91 §5).
    HouseholdMembersModule,
    // Marking a household's primary contact deceased has to name a successor in
    // the same request, which is the same operation the standalone endpoint
    // performs (PAC-91 §7).
    PrimaryContactModule,
  ],
  controllers: [ContactsController],
  providers: [ContactsService, ContactAccessService, ContactIdentityService],
  exports: [ContactAccessService, ContactIdentityService],
})
export class ContactsModule {}
