import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoModule } from '../../common/mongo/mongo.module';
import { ENV_FILE_PATH } from '../../config/env.config';
import { Agency, AgencySchema } from '../../platform/schemas/agency.schema';
import { Branch, BranchSchema } from '../../branches/schemas/branch.schema';
import { User, UserSchema } from '../../users/schemas/user.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../../roles/schemas/agency-role.schema';
import {
  Household,
  HouseholdSchema,
} from '../../households/schemas/household.schema';
import { Lead, LeadSchema } from '../../leads/schemas/lead.schema';
import {
  QuoteRecap,
  QuoteRecapSchema,
} from '../../quote-recaps/schemas/quote-recap.schema';
import { Deal, DealSchema } from '../../deals/schemas/deal.schema';
import {
  DealAuditItem,
  DealAuditItemSchema,
} from '../../deal-audit-items/schemas/deal-audit-item.schema';
import {
  Activity,
  ActivitySchema,
} from '../../activities/schemas/activity.schema';
import {
  ProducerGoal,
  ProducerGoalSchema,
} from '../../producer-goals/schemas/producer-goal.schema';
import { Contact, ContactSchema } from '../../contacts/schemas/contact.schema';
import { Policy, PolicySchema } from '../../policies/schemas/policy.schema';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from '../../crm/schemas/service-ticket.schema';
import {
  DealAudit,
  DealAuditSchema,
} from '../../deal-audits/schemas/deal-audit.schema';
import {
  InterestedParty,
  InterestedPartySchema,
} from '../../interested-parties/schemas/interested-party.schema';
import {
  PriorInsurance,
  PriorInsuranceSchema,
} from '../../prior-insurance/schemas/prior-insurance.schema';
import {
  PriorPolicy,
  PriorPolicySchema,
} from '../../prior-policies/schemas/prior-policy.schema';
import {
  ProducerAssignment,
  ProducerAssignmentSchema,
} from '../../producer-assignments/schemas/producer-assignment.schema';
import {
  CrmRotation,
  CrmRotationSchema,
} from '../../crm-rotations/schemas/crm-rotation.schema';
import {
  TimeOffRequest,
  TimeOffRequestSchema,
} from '../../time-off-requests/schemas/time-off-request.schema';
import {
  AuditTemplate,
  AuditTemplateSchema,
} from '../../audit-templates/schemas/audit-template.schema';
import { Mailer, MailerSchema } from '../../mailers/schemas/mailer.schema';
import { Carrier, CarrierSchema } from '../../carriers/schemas/carrier.schema';
import { PermissionsModule } from '../../permissions/permissions.module';
import { DemoSeedService } from './demo-seed.service';

/**
 * Self-contained root module for the synthetic demo-data seed. Owns its own
 * Mongoose connection (mirrors migration.module.ts) so the seed runs as a
 * standalone Nest application context without booting the HTTP guards. Registers
 * every domain model plus the tenancy/permission models so a single command can
 * create a complete, logged-in-able tenant with realistic CRM data.
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
    // `demo-seed.ts` boots this module directly rather than AppModule — needed
    // for `SequenceService`, which lifts the household counter past the block
    // the seed claims.
    MongoModule,
    // Imported rather than providing `PermissionsService` directly: role
    // assignment now needs the resolver, owner protection and the three join
    // models, and re-listing that set here would be a second definition to keep
    // in step.
    PermissionsModule,
    MongooseModule.forFeature([
      { name: Agency.name, schema: AgencySchema },
      { name: Branch.name, schema: BranchSchema },
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
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
      { name: Mailer.name, schema: MailerSchema },
      { name: Carrier.name, schema: CarrierSchema },
    ]),
  ],
  providers: [DemoSeedService],
})
export class DemoSeedModule {}
