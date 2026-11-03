import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DEFAULT_WORKWEEK,
  type CalendarDayKind,
  type ScheduledDay,
  type Weekday,
  type WorkSchedule,
} from '@sfa/shared';
import { Model } from 'mongoose';
import {
  AgencyCalendar,
  type AgencyCalendarDocument,
} from '../../hr/schemas/agency-calendar.schema';
import {
  AgencyCalendarDay,
  type AgencyCalendarDayDocument,
} from '../../hr/schemas/agency-calendar-day.schema';
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

/** What a lean read of the settings document yields; defaults do not apply. */
export type AgencyCalendarLean = {
  workweek?: Weekday[];
  country?: string | null;
  region?: string | null;
};

export interface CalendarSettings {
  workweek: Weekday[];
  country: string | null;
  region: string | null;
}

/**
 * The one working-day service (PAC-161): loads an agency's calendar once into
 * a {@link CalendarSnapshot} and answers every "is this a working day" question
 * from it. Lives in `common/` so PAC-165's worker jobs may import it.
 *
 * Never throws for an agency with no calendar document: a database that
 * predates the `hr_module` migration, or a test fixture, gets the Mon–Fri
 * default and no closed days. HR is then "a workweek and nothing more", which
 * is a working state, not an error.
 */
@Injectable()
export class WorkingDaysService {
  constructor(
    @InjectModel(AgencyCalendar.name)
    private readonly calendars: Model<AgencyCalendarDocument>,
    @InjectModel(AgencyCalendarDay.name)
    private readonly days: Model<AgencyCalendarDayDocument>,
  ) {}

  async settings(agencyId: string): Promise<CalendarSettings> {
    const doc = await this.calendars
      .findOne({ agencyId })
      .select('workweek country region')
      .lean<AgencyCalendarLean | null>();
    return {
      workweek: doc?.workweek?.length ? doc.workweek : [...DEFAULT_WORKWEEK],
      country: doc?.country ?? null,
      region: doc?.region ?? null,
    };
  }

  /**
   * The calendar as a snapshot. `range` bounds the rows read (inclusive
   * `YYYY-MM-DD` strings); omit it for the whole history — the rows are small,
   * and a job walking an unbounded span wants them all.
   */
  async snapshot(
    agencyId: string,
    range?: { from: string; to: string },
  ): Promise<CalendarSnapshot> {
    const settings = await this.settings(agencyId);
    const rows = await this.days
      .find({
        agencyId,
        // Spelled out: the active-row unique index is partial on it.
        removedAt: null,
        ...(range ? { date: { $gte: range.from, $lte: range.to } } : {}),
      })
      .select('date kind')
      .lean<{ date: string; kind: CalendarDayKind }[]>();
    return snapshotFrom(settings.workweek, rows);
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

  /** `'YYYY-MM'` → working days, for every month of `year`. */
  workingDaysByMonth(
    calendar: CalendarSnapshot,
    year: number,
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (let month = 1; month <= 12; month += 1) {
      out[`${year}-${String(month).padStart(2, '0')}`] = workingDaysInMonth(
        calendar,
        year,
        month,
      );
    }
    return out;
  }

  static isoOf(date: CalendarDate): string {
    return toIsoDate(date);
  }
}
