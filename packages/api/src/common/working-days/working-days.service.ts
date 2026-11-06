import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  addIsoDays,
  DEFAULT_WORK_WEEK_DAYS,
  holidaysBetween,
  type ScheduledDay,
  type WorkSchedule,
  type WorkWeekDay,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  HolidayPolicy,
  type HolidayPolicyDocument,
} from '../../hr/schemas/holiday-policy.schema';
import {
  WorkWeekPolicy,
  type WorkWeekPolicyDocument,
} from '../../hr/schemas/work-week-policy.schema';
import {
  type CalendarDate,
  toIsoDate,
  zonedDate,
} from '../../performance/performance.range';
import { AgencyEventsReader, effectOf } from './agency-events.reader';
import {
  addBusinessDays,
  type CalendarSnapshot,
  isWorkingDay,
  scheduledDaysBetween,
  snapshotFrom,
  workingDaysBetween,
  workingDaysInMonth,
} from './working-days';

/** The agency event behind a closed or blocked day. */
export interface PersonCalendarEvent {
  eventId: string;
  name: string;
}

/**
 * A person's week and holidays, as their two policies say, and the agency
 * events that are for them (PAC-169).
 */
export interface PersonCalendar {
  snapshot: CalendarSnapshot;
  schedule: WorkSchedule;
  /** The policies it came from; `null` = the default (Mon–Fri / no holidays). */
  holidayPolicyId: string | null;
  workWeekPolicyId: string | null;
  /**
   * By `YYYY-MM-DD`, inside the range asked for. `dayOff` days are already
   * in the snapshot as closures; `blackout` days are still working days —
   * what they block is asking for time off, which is the caller's check.
   */
  events: {
    dayOff: ReadonlyMap<string, PersonCalendarEvent>;
    blackout: ReadonlyMap<string, PersonCalendarEvent>;
  };
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
 *
 * From PAC-169 a day is also closed by an agency event marked **day off**
 * whose audience includes the person — the first closure that is not a
 * holiday since the agency calendar went (PAC-161 v3). A holiday on the same
 * date keeps its name: "Holiday" says more than "Office closed".
 */
@Injectable()
export class WorkingDaysService {
  constructor(
    @InjectModel(HolidayPolicy.name)
    private readonly holidayPolicies: Model<HolidayPolicyDocument>,
    @InjectModel(WorkWeekPolicy.name)
    private readonly workWeekPolicies: Model<WorkWeekPolicyDocument>,
    private readonly agencyEvents: AgencyEventsReader,
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
    // At most one active policy of each kind holds the person.
    const member = {
      agencyId,
      archivedAt: null,
      memberIds: new Types.ObjectId(userId),
    };
    const [holidayPolicy, workWeekPolicy, events] = await Promise.all([
      this.holidayPolicies
        .findOne(member)
        .select('holidays customHolidays')
        .lean<
          Pick<HolidayPolicy, 'holidays' | 'customHolidays'> & {
            _id: Types.ObjectId;
          }
        >(),
      this.workWeekPolicies
        .findOne(member)
        .select('days')
        .lean<{ _id: Types.ObjectId; days?: WorkWeekDay[] }>(),
      this.agencyEvents.forPerson(agencyId, userId, range.from, range.to, {
        effects: ['day_off', 'blackout'],
      }),
    ]);

    // Oldest event first, so the earliest one names a day two events share.
    const dayOff = new Map<string, PersonCalendarEvent>();
    const blackout = new Map<string, PersonCalendarEvent>();
    for (const event of events) {
      const target = effectOf(event) === 'day_off' ? dayOff : blackout;
      const first = event.firstDay > range.from ? event.firstDay : range.from;
      const last = event.lastDay < range.to ? event.lastDay : range.to;
      for (let day = first; day <= last; day = addIsoDays(day, 1)) {
        if (!target.has(day)) {
          target.set(day, { eventId: event._id.toString(), name: event.name });
        }
      }
    }

    const days = workWeekPolicy?.days?.length
      ? workWeekPolicy.days
      : DEFAULT_WORK_WEEK_DAYS;
    const holidays = holidayPolicy
      ? holidaysBetween(
          {
            holidays: holidayPolicy.holidays ?? [],
            customHolidays: holidayPolicy.customHolidays ?? [],
          },
          range.from,
          range.to,
        )
      : [];

    return {
      // Holidays last: the snapshot keeps the last row for a date.
      snapshot: snapshotFrom(
        days.map((day) => day.weekday),
        [
          ...[...dayOff.keys()].map((date) => ({
            date,
            kind: 'closure' as const,
          })),
          ...holidays.map((row) => ({
            date: row.date,
            kind: 'holiday' as const,
          })),
        ],
      ),
      schedule: toSchedule(days),
      holidayPolicyId: holidayPolicy?._id.toString() ?? null,
      workWeekPolicyId: workWeekPolicy?._id.toString() ?? null,
      events: { dayOff, blackout },
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
