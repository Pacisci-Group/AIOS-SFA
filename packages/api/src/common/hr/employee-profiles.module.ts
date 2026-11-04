import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EmployeeProfile,
  EmployeeProfileSchema,
} from '../../hr/schemas/employee-profile.schema';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { EmployeeProfilesService } from './employee-profiles.service';

/**
 * Employee profiles (PAC-162): the schema and the service that every seam
 * calls. Imported by `UsersModule` (invite / revoke / remove / reactivate and
 * the profile read), `HrModule` (the HR writes), `TimeOffModule` (the
 * accrual job's hire dates), the SmartSuite migration and the demo seed.
 * Registers `User` itself for the catch-up, so it depends on no feature
 * module — the worker boundary admits `common/` and schemas only.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [EmployeeProfilesService],
  exports: [EmployeeProfilesService, MongooseModule],
})
export class EmployeeProfilesModule {}
