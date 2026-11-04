import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  LeaveLedger,
  LeaveLedgerSchema,
} from '../../hr/schemas/leave-ledger.schema';
import {
  TimeOffPolicy,
  TimeOffPolicySchema,
} from '../../hr/schemas/time-off-policy.schema';
import { Agency, AgencySchema } from '../../platform/schemas/agency.schema';
import { EmployeeProfilesModule } from '../hr/employee-profiles.module';
import { HireDatesService } from './hire-dates.service';
import { LeaveLedgerService } from './leave-ledger.service';
import { TimeOffAccrualService } from './time-off-accrual.service';

/**
 * Time off policies and their ledger (PAC-174): the two schemas and the
 * services both the HR feature module and the worker need. Imported by
 * `HrModule` and `WorkerModule` — the accrual job must read the same rows
 * and post through the same ledger service as the policy page, and the
 * worker boundary admits `common/` and schemas, never a feature service.
 */
@Module({
  imports: [
    // The accrual job's hire dates (PAC-162).
    EmployeeProfilesModule,
    MongooseModule.forFeature([
      { name: TimeOffPolicy.name, schema: TimeOffPolicySchema },
      { name: LeaveLedger.name, schema: LeaveLedgerSchema },
      // The accrual job reads each agency's time zone off its row.
      { name: Agency.name, schema: AgencySchema },
    ]),
  ],
  providers: [LeaveLedgerService, HireDatesService, TimeOffAccrualService],
  exports: [
    LeaveLedgerService,
    HireDatesService,
    TimeOffAccrualService,
    MongooseModule,
  ],
})
export class TimeOffModule {}
