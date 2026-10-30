import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import {
  DealAuditItem,
  DealAuditItemSchema,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { LeadSourcesModule } from '../lead-sources/lead-sources.module';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { PermissionsModule } from '../permissions/permissions.module';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import {
  QuoteRecap,
  QuoteRecapSchema,
} from '../quote-recaps/schemas/quote-recap.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { DealAuditReviewService } from './deal-audit-review.service';
import { DealAuditsController } from './deal-audits.controller';
import { DealAuditsService } from './deal-audits.service';
import { DealAudit, DealAuditSchema } from './schemas/deal-audit.schema';

// StorageService is provided by the global StorageModule (see app.module).
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DealAuditItem.name, schema: DealAuditItemSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Activity.name, schema: ActivitySchema },
      // The board's driving collection + the two lookups that turn an
      // `auditAssignee.id` into a display name (PAC-72).
      { name: DealAudit.name, schema: DealAuditSchema },
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      // What the Deal Audit page shows beside the checklist (PAC-106): the
      // policies and their applications, the quote, the lead, the household.
      // Read only.
      { name: Policy.name, schema: PolicySchema },
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Contact.name, schema: ContactSchema },
    ]),
    // `RoleAssignmentsService` — a send-back to a role notifies its members.
    PermissionsModule,
    // Lead-source names for the "View lead" drawer.
    LeadSourcesModule,
  ],
  controllers: [DealAuditsController],
  providers: [DealAuditsService, DealAuditReviewService],
})
export class DealAuditsModule {}
