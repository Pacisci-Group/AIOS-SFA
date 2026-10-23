import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EmployeeProfile,
  EmployeeProfileSchema,
} from '../../hr/schemas/employee-profile.schema';
import {
  EmployeeProfileEvent,
  EmployeeProfileEventSchema,
} from '../../hr/schemas/employee-profile-event.schema';
import {
  LeavePolicy,
  LeavePolicySchema,
} from '../../hr/schemas/leave-policy.schema';
import {
  WorkScheduleTemplate,
  WorkScheduleTemplateSchema,
} from '../../hr/schemas/work-schedule-template.schema';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { WorkingDaysModule } from '../working-days/working-days.module';
import { EmployeeProfilesService } from './employee-profiles.service';
import { LeavePolicyService } from './leave-policy.service';

/**
 * The policy reader every HR engine goes through (PAC-161), and the employee
 * profiles it reads a person's assignment from (PAC-162). Worker-importable
 * like `WorkingDaysModule`; the HTTP CRUD stays in `hr/`.
 *
 * Imported by `UsersModule` (profile creation at invite), `AuthModule` (the
 * birthday at the setup step), `PlatformModule` (the module-enable catch-up)
 * and the SmartSuite migration, as well as `HrModule`. Schemas only on the
 * users side — one `find` is not worth a module import.
 */
@Module({
  imports: [
    WorkingDaysModule,
    MongooseModule.forFeature([
      { name: LeavePolicy.name, schema: LeavePolicySchema },
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
      { name: EmployeeProfileEvent.name, schema: EmployeeProfileEventSchema },
      { name: WorkScheduleTemplate.name, schema: WorkScheduleTemplateSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [LeavePolicyService, EmployeeProfilesService],
  exports: [LeavePolicyService, EmployeeProfilesService, MongooseModule],
})
export class HrCommonModule {}
