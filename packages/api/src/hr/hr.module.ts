import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkingDaysModule } from '../common/working-days/working-days.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AgencyCalendarController } from './agency-calendar.controller';
import { AgencyCalendarService } from './agency-calendar.service';

/**
 * The HR module's HTTP surface (PAC-161): the agency holiday calendar. The
 * engine it exists to feed lives in `common/working-days/`, which this imports
 * rather than re-registering — the worker imports the same module. Time-off
 * policies (PAC-174) will register their own controllers here.
 */
@Module({
  imports: [
    WorkingDaysModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Agency.name, schema: AgencySchema },
    ]),
  ],
  controllers: [AgencyCalendarController],
  providers: [AgencyCalendarService],
})
export class HrModule {}
