import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import { AuditGenerationModule } from '../audit-generation/audit-generation.module';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import { CrmRotationsModule } from '../crm-rotations/crm-rotations.module';
import { CrmModule } from '../crm/crm.module';
import {
  DealAudit,
  DealAuditSchema,
} from '../deal-audits/schemas/deal-audit.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { HouseholdMembersModule } from '../households/household-members.module';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { LeadsModule } from '../leads/leads.module';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import {
  QuoteRecap,
  QuoteRecapSchema,
} from '../quote-recaps/schemas/quote-recap.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PoliciesModule } from '../policies/policies.module';
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
      // Editing a booked sale (PAC-104): the deal and its policies, the
      // household whose active count an addition moves, the audit whose status
      // gates it, and the timeline its change log lands on.
      { name: Deal.name, schema: DealSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: DealAudit.name, schema: DealAuditSchema },
      { name: Activity.name, schema: ActivitySchema },
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
    // The defensive-driver picker's roster and its per-household roles
    // (PAC-91 §5).
    HouseholdMembersModule,
    /*
     * `PolicyRewritesService.recordForLead` — the chargeback and the intent
     * stamp that finish a replacement booked through this form (PAC-126).
     *
     * Acyclic: `PoliciesModule` imports `SoldIntakeModule` (the steps) and
     * deliberately **not** this module, precisely so the pipeline can be shared
     * without a cycle. See its own note.
     */
    PoliciesModule,
  ],
  controllers: [SoldDealsController],
  providers: [SoldDealsService],
})
export class SoldDealsModule {}
