import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
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
  AuditRecord,
  AuditRecordSchema,
} from '../audit-records/schemas/audit-record.schema';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import {
  ProducerGoal,
  ProducerGoalSchema,
} from '../producer-goals/schemas/producer-goal.schema';
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
    MongooseModule.forFeature([
      { name: Agency.name, schema: AgencySchema },
      { name: Branch.name, schema: BranchSchema },
      { name: User.name, schema: UserSchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
      { name: Deal.name, schema: DealSchema },
      { name: AuditRecord.name, schema: AuditRecordSchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: ProducerGoal.name, schema: ProducerGoalSchema },
    ]),
  ],
  providers: [MigrationService],
})
export class MigrationModule {}
