import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { cron } from 'inngest';
import { Model, Types } from 'mongoose';
import { urgencyRankFor } from '@sfa/shared';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import {
  ServiceTicket,
  type ServiceTicketDocument,
} from '../../crm/schemas/service-ticket.schema';
import {
  STEP_PATHS,
  nowOpenMatch,
  pastDueMatch,
} from '../../common/scheduling/step-status.query';
import { Agency } from '../../platform/schemas/agency.schema';
import { forEachAgency } from '../agency-sweep';

/**
 * Minimal surface of Inngest's `step` that this function uses.
 *
 * Narrow on purpose, as in `sweep-event-log.fn.ts`: it is the seam a test
 * substitutes. `run` returns `unknown` rather than `T` because Inngest
 * serialises a step's result to JSON and parses it back before the next step
 * sees it — the declared type would be a lie, and typing it honestly is what
 * makes the cast below a decision rather than an accident.
 */
type StepLike = {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
};

/**
 * Advances the stored `status` of scheduled-call tickets as their deadlines
 * pass.
 *
 * ## Why this exists
 *
 * A ticket carrying an onboarding or renewal call takes its status from that
 * call's timing: `waiting` until it opens, `open` until it is due, `overdue`
 * after. Those two transitions are the only ones in the system that happen
 * through the passage of time rather than through somebody doing something, so
 * there is no write to hang them off. The codebase's answer was to derive the
 * status on every read and leave the column stale.
 *
 * That worked until two things needed the column to be true:
 *
 * - **The KPI strip** counted `status === 'overdue'` against the stored value
 *   and reported near-zero while the queue beside it, deriving on read, showed
 *   hundreds (PAC-102).
 * - **Paging the queue** needs to sort by urgency, and *you cannot index a
 *   computed field*. Deriving at query time pages correctly and still scans
 *   the caller's whole scope and sorts it in memory, which is the cost paging
 *   exists to remove (PAC-98).
 *
 * So the column becomes the truth and this keeps it true.
 *
 * ## What it is not
 *
 * Not a state machine, and not a place to put business rules. It writes
 * exactly what `deriveStepStatus` would return, which makes every run
 * idempotent and reproducible from the step fields — a bad tick is recoverable
 * by fixing the rule and running again, never by reconstructing lost state.
 * `resolved` and `waiting` are deliberately absent: both are written at the
 * moment they happen (completion, and creation), so sweeping for them would be
 * work with no transition behind it.
 *
 * ## The lag
 *
 * A ticket is stale between crossing its deadline and the next tick — five
 * minutes, against an SLA measured in days. That is the accepted cost of an
 * indexable sort key; see `docs/plans/pac-98-service-ticket-scaling-implementation-plan.md`
 * for the no-lag alternative and why it was not taken.
 */
@Injectable()
@InngestFunction()
export class SyncTicketStatusFn implements InngestFunctionProvider {
  private readonly logger = new Logger(SyncTicketStatusFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<Agency>,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'sync-ticket-status',
        name: 'Advance scheduled ticket statuses',

        /**
         * Every five minutes, matching the event-log sweeper. The interval is
         * the staleness window, and nothing downstream reads these statuses
         * more finely than a working day.
         */
        triggers: [cron('*/5 * * * *')],

        /**
         * One at a time. Two overlapping runs would issue the same updates and
         * the second would modify nothing — harmless, but it makes
         * `modifiedCount` a lie, and that number is the only signal anyone has
         * that this job is doing something.
         */
        concurrency: { limit: 1 },

        /**
         * No retries, same reasoning as the event-log sweeper: the next tick is
         * five minutes away and computes from current state, so it fixes
         * whatever this run missed. Retrying is a slower path to the same
         * place.
         */
        retries: 0,
      },
      ({ step }) => this.handle(step),
    );
  }

  /** Lifted out of `createFunction` so tests can call it directly. */
  async handle(step: StepLike): Promise<{ transitions: number }> {
    // One `now` for the whole run. Reading the clock per query would let a
    // ticket fall between two of them — not matched as `open` by the first
    // because it was not yet available, not matched as `overdue` by the second
    // because that ran a millisecond later — and it would sit wrong until the
    // next tick with nothing to show why.
    const now = new Date();

    // The cast is safe against the JSON round trip: every field is a number,
    // so nothing is lost on the way through (a `Date` here would come back a
    // string, which is the trap this shape avoids).
    const result = (await step.run('advance-statuses', async () => {
      let transitions = 0;

      const sweep = await forEachAgency(
        this.agencyModel,
        this.logger,
        async (agencyId) => {
          transitions += await this.advanceAgency(agencyId, now);
        },
      );

      return { transitions, ...sweep };
    })) as { transitions: number; swept: number; failed: number };

    if (result.transitions > 0) {
      this.logger.log(
        `Advanced ${result.transitions} ticket status(es) across ` +
          `${result.swept} agencies`,
      );
    }
    if (result.failed > 0) {
      this.logger.warn(
        `${result.failed} agency sweep(s) failed; their tickets keep the ` +
          `status they had until the next tick`,
      );
    }

    return { transitions: result.transitions };
  }

  /**
   * Both transitions, for both step kinds, in one tenant.
   *
   * Four indexed range updates rather than a scan: `{agencyId, '<step>.dueAt'}`
   * and `{agencyId, '<step>.availableAt'}` already exist for onboarding and
   * renewal alike, which is why this can afford to run every five minutes over
   * every agency.
   *
   * Order matters. `overdue` runs first because it outranks `open` in the
   * derivation: a step that became available and blew its deadline between two
   * ticks must end up `overdue`, and running the `open` sweep first would set
   * it to `open` for the `overdue` sweep to immediately correct — two writes
   * and a misleading count, for one transition.
   *
   * No batch cap, unlike the event-log sweeper. That one replays N events one
   * step at a time and must not stampede a recovering system; this issues four
   * `updateMany`s whose cost is the size of an index range, so a backlog after
   * downtime is one larger write rather than N times the work.
   */
  private async advanceAgency(
    agencyId: Types.ObjectId,
    now: Date,
  ): Promise<number> {
    let transitions = 0;

    for (const stepPath of STEP_PATHS) {
      for (const [status, match] of [
        ['overdue', pastDueMatch(stepPath, now)],
        ['open', nowOpenMatch(stepPath, now)],
      ] as const) {
        const { modifiedCount } = await this.ticketModel.updateMany(
          { agencyId, ...match },
          { $set: { status, urgencyRank: urgencyRankFor(status) } },
        );
        transitions += modifiedCount;
      }
    }

    return transitions;
  }
}
