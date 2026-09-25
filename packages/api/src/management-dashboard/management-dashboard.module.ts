import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from '../crm/schemas/service-ticket.schema';
import {
  DealAuditItem,
  DealAuditItemSchema,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import {
  DealAudit,
  DealAuditSchema,
} from '../deal-audits/schemas/deal-audit.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { LeadSourcesModule } from '../lead-sources/lead-sources.module';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { PermissionsModule } from '../permissions/permissions.module';
import {
  QuoteRecap,
  QuoteRecapSchema,
} from '../quote-recaps/schemas/quote-recap.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ManagementDashboardController } from './management-dashboard.controller';
import { ManagementDashboardService } from './management-dashboard.service';

/**
 * The Manager View dashboard (PAC-139).
 *
 * Schema registrations rather than feature-module imports, the house pattern
 * for a pure read model (see `OwnerDashboardModule`): this module aggregates
 * seven collections and wants none of their services. The two real imports
 * are `LeadSourcesModule`, which names the sources on the Stalled Leads rows,
 * and `PermissionsModule`, whose `RoleAssignmentsService` answers "who holds
 * the producer role" for the Team Activity roster.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: Deal.name, schema: DealSchema },
      { name: DealAudit.name, schema: DealAuditSchema },
      { name: DealAuditItem.name, schema: DealAuditItemSchema },
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
      { name: ServiceTicket.name, schema: ServiceTicketSchema },
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
    ]),
    LeadSourcesModule,
    PermissionsModule,
  ],
  controllers: [ManagementDashboardController],
  providers: [ManagementDashboardService],
})
export class ManagementDashboardModule {}
