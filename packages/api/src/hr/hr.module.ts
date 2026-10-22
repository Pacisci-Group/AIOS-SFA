import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HrCommonModule } from '../common/hr/hr-common.module';
import { WorkingDaysModule } from '../common/working-days/working-days.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AgencyCalendarController } from './agency-calendar.controller';
import { AgencyCalendarService } from './agency-calendar.service';
import { HrPolicyController } from './hr-policy.controller';
import { LeavePoliciesController } from './leave-policies.controller';
import { LeavePoliciesService } from './leave-policies.service';

/**
 * The HR module's HTTP surface (PAC-161): the agency calendar, leave
 * policies, and the assembled HR Policy view. The engines it exists to feed
 * live in `common/working-days/` and `common/hr/`, which this imports rather
 * than re-registering — the worker imports the same two.
 */
@Module({
  imports: [
    WorkingDaysModule,
    HrCommonModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Agency.name, schema: AgencySchema },
    ]),
  ],
  controllers: [
    AgencyCalendarController,
    LeavePoliciesController,
    HrPolicyController,
  ],
  providers: [AgencyCalendarService, LeavePoliciesService],
})
export class HrModule {}
