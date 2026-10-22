import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  LeavePolicy,
  LeavePolicySchema,
} from '../../hr/schemas/leave-policy.schema';
import { LeavePolicyService } from './leave-policy.service';

/**
 * The policy reader every HR engine goes through (PAC-161). Worker-importable
 * like `WorkingDaysModule`; the HTTP CRUD stays in `hr/`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeavePolicy.name, schema: LeavePolicySchema },
    ]),
  ],
  providers: [LeavePolicyService],
  exports: [LeavePolicyService, MongooseModule],
})
export class HrCommonModule {}
