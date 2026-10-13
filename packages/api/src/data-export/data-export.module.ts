import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import {
  Chargeback,
  ChargebackSchema,
} from '../chargebacks/schemas/chargeback.schema';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import {
  DealAudit,
  DealAuditSchema,
} from '../deal-audits/schemas/deal-audit.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  HouseholdMember,
  HouseholdMemberSchema,
} from '../households/schemas/household-member.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import {
  InterestedParty,
  InterestedPartySchema,
} from '../interested-parties/schemas/interested-party.schema';
import {
  LeadSource,
  LeadSourceSchema,
} from '../lead-sources/schemas/lead-source.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { PermissionsModule } from '../permissions/permissions.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
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
import { TenantBrandingModule } from '../tenant-branding/tenant-branding.module';
import { DataExportController } from './data-export.controller';
import { DataExportHistoryService } from './data-export-history.service';
import { DataExportService } from './data-export.service';
import { DataExport, DataExportSchema } from './schemas/data-export.schema';

/**
 * The Data Export page (PAC-152).
 *
 * Schema registrations rather than feature-module imports — the house pattern
 * for a pure read model (`OwnerDashboardModule`): this reads a dozen
 * collections and wants none of their services. Lead sources are read through
 * their schema, as the worker must; `PermissionsModule` supplies the producer
 * roster for the filter. `InngestService` and `StorageService` are global.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: Deal.name, schema: DealSchema },
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: HouseholdMember.name, schema: HouseholdMemberSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: DealAudit.name, schema: DealAuditSchema },
      { name: InterestedParty.name, schema: InterestedPartySchema },
      { name: Chargeback.name, schema: ChargebackSchema },
      { name: User.name, schema: UserSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: LeadSource.name, schema: LeadSourceSchema },
      { name: DataExport.name, schema: DataExportSchema },
    ]),
    PermissionsModule,
    TenantBrandingModule,
  ],
  controllers: [DataExportController],
  providers: [DataExportService, DataExportHistoryService],
})
export class DataExportModule {}
