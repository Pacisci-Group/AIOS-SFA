import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import { CrmModule } from '../crm/crm.module';
import { Onboarding, OnboardingSchema } from '../crm/schemas/onboarding.schema';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from '../crm/schemas/service-ticket.schema';
import { HouseholdMembersModule } from '../households/household-members.module';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { HouseholdIntakeModule } from '../leads/intake/household-intake.module';
import {
  UserRole,
  UserRoleSchema,
} from '../permissions/schemas/user-role.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { SoldIntakeModule } from '../sold-deals/intake/sold-intake.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ServicedPolicyIntakeService } from './serviced-policy-intake.service';

/**
 * The 1-800 service intake (PAC-173 PR 5): a household and a `carrier_direct`
 * policy with no deal, then a CSR's welcome call.
 *
 * Its own module, not part of `ClientsModule`, because of who reaches it:
 * `CarrierReconciliationModule` (the Dash row it settles), which `LeadsModule`
 * and `SoldDealsModule` import. Everything here must stay out of their reach:
 *
 * - `HouseholdIntakeModule` — the two lead-pipeline steps, without
 *   `LeadsModule`.
 * - `CrmModule` — `ServiceTicketsService.startOnboarding` / `listAssignees`.
 *   Its tree (Clients, Contacts, memberships, Policies, SoldIntake, audits,
 *   carriers) never reaches Leads, SoldDeals or CarrierReconciliation.
 * - `SoldIntakeModule` — `SoldSubmissionValidator`, re-exported so the Dash
 *   side verifies the signed application and the number format exactly as the
 *   Sold form does. Already inside `CrmModule`'s tree.
 *
 * No controller: the endpoints are the Dash row's, on
 * `carrier-reconciliation/assigned`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Household.name, schema: HouseholdSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: Contact.name, schema: ContactSchema },
      { name: User.name, schema: UserSchema },
      { name: Onboarding.name, schema: OnboardingSchema },
      { name: ServiceTicket.name, schema: ServiceTicketSchema },
      // Who a late welcome call can still go to (`activeRoleHolders`).
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: UserRole.name, schema: UserRoleSchema },
    ]),
    HouseholdIntakeModule,
    HouseholdMembersModule,
    CrmModule,
    SoldIntakeModule,
  ],
  providers: [ServicedPolicyIntakeService],
  exports: [ServicedPolicyIntakeService, SoldIntakeModule],
})
export class ServicedPolicyIntakeModule {}
