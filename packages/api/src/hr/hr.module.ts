import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { WorkingDaysModule } from '../common/working-days/working-days.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { HrPoliciesController } from './hr-policies.controller';
import { HrPoliciesService } from './hr-policies.service';

/**
 * The HR module's HTTP surface (PAC-161 v3): HR policies. The policy
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
  controllers: [HrPoliciesController],
  providers: [HrPoliciesService],
})
export class HrModule {}
