import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { EmployeeProfilesModule } from '../common/hr/employee-profiles.module';
import { TimeOffModule } from '../common/time-off/time-off.module';
import { WorkingDaysModule } from '../common/working-days/working-days.module';
import {
  TimeOffRequest,
  TimeOffRequestSchema,
} from '../time-off-requests/schemas/time-off-request.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { HrPoliciesController } from './hr-policies.controller';
import { HrPoliciesService } from './hr-policies.service';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';

/**
 * The HR module's HTTP surface (PAC-161 v3, PAC-174, PAC-162): HR policies
 * and the HR writes on a person. The policy schemas are registered by the
 * two `common/` modules the worker imports too — `WorkingDaysModule`
 * (`holidayPolicies`, `workWeekPolicies`) and `TimeOffModule`
 * (`timeOffPolicies`, `leaveLedger`) — so a job reads the same rows the
 * page writes. `timeOffRequests` is read here only by the archive guard
 * (PAC-165 owns the collection). `UsersModule` supplies the profile read
 * every people write returns.
 */
@Module({
  imports: [
    WorkingDaysModule,
    TimeOffModule,
    EmployeeProfilesModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: TimeOffRequest.name, schema: TimeOffRequestSchema },
    ]),
  ],
  controllers: [HrPoliciesController, PeopleController],
  providers: [HrPoliciesService, PeopleService],
})
export class HrModule {}
