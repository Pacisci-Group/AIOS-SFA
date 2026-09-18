import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import { AuditGenerationModule } from '../audit-generation/audit-generation.module';
import { CarriersModule } from '../carriers/carriers.module';
import {
  Chargeback,
  ChargebackSchema,
} from '../chargebacks/schemas/chargeback.schema';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { SoldIntakeModule } from '../sold-deals/intake/sold-intake.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { PolicyRewritesService } from './policy-rewrites.service';
import { Policy, PolicySchema } from './schemas/policy.schema';

/**
 * Policies (PAC-40).
 *
 * The schema existed but was registered nowhere, so its indexes were never
 * built and no runtime code could inject the model. Registering it is a
 * prerequisite for both the `policyNumberKey` backfill and
 * `GET /policies/check`.
 *
 * `Deal` and `Household` are registered because the duplicate check resolves a
 * match's owner from its deal (policies carry no `producerId`) and its client
 * name from either. `Activity` is registered for the edit log a correction
 * writes (PAC-65 #9) — the same schema-only registration five other feature
 * modules already do, so it adds no dependency on `ActivitiesModule`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Policy.name, schema: PolicySchema },
      { name: Deal.name, schema: DealSchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Activity.name, schema: ActivitySchema },
      // The policies list renders the household's primary contact's name,
      // which the household no longer stores a copy of (PAC-91 §4).
      { name: Contact.name, schema: ContactSchema },
      // Cancel Rewrite writes a ledger row in the same transaction as the
      // cancellation, and resolves the charged producer's name for it.
      { name: Chargeback.name, schema: ChargebackSchema },
      { name: User.name, schema: UserSchema },
      /*
       * A replacement now runs through the Sold form on a lead created for it,
       * and `PolicyRewritesService.recordForLead` stamps that lead's intent
       * consumed in the same transaction as the deal (PAC-126).
       *
       * A *schema* registration rather than a `LeadsModule` import: that module
       * imports this one for `loadOwnedPolicy`, so importing it back would be a
       * cycle needing `forwardRef`. Registering another module's schema is the
       * house pattern — see the note in `crm.module.ts`.
       */
      { name: Lead.name, schema: LeadSchema },
    ]),
    // Supplies the carrier's policy-number rule when a correction changes the
    // number (PAC-56 #20).
    CarriersModule,
    /*
     * Cancel Rewrite is the Sold pipeline with a different anchor, exactly as
     * the CRM's Policy Transfer is — so it reuses the same intake steps,
     * submission validator and audit generator rather than growing a second way
     * to write a policy. `SoldIntakeModule` is deliberately the *steps* module,
     * not `SoldDealsModule`, which would pull the sold controller back in.
     */
    SoldIntakeModule,
    AuditGenerationModule,
  ],
  controllers: [PoliciesController],
  providers: [PoliciesService, PolicyRewritesService],
  /*
   * `PoliciesService` is exported for `ClientsModule` (PAC-126): the household
   * page's policy edit runs the same mutation — renewal re-derivation, item-count
   * normalization, `policyNumberKey`, deal totals, edit log — and only finds its
   * target differently. See `PoliciesService.applyUpdate`.
   *
   * Safe against the route-ordering hazard documented in `app.module.ts`:
   * `PoliciesModule` is already listed ahead of `CrmModule`, which is what first
   * pulls `ClientsModule` in, so `/policies/check` still registers before
   * `PolicyRecordsController`'s `/policies/:id`. This import cannot move it later.
   */
  exports: [MongooseModule, PoliciesService, PolicyRewritesService],
})
export class PoliciesModule {}
