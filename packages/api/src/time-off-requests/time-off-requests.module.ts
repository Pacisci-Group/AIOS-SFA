import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { TimeOffModule } from '../common/time-off/time-off.module';
import { WorkingDaysModule } from '../common/working-days/working-days.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  TimeOffRequest,
  TimeOffRequestSchema,
} from './schemas/time-off-request.schema';
import { TimeOffController } from './time-off.controller';
import { TimeOffRequestsService } from './time-off-requests.service';
import { TimeOffReviewersService } from './time-off-reviewers.service';

/**
 * Time off requests (PAC-165): the `/time-off` surface.
 *
 * `TimeOffModule` (`common/`) brings the policies, the ledger and the
 * balance numbers — shared with the HR policies page, the People profile
 * and the worker's accrual job. `WorkingDaysModule` turns a date range into
 * the person's scheduled hours. `PermissionsModule` is here for one thing:
 * resolving who reviews a request, which is why the reviewer lookup lives
 * in this module and not in `common/time-off` (the worker imports that).
 *
 * `InngestService`, `SequenceService` and `TransactionRunner` come from
 * global modules.
 */
@Module({
  imports: [
    TimeOffModule,
    WorkingDaysModule,
    PermissionsModule,
    MongooseModule.forFeature([
      { name: TimeOffRequest.name, schema: TimeOffRequestSchema },
      { name: User.name, schema: UserSchema },
      { name: Branch.name, schema: BranchSchema },
    ]),
  ],
  controllers: [TimeOffController],
  providers: [TimeOffRequestsService, TimeOffReviewersService],
  exports: [TimeOffRequestsService],
})
export class TimeOffRequestsModule {}
