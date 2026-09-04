import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { BugReportsController } from './bug-reports.controller';
import { BugReportsService } from './bug-reports.service';
import { PlatformBugReportsController } from './platform-bug-reports.controller';
import { PlatformBugReportsService } from './platform-bug-reports.service';
import { BugReport, BugReportSchema } from './schemas/bug-report.schema';

/**
 * Bug reports — both halves.
 *
 * **Reporter side:** `BugReportsController` on `bug-reports`, reachable by any
 * authenticated user with no permission at all.
 * **Platform side:** `PlatformBugReportsController` on `platform/bug-reports`,
 * behind `platform:bugs:read` / `:write`.
 *
 * `Agency` and `User` are registered here rather than reached for through their
 * own modules because this only ever *reads* them — an agency name for a queue
 * row, the reporter's email at filing time — and needs no service to do it.
 * Registering another module's schema is the house pattern; see the note in
 * `mailers.module.ts`.
 *
 * `StorageService` comes from a global module and needs no import.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BugReport.name, schema: BugReportSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [BugReportsController, PlatformBugReportsController],
  providers: [BugReportsService, PlatformBugReportsService],
  exports: [MongooseModule],
})
export class BugReportsModule {}
