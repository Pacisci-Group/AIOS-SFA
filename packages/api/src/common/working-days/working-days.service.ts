import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DEFAULT_WORK_WEEK_DAYS,
  holidaysBetween,
  type HolidayPolicyRules,
  type ScheduledDay,
  type WorkSchedule,
  type WorkWeekDay,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  TimeOffPolicy,
  type TimeOffPolicyDocument,
} from '../../hr/schemas/time-off-policy.schema';
import {
  type CalendarDate,
  toIsoDate,
  zonedDate,
} from '../../performance/performance.range';
import {
  addBusinessDays,
  type CalendarSnapshot,
  isWorkingDay,
  scheduledDaysBetween,
  snapshotFrom,
  workingDaysBetween,
  workingDaysInMonth,
} from './working-days';

/** A person's week and holidays, as their two policies say. */
export interface PersonCalendar {
  snapshot: CalendarSnapshot;
  schedule: WorkSchedule;
  /** The policies it came from; `null` = the default (Mon–Fri / no holidays). */
  holidayPolicyId: string | null;
  workWeekPolicyId: string | null;
}

/**
 * The one working-day service (PAC-161 v3): builds a person's
 * {@link CalendarSnapshot} from their Holiday and Work week policies and
 * answers every "is this a working day" question from it. Lives in
 * `common/` so PAC-165's worker jobs may import it.
 *
 * Working days are **per person** now: two people in the same agency can be
 * in different Holiday policies and work different weeks. Someone in no Work
 * week policy works Mon–Fri 9–5; someone in no Holiday policy has no
 * holidays. Never throws for a person in neither — that is a working state.
 */
@Injectable()
export class WorkingDaysService {
  constructor(
    @InjectModel(TimeOffPolicy.name)
    private readonly policies: Model<TimeOffPolicyDocument>,
  ) {}

  /**
   * `range` bounds the holidays computed (inclusive `YYYY-MM-DD`). Holidays
   * are computed by rule, not read, so the range is required: an unbounded
   * span would be every year there is.
   */
  async forPerson(
    agencyId: string,
    userId: string,
    range: { from: string; to: string },
  ): Promise<PersonCalendar> {
    const rows = await this.policies
      .find({
        agencyId,
        archivedAt: null,
        type: { $in: ['holiday', 'work_week'] },
        memberIds: new Types.ObjectId(userId),
      })
      .select('type holiday workWeek')
      .lean<
        {
          _id: Types.ObjectId;
          type: 'holiday' | 'work_week';
          holiday?: HolidayPolicyRules;
          workWeek?: { days: WorkWeekDay[] };
        }[]
      >();
    const holidayPolicy = rows.find((row) => row.type === 'holiday') ?? null;
    const workWeekPolicy = rows.find((row) => row.type === 'work_week') ?? null;

    const days = workWeekPolicy?.workWeek?.days?.length
      ? workWeekPolicy.workWeek.days
      : DEFAULT_WORK_WEEK_DAYS;
    const holidays = holidayPolicy?.holiday
      ? holidaysBetween(
          {
            holidays: holidayPolicy.holiday.holidays ?? [],
            customHolidays: holidayPolicy.holiday.customHolidays ?? [],
          },
          range.from,
          range.to,
        )
      : [];

    return {
      snapshot: snapshotFrom(
        days.map((day) => day.weekday),
        holidays.map((row) => ({ date: row.date, kind: 'holiday' as const })),
      ),
      schedule: toSchedule(days),
      holidayPolicyId: holidayPolicy?._id.toString() ?? null,
      workWeekPolicyId: workWeekPolicy?._id.toString() ?? null,
    };
  }

  /** Today on the agency's calendar. */
  todayFor(timeZone: string, now: Date = new Date()): CalendarDate {
    return zonedDate(now, timeZone);
  }

  isWorkingDay(calendar: CalendarSnapshot, date: CalendarDate): boolean {
    return isWorkingDay(calendar, date);
  }

  workingDaysInMonth(
    calendar: CalendarSnapshot,
    year: number,
    month: number,
  ): number {
    return workingDaysInMonth(calendar, year, month);
  }

  workingDaysBetween(
    calendar: CalendarSnapshot,
    from: CalendarDate,
    to: CalendarDate,
  ): number {
    return workingDaysBetween(calendar, from, to);
  }

  addBusinessDays(
    calendar: CalendarSnapshot,
    date: CalendarDate,
    n: number,
  ): CalendarDate {
    return addBusinessDays(calendar, date, n);
  }

  scheduledDaysBetween(
    calendar: CalendarSnapshot,
    schedule: WorkSchedule,
    from: CalendarDate,
    to: CalendarDate,
  ): ScheduledDay[] {
    return scheduledDaysBetween(calendar, schedule, from, to);
  }

  static isoOf(date: CalendarDate): string {
    return toIsoDate(date);
  }
}

/** A Work week policy's rows as the schedule `scheduledDaysBetween` takes. */
export function toSchedule(days: readonly WorkWeekDay[]): WorkSchedule {
  const schedule: WorkSchedule = {};
  for (const day of days) {
    schedule[day.weekday] = { start: day.start, end: day.end };
  }
  return schedule;
}
