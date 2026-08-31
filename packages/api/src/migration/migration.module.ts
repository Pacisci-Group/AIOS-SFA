import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoModule } from '../common/mongo/mongo.module';
import { ENV_FILE_PATH } from '../config/env.config';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import {
  QuoteRecap,
  QuoteRecapSchema,
} from '../quote-recaps/schemas/quote-recap.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  DealAuditItem,
  DealAuditItemSchema,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import {
  ProducerGoal,
  ProducerGoalSchema,
} from '../producer-goals/schemas/producer-goal.schema';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from '../service-tickets/schemas/service-ticket.schema';
import {
  DealAudit,
  DealAuditSchema,
} from '../deal-audits/schemas/deal-audit.schema';
import {
  InterestedParty,
  InterestedPartySchema,
} from '../interested-parties/schemas/interested-party.schema';
import {
  PriorInsurance,
  PriorInsuranceSchema,
} from '../prior-insurance/schemas/prior-insurance.schema';
import {
  PriorPolicy,
  PriorPolicySchema,
} from '../prior-policies/schemas/prior-policy.schema';
import {
  ProducerAssignment,
  ProducerAssignmentSchema,
} from '../producer-assignments/schemas/producer-assignment.schema';
import {
  CrmRotation,
  CrmRotationSchema,
} from '../crm-rotations/schemas/crm-rotation.schema';
import {
  TimeOffRequest,
  TimeOffRequestSchema,
} from '../time-off-requests/schemas/time-off-request.schema';
import {
  AuditTemplate,
  AuditTemplateSchema,
} from '../audit-templates/schemas/audit-template.schema';
import { PermissionsModule } from '../permissions/permissions.module';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { MigrationService } from './migration.service';

/**
 * Self-contained root module for the SmartSuite -> Mongo migration. Owns its own
 * Mongoose connection (mirrors app.module.ts) so the migration can run as a
 * standalone Nest application context without booting the HTTP guards.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATH }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://localhost:27017/sfa'),
      }),
    }),
    // `migrate.ts` boots this module directly rather than AppModule, so the
    // global Mongo helpers have to be imported here to get `SequenceService`
    // (the household counter is seeded at the end of the household import).
    MongoModule,
    // The migration provisions the tenant it imports into (agency, branch,
    // default roles, audit templates), so it needs `RoleAssignmentsService`
    // for `seedDefaultRoles`. Same standalone-module trick `DemoSeedModule`
    // uses. It creates no users beyond the ones SmartSuite supplies.
    PermissionsModule,
    MongooseModule.forFeature([
      { name: Agency.name, schema: AgencySchema },
      { name: Branch.name, schema: BranchSchema },
      { name: User.name, schema: UserSchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
      { name: Deal.name, schema: DealSchema },
      { name: DealAuditItem.name, schema: DealAuditItemSchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: ProducerGoal.name, schema: ProducerGoalSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: ServiceTicket.name, schema: ServiceTicketSchema },
      { name: DealAudit.name, schema: DealAuditSchema },
      { name: InterestedParty.name, schema: InterestedPartySchema },
      { name: PriorInsurance.name, schema: PriorInsuranceSchema },
      { name: PriorPolicy.name, schema: PriorPolicySchema },
      { name: ProducerAssignment.name, schema: ProducerAssignmentSchema },
      { name: CrmRotation.name, schema: CrmRotationSchema },
      { name: TimeOffRequest.name, schema: TimeOffRequestSchema },
      { name: AuditTemplate.name, schema: AuditTemplateSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
    ]),
  ],
  providers: [MigrationService],
})
export class MigrationModule {}
