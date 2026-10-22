import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AgencyCalendar,
  AgencyCalendarSchema,
} from '../../hr/schemas/agency-calendar.schema';
import {
  AgencyCalendarDay,
  AgencyCalendarDaySchema,
} from '../../hr/schemas/agency-calendar-day.schema';
import { WorkingDaysService } from './working-days.service';

/**
 * The working-day service and the two calendar schemas it reads (PAC-161).
 * Imported by the HR feature module and by the worker — a job counting
 * business days must never grow its own loop over the calendar.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgencyCalendar.name, schema: AgencyCalendarSchema },
      { name: AgencyCalendarDay.name, schema: AgencyCalendarDaySchema },
    ]),
  ],
  providers: [WorkingDaysService],
  exports: [WorkingDaysService, MongooseModule],
})
export class WorkingDaysModule {}
