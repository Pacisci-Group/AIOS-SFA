import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { HrCommonModule } from '../common/hr/hr-common.module';
import { WorkingDaysModule } from '../common/working-days/working-days.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AgencyCalendarController } from './agency-calendar.controller';
import { AgencyCalendarService } from './agency-calendar.service';
import {
  EmployeeProfilesController,
  MyHrProfileController,
} from './employee-profiles.controller';
import { EmployeeProfilesService } from './employee-profiles.service';
import { HrPolicyController } from './hr-policy.controller';
import { LeavePoliciesController } from './leave-policies.controller';
import { LeavePoliciesService } from './leave-policies.service';
import { ScheduleTemplatesController } from './schedule-templates.controller';
import { ScheduleTemplatesService } from './schedule-templates.service';

/**
 * The HR module's HTTP surface: the agency calendar, leave policies and the
 * assembled HR Policy view (PAC-161); employee profiles, the employee's own
 * record and schedule templates (PAC-162). The engines it exists to feed
 * live in `common/working-days/` and `common/hr/`, which this imports rather
 * than re-registering — the worker imports the same two.
 *
 * `PermissionsModule` for `RoleAssignmentsService`: the lists show role
 * names, and the join is read through its one owner. `Branch` is a schema
 * only — one name lookup per page.
 */
@Module({
  imports: [
    WorkingDaysModule,
    HrCommonModule,
    PermissionsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: Branch.name, schema: BranchSchema },
    ]),
  ],
  controllers: [
    AgencyCalendarController,
    LeavePoliciesController,
    HrPolicyController,
    EmployeeProfilesController,
    MyHrProfileController,
    ScheduleTemplatesController,
  ],
  providers: [
    AgencyCalendarService,
    LeavePoliciesService,
    EmployeeProfilesService,
    ScheduleTemplatesService,
  ],
})
export class HrModule {}
