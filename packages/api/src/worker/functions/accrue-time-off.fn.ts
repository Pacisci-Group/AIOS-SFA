import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { cron } from 'inngest';
import { Model } from 'mongoose';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import { TimeOffAccrualService } from '../../common/time-off/time-off-accrual.service';
import { Agency } from '../../platform/schemas/agency.schema';
import { forEachAgency } from '../agency-sweep';

/** Minimal surface of Inngest's `step` — the seam a test substitutes. */
type StepLike = {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
};

export interface AccrueTimeOffResult {
  /** `allocation` rows written: monthly twelfths and yearly grants. */
  allocations: number;
  /** People whose period was reset. */
  resets: number;
  /** Agencies swept and agencies whose sweep threw. */
  swept: number;
  failed: number;
}

/**
 * Accrues time off and runs the yearly resets (PAC-174): the full twelfth
 * on the 1st for Monthly policies, and on each person's reset day — a fixed
 * date for everyone, or their hire anniversary — the carryover cap and, for
 * Yearly policies, the whole year's hours.
 *
 * ## One cron, every agency's own calendar
 *
 * Ticks every thirty minutes in UTC, like `set-users-away.fn.ts`, and asks
 * per agency what *its* calendar says (`Agency.timezone`); a half-hour grid
 * lands on every zone's midnight. There is no date marker on the agency:
 * every row the job writes carries a `periodKey`, and the ledger's partial
 * unique index makes the second write of a period a no-op, so a tick that
 * repeats, a retry, or a second replica changes nothing. The body is
 * `TimeOffAccrualService.sweepAgency` in `common/`, which the HR module can
 * reach too.
 *
 * ## What a missed day costs
 *
 * A whole local day the worker slept through is not back-filled: the next
 * tick posts the next period, and the gap is visible by `periodKey`. An
 * admin adjustment (PAC-165) is the tool for it.
 */
@Injectable()
@InngestFunction()
export class AccrueTimeOffFn implements InngestFunctionProvider {
  private readonly logger = new Logger(AccrueTimeOffFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    @InjectModel(Agency.name) private readonly agencyModel: Model<Agency>,
    private readonly accrual: TimeOffAccrualService,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'accrue-time-off',
        name: 'Accrue time off and run yearly resets',
        triggers: [cron('*/30 * * * *')],
        // Serial: the rows are idempotent, the log counts are honest only serially.
        concurrency: { limit: 1 },
        // The next tick recomputes from current state; retrying is a slower route there.
        retries: 0,
      },
      ({ step }) => this.handle(step),
    );
  }

  /** Public so tests call it with a `now` of their choosing. */
  async handle(
    step: StepLike,
    now: Date = new Date(),
  ): Promise<AccrueTimeOffResult> {
    const result = (await step.run('accrue-time-off', async () => {
      let allocations = 0;
      let resets = 0;
      const sweep = await forEachAgency(
        this.agencyModel,
        this.logger,
        async (agencyId) => {
          const agency = await this.accrual.sweepAgency(agencyId, now);
          allocations += agency.allocations;
          resets += agency.resets;
        },
      );
      return { allocations, resets, ...sweep };
    })) as AccrueTimeOffResult;

    if (result.allocations || result.resets) {
      this.logger.log(
        `Wrote ${result.allocations} allocation(s) and reset ${result.resets} balance(s) across ${result.swept} agenc${result.swept === 1 ? 'y' : 'ies'}`,
      );
    }
    if (result.failed > 0) {
      this.logger.warn(
        `${result.failed} agency sweep(s) failed; their rows are retried by the next tick`,
      );
    }
    return result;
  }
}
