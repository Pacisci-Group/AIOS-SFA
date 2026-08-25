import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditGenerationModule } from '../audit-generation/audit-generation.module';
import { ClientsModule } from '../clients/clients.module';
import {
  DealAudit,
  DealAuditSchema,
} from '../deal-audits/schemas/deal-audit.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import { SoldIntakeModule } from '../sold-deals/intake/sold-intake.module';
import { PolicyTransfersService } from './policy-transfers.service';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { LeadTicketsService } from './lead-tickets.service';
import { ServiceTicketsController } from './service-tickets.controller';
import { ServiceTicketsService } from './service-tickets.service';
import { Onboarding, OnboardingSchema } from './schemas/onboarding.schema';
import {
  RenewalCycle,
  RenewalCycleSchema,
} from './schemas/renewal-cycle.schema';
import {
  RenewalScanState,
  RenewalScanStateSchema,
} from './schemas/renewal-scan-state.schema';
import {
  OnboardingStepDefinitionRecord,
  OnboardingStepDefinitionSchema,
} from './schemas/onboarding-step-definition.schema';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from './schemas/service-ticket.schema';

@Module({
  imports: [
    // Ticket creation resolves the picked household/policy through the same
    // scoped reads the Clients pages use.
    ClientsModule,
    /*
     * Policy Transfer drives the *same* pipeline as the Sold form. Importing
     * `SoldIntakeModule` — which deliberately imports no feature module — rather
     * than `SoldDealsModule` is what keeps this acyclic: `SoldDealsModule`
     * imports this one back, for `LeadTicketsService`.
     */
    SoldIntakeModule,
    // A transfer generates its hand-off checklist exactly as a sale does.
    AuditGenerationModule,
    MongooseModule.forFeature([
      { name: ServiceTicket.name, schema: ServiceTicketSchema },
      { name: User.name, schema: UserSchema },
      // The lead behind a `Quote` ticket. Registered as a schema rather than by
      // importing `LeadsModule`, which would close a cycle — `LeadsModule`
      // imports this module for `LeadTicketsService`.
      { name: Lead.name, schema: LeadSchema },
      // The records a policy transfer reads back and reconciles.
      { name: Deal.name, schema: DealSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: Household.name, schema: HouseholdSchema },
      // Read-only: the transfer's generated checklist, linked from its panel.
      { name: DealAudit.name, schema: DealAuditSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      {
        name: OnboardingStepDefinitionRecord.name,
        schema: OnboardingStepDefinitionSchema,
      },
      { name: Onboarding.name, schema: OnboardingSchema },
      { name: RenewalCycle.name, schema: RenewalCycleSchema },
      { name: RenewalScanState.name, schema: RenewalScanStateSchema },
    ]),
  ],
  controllers: [ServiceTicketsController],
  providers: [
    ServiceTicketsService,
    LeadTicketsService,
    PolicyTransfersService,
  ],
  // `LeadTicketsService` is consumed by `LeadsModule` (open the ticket, resolve
  // it on a manual status edit) and `SoldDealsModule` (resolve it when a sale
  // advances the lead to Sold).
  exports: [ServiceTicketsService, LeadTicketsService, MongooseModule],
})
export class CrmModule {}
