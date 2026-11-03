import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AgencyPermission } from '@sfa/shared';
import { cron } from 'inngest';
import { Model, Types } from 'mongoose';
import { PermissionHoldersService } from '../../common/access/permission-holders.service';
import { localClock } from '../../common/dates/time-zones';
import { DEFAULT_AGENCY_TIME_ZONE } from '../../common/dates/time-zones';
import {
  countryName,
  regionName,
  type RawHolidaySuggestion,
  suggestHolidays,
  UnknownHolidayRegionError,
} from '../../common/working-days/holiday-suggestions';
import {
  AgencyCalendar,
  type AgencyCalendarDocument,
} from '../../hr/schemas/agency-calendar.schema';
import { notificationRequested } from '../../inngest/events';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import { InngestService } from '../../inngest/inngest.service';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import { Agency } from '../../platform/schemas/agency.schema';
import { forEachAgency } from '../agency-sweep';

type StepLike = {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
};

export interface ProposeNextYearHolidaysResult {
  /** Agencies that received a new proposal this tick. */
  proposed: number;
  /** Of those, how many had an admin to notify. */
  notified: number;
}

/** The first month, on the agency's calendar, in which the job may propose. */
const PROPOSAL_MONTH = 10;

type CalendarLean = {
  country?: string | null;
  region?: string | null;
  proposals?: { year: number }[];
};

/**
 * Proposes next year's holidays to each agency once it is Q4 on its own
 * calendar (PAC-161, epic §1).
 *
 * ## Proposes, never inserts
 *
 * A new closure flags approved leave on that day for review (PAC-165), so
 * the job writes a **proposal** — the suggestions `date-holidays` makes for
 * the agency's stored country and region — and tells the `agency:hr:admin`
 * holders. Confirming is one click on the settings page, and it is theirs.
 *
 * ## One cron, every agency's own calendar
 *
 * Daily in UTC; each agency is asked whether its local month is October or
 * later, the same one-cron-every-agency shape as `set-users-away.fn.ts`.
 *
 * ## Idempotent by construction
 *
 * The claim is a conditional `$push` on `proposals.year`: a second tick, a
 * second replica, or a retry finds the year already there and does nothing.
 * The notification's `dedupeKey` carries the agency and the year, so even a
 * replayed event cannot double-notify.
 *
 * Skipped silently: an agency with no calendar document or no country (the
 * import dialog still works for them), a suspended one (`forEachAgency`), and
 * one whose region the package no longer knows (logged, not thrown — one bad
 * tenant must not stop the sweep).
 */
@Injectable()
@InngestFunction()
export class ProposeNextYearHolidaysFn implements InngestFunctionProvider {
  private readonly logger = new Logger(ProposeNextYearHolidaysFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly events: InngestService,
    @InjectModel(Agency.name) private readonly agencyModel: Model<Agency>,
    @InjectModel(AgencyCalendar.name)
    private readonly calendarModel: Model<AgencyCalendarDocument>,
    private readonly holders: PermissionHoldersService,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'propose-next-year-holidays',
        name: "Propose next year's holidays to each agency in Q4",
        // Daily at 06:00 UTC — early morning everywhere in the Americas.
        triggers: [cron('0 6 * * *')],
        concurrency: { limit: 1 },
        // The next tick is a day away and recomputes from current state.
        retries: 0,
      },
      ({ step }) => this.handle(step),
    );
  }

  async handle(
    step: StepLike,
    now: Date = new Date(),
  ): Promise<ProposeNextYearHolidaysResult> {
    const result = (await step.run('propose-next-year-holidays', async () => {
      let proposed = 0;
      let notified = 0;
      const sweep = await forEachAgency(
        this.agencyModel,
        this.logger,
        async (agencyId) => {
          const outcome = await this.sweepAgency(agencyId, now);
          if (outcome === null) return;
          proposed += 1;
          if (outcome.notified) notified += 1;
        },
      );
      return { proposed, notified, ...sweep };
    })) as ProposeNextYearHolidaysResult & { swept: number; failed: number };

    if (result.proposed > 0) {
      this.logger.log(
        `Proposed next year's holidays to ${result.proposed} agenc${result.proposed === 1 ? 'y' : 'ies'} ` +
          `(${result.notified} notified)`,
      );
    }
    if (result.failed > 0) {
      this.logger.warn(
        `${result.failed} agency sweep(s) failed; they are retried on the next tick`,
      );
    }
    return { proposed: result.proposed, notified: result.notified };
  }

  /** One agency. `null` when nothing was proposed. */
  private async sweepAgency(
    agencyId: Types.ObjectId,
    now: Date,
  ): Promise<{ notified: boolean } | null> {
    const agency = await this.agencyModel
      .findById(agencyId)
      .select('timezone')
      .lean<{ timezone?: string } | null>();
    if (!agency) return null;
    const timeZone = agency.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
    const clock = localClock(now, timeZone);
    const localYear = Number(clock.date.slice(0, 4));
    const localMonth = Number(clock.date.slice(5, 7));
    if (localMonth < PROPOSAL_MONTH) return null;
    const nextYear = localYear + 1;

    const calendar = await this.calendarModel
      .findOne({ agencyId: agencyId.toHexString() })
      .select('country region proposals')
      .lean<CalendarLean | null>();
    if (!calendar?.country) return null;
    if (calendar.proposals?.some((proposal) => proposal.year === nextYear)) {
      return null;
    }

    let items: RawHolidaySuggestion[];
    try {
      items = suggestHolidays({
        country: calendar.country,
        region: calendar.region ?? null,
        year: nextYear,
      });
    } catch (error) {
      if (error instanceof UnknownHolidayRegionError) {
        this.logger.warn(
          `Agency ${agencyId.toHexString()}: ${error.message} — no proposal for ${nextYear}`,
        );
        return null;
      }
      throw error;
    }
    if (items.length === 0) return null;

    // Claim first: only one caller can push the year.
    const claim = await this.calendarModel.updateOne(
      { agencyId: agencyId.toHexString(), 'proposals.year': { $ne: nextYear } },
      {
        $push: {
          proposals: {
            year: nextYear,
            status: 'pending',
            proposedAt: now,
            items: items.map((item) => ({
              date: item.date,
              name: item.name,
              type: item.type,
              substitute: item.substitute,
            })),
            decidedAt: null,
            decidedBy: null,
          },
        },
      },
    );
    if (claim.modifiedCount === 0) return null;

    const recipients = await this.holders.usersHolding(
      agencyId,
      AgencyPermission.HrAdmin,
    );
    if (recipients.length === 0) return { notified: false };

    await this.events.send(notificationRequested, {
      type: 'hr.holidays_proposed',
      recipientIds: recipients.map((id) => id.toHexString()),
      agencyId: agencyId.toHexString(),
      actorId: null,
      entity: {
        kind: 'holidayProposal',
        id: `${agencyId.toHexString()}:${nextYear}`,
      },
      data: {
        agencyId: agencyId.toHexString(),
        year: nextYear,
        count: items.length,
        countryName: countryName(calendar.country),
        regionName: calendar.region
          ? regionName(calendar.country, calendar.region)
          : null,
      },
      dedupeKey: `hr.holidays_proposed:${agencyId.toHexString()}:${nextYear}`,
    });
    return { notified: true };
  }
}
