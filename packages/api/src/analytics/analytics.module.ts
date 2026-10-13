import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from '../crm/schemas/service-ticket.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { LeadSourcesModule } from '../lead-sources/lead-sources.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import {
  ProducerGoal,
  ProducerGoalSchema,
} from '../producer-goals/schemas/producer-goal.schema';
import {
  QuoteRecap,
  QuoteRecapSchema,
} from '../quote-recaps/schemas/quote-recap.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AnalyticsLabelsService } from './analytics-labels.service';
import { AnalyticsOptionsService } from './analytics-options.service';
import { AnalyticsController } from './analytics.controller';
import { SalesAnalyticsService } from './sales-analytics.service';
import { ServiceAnalyticsService } from './service-analytics.service';

/**
 * The Analytics page (PAC-152, part 2).
 *
 * A pure read model, like `OwnerDashboardModule`: schema registrations, not
 * feature-module imports. `LeadSourcesModule` names lead sources;
 * `PermissionsModule` supplies the producer roster for the filter. Households
 * are reached by `$lookup` inside the sales pipelines, never through a model.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: ServiceTicket.name, schema: ServiceTicketSchema },
      { name: ProducerGoal.name, schema: ProducerGoalSchema },
      { name: User.name, schema: UserSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
    ]),
    LeadSourcesModule,
    PermissionsModule,
  ],
  controllers: [AnalyticsController],
  providers: [
    SalesAnalyticsService,
    ServiceAnalyticsService,
    AnalyticsOptionsService,
    AnalyticsLabelsService,
  ],
})
export class AnalyticsModule {}
