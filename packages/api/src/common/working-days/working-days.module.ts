import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../../branches/schemas/branch.schema';
import {
  AgencyEvent,
  AgencyEventSchema,
} from '../../hr/schemas/agency-event.schema';
import {
  HolidayPolicy,
  HolidayPolicySchema,
} from '../../hr/schemas/holiday-policy.schema';
import {
  WorkWeekPolicy,
  WorkWeekPolicySchema,
} from '../../hr/schemas/work-week-policy.schema';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { HomeBranchService } from '../hr/home-branch.service';
import { AgencyEventsReader } from './agency-events.reader';
import { WorkingDaysService } from './working-days.service';

/**
 * The working-day service and what it reads: the two policy schemas
 * (PAC-161 v3) and, from PAC-169, the agency's events — a `day_off` event
 * closes a day for the people it is for. Imported by the HR feature module
 * and, from PAC-165, by the worker — a job counting business days must never
 * grow its own loop over the policies.
 *
 * `User` and `Branch` are registered for {@link HomeBranchService}: an event
 * for "these branches" reaches the people whose home branch is named.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HolidayPolicy.name, schema: HolidayPolicySchema },
      { name: WorkWeekPolicy.name, schema: WorkWeekPolicySchema },
      { name: AgencyEvent.name, schema: AgencyEventSchema },
      { name: User.name, schema: UserSchema },
      { name: Branch.name, schema: BranchSchema },
    ]),
  ],
  providers: [WorkingDaysService, AgencyEventsReader, HomeBranchService],
  exports: [
    WorkingDaysService,
    AgencyEventsReader,
    HomeBranchService,
    MongooseModule,
  ],
})
export class WorkingDaysModule {}
