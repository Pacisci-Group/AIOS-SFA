import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { MailModule } from '../mail/mail.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import {
  CrmRotation,
  CrmRotationSchema,
} from '../crm-rotations/schemas/crm-rotation.schema';
import { Onboarding, OnboardingSchema } from '../crm/schemas/onboarding.schema';
import {
  RenewalCycle,
  RenewalCycleSchema,
} from '../crm/schemas/renewal-cycle.schema';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from '../crm/schemas/service-ticket.schema';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import {
  DealAuditItem,
  DealAuditItemSchema,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
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
import {
  ShareLink,
  ShareLinkSchema,
} from '../share-links/schemas/share-link.schema';
import {
  UserRole,
  UserRoleSchema,
} from '../permissions/schemas/user-role.schema';
import { TenantBrandingModule } from '../tenant-branding/tenant-branding.module';
import { User, UserSchema } from './schemas/user.schema';
import {
  WorkTransfer,
  WorkTransferSchema,
} from './schemas/work-transfer.schema';
import { UserWorkReleaseService } from './user-work-release.service';
import { WorkTransferService } from './work-transfer.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    PermissionsModule,
    MailModule,
    // For the agency logo + display name on the invite email, so it matches
    // the dashboard the invitee is being sent to.
    TenantBrandingModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: Agency.name, schema: AgencySchema },
      // Read by `inviteUser` to check the chosen branch belongs to the
      // inviting agency. Schema only — one `exists` query is not worth
      // importing `BranchesModule` and its controller for.
      { name: Branch.name, schema: BranchSchema },
      { name: UserRole.name, schema: UserRoleSchema },
      // Read by `UserWorkReleaseService` when an employee is removed. Schemas
      // only — the CRM *services* are not imported, so removing a user does not
      // drag the CRM module's dependency graph into this one.
      { name: ServiceTicket.name, schema: ServiceTicketSchema },
      { name: CrmRotation.name, schema: CrmRotationSchema },
      // Read and rewritten by `WorkTransferService` (PAC-136). Schemas only,
      // for the same reason as above.
      { name: Onboarding.name, schema: OnboardingSchema },
      { name: RenewalCycle.name, schema: RenewalCycleSchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: DealAudit.name, schema: DealAuditSchema },
      { name: DealAuditItem.name, schema: DealAuditItemSchema },
      { name: ShareLink.name, schema: ShareLinkSchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: WorkTransfer.name, schema: WorkTransferSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService, UserWorkReleaseService, WorkTransferService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
