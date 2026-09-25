import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { END_OF_DAY_USER_AVAILABILITY } from '@sfa/shared';
import { cron } from 'inngest';
import { Model, Types } from 'mongoose';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import { endOfDaySweepDate } from '../../common/dates/end-of-day';
import { DEFAULT_AGENCY_TIME_ZONE } from '../../common/dates/time-zones';
import { Agency } from '../../platform/schemas/agency.schema';
import { User, type UserDocument } from '../../users/schemas/user.schema';
import { forEachAgency } from '../agency-sweep';

/**
 * Minimal surface of Inngest's `step`. Narrow on purpose — it is the seam a
 * test substitutes; see `sweep-event-log.fn.ts` for why `run` returns
 * `unknown`.
 */
type StepLike = {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
};

export interface SetUsersAwayResult {
  /** Users whose availability changed to `away`. */
  flipped: number;
  /** Agencies that were due and were swept this tick. */
  agenciesFlipped: number;
}

/** What a lean read of the agency yields — defaults do not apply on `.lean()`. */
type AgencySweepLean = {
  timezone?: string;
  availabilitySweep?: { lastAwayDate?: string | null };
};

/**
 * Sets every active user of an agency to Away at the end of its working day
 * (PAC-139 §6a).
 *
 * ## Why this exists
 *
 * David asked for a status that marks people out of office once the day ends,
 * set for them rather than by them, so that the Manager view and the Command
 * Center's "assign to" picker stop treating someone who went home at six as
 * still taking leads at nine. Nobody is flipped back: each person sets
 * themself Available when they start work, which is the point — the morning
 * click is the person saying "I'm here".
 *
 * ## One cron, every agency's own 8 PM
 *
 * There is no cron per agency and no `TZ=` prefix on the schedule. A single
 * trigger pinned to Central time would be right only while every tenant is in
 * Oklahoma, which is exactly the assumption `Agency.timezone` exists to
 * remove. Instead this ticks every thirty minutes in UTC and asks, per agency,
 * what its own clock says. Thirty minutes rather than an hour so a half-hour
 * zone (India, Newfoundland) still lands on its 8 PM; the only zones a
 * half-hour grid misses are the two quarter-hour ones, which are noted and
 * accepted.
 *
 * ## The date marker is what makes a tick safe to miss or to repeat
 *
 * `endOfDaySweepDate` answers "due, and for which local date" from the agency's
 * zone and `availabilitySweep.lastAwayDate`. A tick the worker slept through
 * is caught up by the next one that evening; a tick that fires twice, or a
 * second worker replica, finds the date already claimed and does nothing.
 * Without it a `hour === 20` match would quietly skip any night the worker
 * happened to be deploying.
 *
 * ## Claim first, then flip
 *
 * The marker is written *before* the users are, with a conditional update
 * that only one caller can win. That ordering picks which single-crash failure
 * to accept: a crash between the two writes skips that agency's night (and
 * says so in the log on the next tick, since nothing flipped), rather than
 * re-flipping — on a later tick — someone who had already come back to
 * Available after 8 PM. "Whatever you set after 8 PM sticks" is the rule a
 * person can rely on; the other ordering would break it exactly when it is
 * hardest to notice.
 *
 * ## What it does not touch
 *
 * Deactivated and invited accounts (`isActive: false`) — their availability is
 * meaningless and every reader filters them out first. Platform admins — they
 * are not an agency's people. Suspended and inactive agencies —
 * `forEachAgency` skips them, as for every sweep. Users already Away — an
 * `updateMany` that excludes them keeps `modifiedCount` honest.
 *
 * `updateMany` runs with no request context, so `authorshipPlugin` leaves
 * `updatedBy` null, which reads as "system" — the intended author.
 */
@Injectable()
@InngestFunction()
export class SetUsersAwayFn implements InngestFunctionProvider {
  private readonly logger = new Logger(SetUsersAwayFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<Agency>,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'set-users-away',
        name: 'Set users Away at the end of the working day',

        /**
         * Every thirty minutes, in UTC. Which tick is *the* 8 PM tick differs
         * per agency and per season (DST), and the handler works that out; the
         * schedule just has to land on every zone's top and bottom of the hour.
         */
        triggers: [cron('*/30 * * * *')],

        /**
         * One at a time. The conditional claim makes an overlap harmless, but
         * a serial run keeps the counts in the log meaning what they say.
         */
        concurrency: { limit: 1 },

        /**
         * No retries. The next tick is thirty minutes away and recomputes
         * from current state — the date marker means it will still find the
         * night pending — so retrying is a slower route to the same place.
         */
        retries: 0,
      },
      ({ step }) => this.handle(step),
    );
  }

  /**
   * Lifted out of `createFunction` so tests can call it directly. `now` is a
   * parameter for the same reason: the whole job is "what time is it in each
   * agency", and a test must be able to make it any evening it likes.
   */
  async handle(
    step: StepLike,
    now: Date = new Date(),
  ): Promise<SetUsersAwayResult> {
    // Every field is a number, so the JSON round trip through Inngest loses
    // nothing and the cast is honest.
    const result = (await step.run('set-users-away', async () => {
      let flipped = 0;
      let agenciesFlipped = 0;

      const sweep = await forEachAgency(
        this.agencyModel,
        this.logger,
        async (agencyId) => {
          const count = await this.sweepAgency(agencyId, now);
          if (count !== null) {
            agenciesFlipped += 1;
            flipped += count;
          }
        },
      );

      return { flipped, agenciesFlipped, ...sweep };
    })) as SetUsersAwayResult & { swept: number; failed: number };

    if (result.agenciesFlipped > 0) {
      this.logger.log(
        `Set ${result.flipped} user(s) away across ${result.agenciesFlipped} ` +
          `agenc${result.agenciesFlipped === 1 ? 'y' : 'ies'} at end of day`,
      );
    }
    if (result.failed > 0) {
      this.logger.warn(
        `${result.failed} agency sweep(s) failed; their users keep the ` +
          `status they had until the next tick`,
      );
    }

    return { flipped: result.flipped, agenciesFlipped: result.agenciesFlipped };
  }

  /**
   * One agency. `null` when it is not due; otherwise the number of users whose
   * status changed.
   */
  private async sweepAgency(
    agencyId: Types.ObjectId,
    now: Date,
  ): Promise<number | null> {
    const agency = await this.agencyModel
      .findById(agencyId)
      .select('timezone availabilitySweep')
      .lean<AgencySweepLean | null>();
    if (!agency) return null;

    // `.lean()` applies no schema defaults, and an agency created before the
    // field existed reads `undefined` until the backfill migration has run.
    const timeZone = agency.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
    const localDate = endOfDaySweepDate(
      now,
      timeZone,
      agency.availabilitySweep?.lastAwayDate,
    );
    if (localDate === null) return null;

    // `$ne` also matches a missing marker, so a first-ever sweep claims too.
    const claim = await this.agencyModel.updateOne(
      { _id: agencyId, 'availabilitySweep.lastAwayDate': { $ne: localDate } },
      {
        $set: {
          'availabilitySweep.lastAwayDate': localDate,
          'availabilitySweep.lastAwayAt': now,
        },
      },
    );
    // Somebody else claimed tonight between our read and our write.
    if (claim.modifiedCount === 0) return null;

    const { modifiedCount } = await this.userModel.updateMany(
      {
        agencyId,
        isActive: true,
        isPlatformAdmin: { $ne: true },
        availability: { $ne: END_OF_DAY_USER_AVAILABILITY },
      },
      { $set: { availability: END_OF_DAY_USER_AVAILABILITY } },
    );

    return modifiedCount;
  }
}
