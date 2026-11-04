import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TimeOffPolicy,
  TimeOffPolicySchema,
} from '../../hr/schemas/time-off-policy.schema';
import { WorkingDaysService } from './working-days.service';

/**
 * The working-day service and the policy schema it reads (PAC-161 v3).
 * Imported by the HR feature module and, from PAC-165, by the worker — a job
 * counting business days must never grow its own loop over the policies.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TimeOffPolicy.name, schema: TimeOffPolicySchema },
    ]),
  ],
  providers: [WorkingDaysService],
  exports: [WorkingDaysService, MongooseModule],
})
export class WorkingDaysModule {}
