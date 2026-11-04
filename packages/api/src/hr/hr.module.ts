import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { WorkingDaysModule } from '../common/working-days/working-days.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { TimeOffPoliciesController } from './time-off-policies.controller';
import { TimeOffPoliciesService } from './time-off-policies.service';

/**
 * The HR module's HTTP surface (PAC-161 v3): time off policies. The policy
 * schemas (`holidayPolicies`, `workWeekPolicies`) are registered by
 * `WorkingDaysModule`, which the worker imports too — a job counting
 * someone's working days reads the same rows.
 */
@Module({
  imports: [
    WorkingDaysModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Branch.name, schema: BranchSchema },
    ]),
  ],
  controllers: [TimeOffPoliciesController],
  providers: [TimeOffPoliciesService],
})
export class HrModule {}
