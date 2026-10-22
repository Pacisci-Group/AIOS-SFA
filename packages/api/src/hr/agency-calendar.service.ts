import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  AccessContext,
  AddCalendarDaysResponse,
  AgencyCalendarDayView,
  AgencyCalendarView,
  CalendarActorView,
  HolidayProposalView,
  HolidayRegionsResponse,
  HolidaySuggestionsResponse,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  countryName,
  isKnownCountry,
  isKnownRegion,
  listCountries,
  listRegions,
  type RawHolidaySuggestion,
  suggestHolidays,
  UnknownHolidayRegionError,
} from '../common/working-days/holiday-suggestions';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import { zonedDate } from '../performance/performance.range';
import { User } from '../users/schemas/user.schema';
import type {
  AddCalendarDaysDto,
  ConfirmHolidayProposalDto,
  UpdateAgencyCalendarDto,
} from './dto/calendar.dto';
import {
  AgencyCalendar,
  type AgencyCalendarDocument,
  type HolidayProposal,
} from './schemas/agency-calendar.schema';
import {
  AgencyCalendarDay,
  type AgencyCalendarDayDocument,
} from './schemas/agency-calendar-day.schema';

type DayLean = {
  _id: Types.ObjectId;
  date: string;
  kind: AgencyCalendarDayView['kind'];
  label: string;
  source: AgencyCalendarDayView['source'];
  reason: string | null;
  createdAt?: Date;
  createdBy?: Types.ObjectId | null;
};

type CalendarLean = {
  workweek?: AgencyCalendarView['workweek'];
  country?: string | null;
  region?: string | null;
  proposals?: HolidayProposal[];
};

/**
 * The agency calendar's read and write side (PAC-161): settings, day rows,
 * holiday suggestions, and the Q4 proposals. The arithmetic — which days are
 * working days — is `WorkingDaysService`'s, and this only asks it.
 *
 * ## The PAC-165 seam
 *
 * {@link addDays} is the one method that learns of a new non-working day.
 * "A new closure flags approved leave on that day for review" (epic §1) hooks
 * in here once time-off requests exist; nothing in this ticket is affected.
 */
@Injectable()
export class AgencyCalendarService {
  constructor(
    @InjectModel(AgencyCalendar.name)
    private readonly calendars: Model<AgencyCalendarDocument>,
    @InjectModel(AgencyCalendarDay.name)
    private readonly days: Model<AgencyCalendarDayDocument>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly workingDays: WorkingDaysService,
  ) {}

  async view(
    access: AccessContext,
    agencyId: string,
    year?: number,
  ): Promise<AgencyCalendarView> {
    const timeZone = access.timeZone;
    const resolvedYear = year ?? zonedDate(new Date(), timeZone).year;
    const range = {
      from: `${resolvedYear}-01-01`,
      to: `${resolvedYear}-12-31`,
    };

    const [settings, doc, rows] = await Promise.all([
      this.workingDays.settings(agencyId),
      this.calendars
        .findOne({ agencyId })
        .select('proposals')
        .lean<CalendarLean | null>(),
      this.days
        .find({
          agencyId,
          removedAt: null,
          date: { $gte: range.from, $lte: range.to },
        })
        .sort({ date: 1 })
        .lean<DayLean[]>(),
    ]);
    const snapshot = await this.workingDays.snapshot(agencyId, range);
    const pending =
      doc?.proposals?.find((proposal) => proposal.status === 'pending') ?? null;

    return {
      workweek: settings.workweek,
      country: settings.country,
      region: settings.region,
      timeZone,
      year: resolvedYear,
      days: await this.toViews(rows),
      workingDaysByMonth: this.workingDays.workingDaysByMonth(
        snapshot,
        resolvedYear,
      ),
      pendingProposal: pending ? toProposalView(pending) : null,
    };
  }

  async update(
    access: AccessContext,
    agencyId: string,
    dto: UpdateAgencyCalendarDto,
  ): Promise<AgencyCalendarView> {
    const current = await this.workingDays.settings(agencyId);
    const country = dto.country === undefined ? current.country : dto.country;
    // A country change invalidates the region unless the body names a new one.
    const region =
      dto.region !== undefined
        ? dto.region
        : dto.country !== undefined && dto.country !== current.country
          ? null
          : current.region;

    if (country !== null && !isKnownCountry(country)) {
      throw new BadRequestException(`Unknown country "${country}".`);
    }
    if (region !== null) {
      if (country === null) {
        throw new BadRequestException('Choose a country before a region.');
      }
      if (!isKnownRegion(country, region)) {
        throw new BadRequestException(
          `Unknown region "${region}" for ${countryName(country) ?? country}.`,
        );
      }
    }

    await this.calendars.updateOne(
      { agencyId },
      {
        $set: {
          ...(dto.workweek !== undefined ? { workweek: dto.workweek } : {}),
          country,
          region,
        },
        $setOnInsert: { agencyId, proposals: [] },
      },
      { upsert: true },
    );
    return this.view(access, agencyId);
  }

  async addDays(
    access: AccessContext,
    agencyId: string,
    dto: AddCalendarDaysDto,
  ): Promise<AddCalendarDaysResponse> {
    const dates = dto.days.map((day) => day.date);
    const taken = await this.days
      .find({ agencyId, removedAt: null, date: { $in: dates } })
      .select('date')
      .lean<{ date: string }[]>();
    if (taken.length > 0) {
      const list = taken
        .map((row) => row.date)
        .sort()
        .join(', ');
      throw new ConflictException(
        `Already on the calendar: ${list}. Remove the existing day first.`,
      );
    }

    // `insertMany` runs the authorship plugin, so `createdBy` is stamped from
    // the request context; `bulkWrite` would not.
    const inserted = await this.days.insertMany(
      dto.days.map((day) => ({
        agencyId,
        date: day.date,
        kind: day.kind,
        label: day.label,
        source: dto.source,
        reason: dto.source === 'manual' ? (day.reason ?? null) : null,
      })),
    );
    const rows = inserted.map((doc) => doc.toObject() as DayLean);
    rows.sort((a, b) => a.date.localeCompare(b.date));
    // PAC-165: flag approved leave on any new `holiday` / `closure` here.
    return { days: await this.toViews(rows, access.userId) };
  }

  async removeDay(
    access: AccessContext,
    agencyId: string,
    id: string,
    reason: string,
  ): Promise<AgencyCalendarDayView> {
    const now = new Date();
    const row = await this.days
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), agencyId, removedAt: null },
        {
          $set: {
            removedAt: now,
            removedBy: new Types.ObjectId(access.userId),
            removeReason: reason,
          },
        },
        { new: true },
      )
      .lean<DayLean | null>();
    if (!row) {
      throw new NotFoundException('Calendar day not found');
    }
    const [view] = await this.toViews([row]);
    return view;
  }

  async suggestions(
    agencyId: string,
    input: { country: string; region?: string; year: number },
  ): Promise<HolidaySuggestionsResponse> {
    let raw: RawHolidaySuggestion[];
    try {
      raw = suggestHolidays({
        country: input.country,
        region: input.region ?? null,
        year: input.year,
      });
    } catch (error) {
      if (error instanceof UnknownHolidayRegionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    const existing = new Set(
      (
        await this.days
          .find({
            agencyId,
            removedAt: null,
            date: { $gte: `${input.year}-01-01`, $lte: `${input.year}-12-31` },
          })
          .select('date')
          .lean<{ date: string }[]>()
      ).map((row) => row.date),
    );
    return {
      country: input.country.toUpperCase(),
      region: input.region ? input.region.toUpperCase() : null,
      year: input.year,
      suggestions: raw.map((row) => ({
        ...row,
        preChecked: row.type === 'public',
        alreadyInCalendar: existing.has(row.date),
      })),
    };
  }

  regions(country?: string): HolidayRegionsResponse {
    if (country && !isKnownCountry(country)) {
      throw new BadRequestException(`Unknown country "${country}".`);
    }
    return {
      countries: listCountries(),
      regions: country ? listRegions(country) : [],
    };
  }

  /**
   * Write the chosen dates of a pending proposal as `proposal` rows and mark
   * it confirmed. Dates already on the calendar are skipped, not refused —
   * the admin may have imported some by hand since the job ran. Idempotent on
   * a decided proposal: 200 with the proposal as it stands.
   */
  async confirmProposal(
    access: AccessContext,
    agencyId: string,
    year: number,
    dto: ConfirmHolidayProposalDto,
  ): Promise<HolidayProposalView> {
    const proposal = await this.pendingProposal(agencyId, year);
    if (proposal.status !== 'pending') return toProposalView(proposal);

    const chosen = new Set(dto.dates);
    const unknown = dto.dates.filter(
      (date) => !proposal.items.some((item) => item.date === date),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Not in the proposal: ${unknown.sort().join(', ')}.`,
      );
    }
    const items = proposal.items.filter((item) => chosen.has(item.date));
    if (items.length > 0) {
      const taken = new Set(
        (
          await this.days
            .find({
              agencyId,
              removedAt: null,
              date: { $in: items.map((item) => item.date) },
            })
            .select('date')
            .lean<{ date: string }[]>()
        ).map((row) => row.date),
      );
      const fresh = items.filter((item) => !taken.has(item.date));
      if (fresh.length > 0) {
        await this.days.insertMany(
          fresh.map((item) => ({
            agencyId,
            date: item.date,
            kind: 'holiday',
            label: item.name,
            source: 'proposal',
            reason: null,
          })),
        );
      }
    }
    return this.decideProposal(access, agencyId, year, 'confirmed');
  }

  async dismissProposal(
    access: AccessContext,
    agencyId: string,
    year: number,
  ): Promise<HolidayProposalView> {
    const proposal = await this.pendingProposal(agencyId, year);
    if (proposal.status !== 'pending') return toProposalView(proposal);
    return this.decideProposal(access, agencyId, year, 'dismissed');
  }

  private async pendingProposal(
    agencyId: string,
    year: number,
  ): Promise<HolidayProposal> {
    const doc = await this.calendars
      .findOne({ agencyId })
      .select('proposals')
      .lean<CalendarLean | null>();
    const proposal = doc?.proposals?.find((p) => p.year === year);
    if (!proposal) {
      throw new NotFoundException(`No holiday proposal for ${year}`);
    }
    return proposal;
  }

  private async decideProposal(
    access: AccessContext,
    agencyId: string,
    year: number,
    status: 'confirmed' | 'dismissed',
  ): Promise<HolidayProposalView> {
    await this.calendars.updateOne(
      { agencyId, 'proposals.year': year, 'proposals.status': 'pending' },
      {
        $set: {
          'proposals.$.status': status,
          'proposals.$.decidedAt': new Date(),
          'proposals.$.decidedBy': new Types.ObjectId(access.userId),
        },
      },
    );
    return toProposalView(await this.pendingProposal(agencyId, year));
  }

  /** Rows → views, with the author's name resolved once per batch. */
  private async toViews(
    rows: DayLean[],
    fallbackActorId?: string,
  ): Promise<AgencyCalendarDayView[]> {
    const ids = new Set<string>();
    for (const row of rows) {
      const id = row.createdBy?.toHexString() ?? fallbackActorId;
      if (id) ids.add(id);
    }
    const actors = await this.actors([...ids]);
    return rows.map((row) => {
      const actorId = row.createdBy?.toHexString() ?? fallbackActorId ?? null;
      return {
        id: row._id.toHexString(),
        date: row.date,
        kind: row.kind,
        label: row.label,
        source: row.source,
        reason: row.reason ?? null,
        createdAt: (row.createdAt ?? new Date()).toISOString(),
        createdBy: actorId ? (actors.get(actorId) ?? null) : null,
      };
    });
  }

  private async actors(ids: string[]): Promise<Map<string, CalendarActorView>> {
    if (ids.length === 0) return new Map();
    const users = await this.users
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select('firstName lastName email')
      .lean<
        {
          _id: Types.ObjectId;
          firstName?: string;
          lastName?: string;
          email: string;
        }[]
      >();
    return new Map(
      users.map((user) => [
        user._id.toHexString(),
        {
          id: user._id.toHexString(),
          name:
            [user.firstName, user.lastName].filter(Boolean).join(' ') ||
            user.email,
        },
      ]),
    );
  }
}

function toProposalView(proposal: HolidayProposal): HolidayProposalView {
  return {
    year: proposal.year,
    status: proposal.status,
    proposedAt: proposal.proposedAt.toISOString(),
    items: proposal.items.map((item) => ({
      date: item.date,
      name: item.name,
      type: item.type,
      substitute: item.substitute,
    })),
  };
}
