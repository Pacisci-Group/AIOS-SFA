import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditGenerationModule } from '../audit-generation/audit-generation.module';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import { CrmRotationsModule } from '../crm-rotations/crm-rotations.module';
import { CrmModule } from '../crm/crm.module';
import { LeadsModule } from '../leads/leads.module';
import {
  QuoteRecap,
  QuoteRecapSchema,
} from '../quote-recaps/schemas/quote-recap.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { SoldIntakeModule } from './intake/sold-intake.module';
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
    MongooseModule.forFeature([
      { name: Contact.name, schema: ContactSchema },
      { name: User.name, schema: UserSchema },
      // Read-only, for the "has a quote been given?" gate (PAC-56 #17).
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
    ]),
    // The pipeline itself, shared with `CrmModule`'s Policy Transfer. It writes
    // across six collections in one transaction and owns their schemas.
    SoldIntakeModule,
    LeadsModule,
    // The submission's server-side side-effects. All run post-commit and
    // best-effort, so none can fail a sale that is already booked.
    AuditGenerationModule,
    CrmRotationsModule,
    // `LeadTicketsService` — resolves the lead's quote service ticket once the
    // sale has advanced it to Sold.
    CrmModule,
  ],
  controllers: [SoldDealsController],
  providers: [SoldDealsService],
})
export class SoldDealsModule {}
