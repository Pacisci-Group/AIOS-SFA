import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { ContactAccessService } from './contact-access.service';
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
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contact.name, schema: ContactSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
  ],
  controllers: [ContactsController],
  providers: [ContactsService, ContactAccessService],
  exports: [ContactAccessService],
})
export class ContactsModule {}
