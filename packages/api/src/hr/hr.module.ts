import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { TimeOffModule } from '../common/time-off/time-off.module';
import { WorkingDaysModule } from '../common/working-days/working-days.module';
import {
  TimeOffRequest,
  TimeOffRequestSchema,
} from '../time-off-requests/schemas/time-off-request.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { HrPoliciesController } from './hr-policies.controller';
import { HrPoliciesService } from './hr-policies.service';

/**
 * The HR module's HTTP surface (PAC-161 v3, PAC-174): HR policies. The
 * policy schemas are registered by the two `common/` modules the worker
 * imports too — `WorkingDaysModule` (`holidayPolicies`, `workWeekPolicies`)
 * and `TimeOffModule` (`timeOffPolicies`, `leaveLedger`) — so a job reads
 * the same rows the page writes. `timeOffRequests` is read here only by the
 * archive guard (PAC-165 owns the collection).
 */
@Module({
  imports: [
    WorkingDaysModule,
    TimeOffModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: TimeOffRequest.name, schema: TimeOffRequestSchema },
    ]),
  ],
  controllers: [HrPoliciesController],
  providers: [HrPoliciesService],
})
export class HrModule {}
