import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  HolidayPolicy,
  HolidayPolicySchema,
} from '../../hr/schemas/holiday-policy.schema';
import {
  WorkWeekPolicy,
  WorkWeekPolicySchema,
} from '../../hr/schemas/work-week-policy.schema';
import { WorkingDaysService } from './working-days.service';

/**
 * The working-day service and the two policy schemas it reads (PAC-161 v3).
 * Imported by the HR feature module and, from PAC-165, by the worker — a job
 * counting business days must never grow its own loop over the policies.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HolidayPolicy.name, schema: HolidayPolicySchema },
      { name: WorkWeekPolicy.name, schema: WorkWeekPolicySchema },
    ]),
  ],
  providers: [WorkingDaysService],
  exports: [WorkingDaysService, MongooseModule],
})
export class WorkingDaysModule {}
