import { Inject, Injectable, Logger } from '@nestjs/common';
import { cron } from 'inngest';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import { InngestService } from '../../inngest/inngest.service';
import { EventLogService } from '../../inngest/event-log/event-log.service';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';

/**
 * How many stale rows one sweep will replay.
 *
 * A cap rather than "everything": after an outage the backlog could be large,
 * and re-emitting thousands of events in one run would spike the very system
 * that just came back. The next tick five minutes later takes the next batch, so
 * nothing is dropped — it drains at a bounded rate. The count is logged when the
 * cap is hit, because a silent truncation reads as "nothing left to do".
 */
const SWEEP_BATCH_SIZE = 100;

/**
 * Puts events Inngest never finished back into the queue.
 *
 * This is the half of the outbox that makes it a recovery mechanism rather than
 * just a record. Rows sit `pending` for two reasons, and it cannot tell them
 * apart — which is fine, because the fix is identical:
 *
 * - `client.send()` failed, or the API died before it returned. Inngest never
 *   knew the event existed. **No Inngest backend can recover this**, which is
 *   why the outbox exists at all.
 * - Inngest accepted it and then lost it — a hard crash with an unsnapshotted
 *   in-memory queue, or a droplet replaced out from under its SQLite volume.
 *
 * ## Why this is safe to run live
 * `InngestService.resend` preserves the original event id, and Inngest
 * deduplicates on that for 24h. So a row Inngest still holds is a **no-op**, and
 * a row it genuinely lost re-runs — because whatever destroyed its state
 * destroyed its dedupe memory too. See that method for the corollary limitation.
 */
@Injectable()
@InngestFunction()
export class SweepEventLogFn implements InngestFunctionProvider {
  private readonly logger = new Logger(SweepEventLogFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly eventLog: EventLogService,
    private readonly events: InngestService,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'sweep-event-log',
        name: 'Sweep stale events',

        /**
         * Every five minutes. Worth noting that this schedule survives the
         * disaster it exists for: cron registrations are derived from the
         * function definitions Inngest syncs from `/api/inngest`, so an Inngest
         * that came back with an empty database re-registers this on its next
         * sync and starts sweeping without anyone intervening.
         */
        triggers: [cron('*/5 * * * *')],

        /**
         * One at a time. Two overlapping sweeps would read the same batch of
         * `pending` rows and re-emit each twice — harmless, since the ids
         * deduplicate, but it doubles the work for nothing.
         */
        concurrency: { limit: 1 },

        /**
         * No retries. If a sweep fails the next tick is five minutes away and
         * will pick up exactly the same rows — retrying is a slower way of
         * arriving at the same place, and a failing sweep usually means the
         * database or Inngest is unhappy, which retrying does not help.
         */
        retries: 0,
      },
      ({ step }) => this.handle(step),
    );
  }

  /**
   * The handler body, lifted out of `createFunction` so it can be called
   * directly — same seam and same reasoning as `SendInviteEmailFn.handle`.
   *
   * Takes no event: a cron trigger supplies a scheduled payload nothing here
   * needs. That is also why the event-log middleware skips these runs — there is
   * no `eventLogId` on a cron event, so the sweeper does not log itself.
   */
  async handle(step: StepLike): Promise<{ replayed: number }> {
    const stale = (await step.run('find-stale', () =>
      this.eventLog.findStale(SWEEP_BATCH_SIZE),
    )) as Awaited<ReturnType<EventLogService['findStale']>>;

    if (stale.length === 0) return { replayed: 0 };

    this.logger.warn(
      `Found ${stale.length} stale event(s) to replay` +
        (stale.length === SWEEP_BATCH_SIZE
          ? ` (batch cap hit — more may remain, next sweep will take them)`
          : ''),
    );

    // Sequential, and each in its own step. `step.run` memoizes on success, so a
    // sweep that dies partway through does not re-emit what it already did.
    // Sequential rather than parallel because this runs when something has just
    // gone wrong, and a burst is the last thing a recovering system needs.
    for (const row of stale) {
      await step.run(`replay-${row.id}`, () => this.events.resend(row));
    }

    return { replayed: stale.length };
  }
}

/**
 * The slice of Inngest's step tooling this handler uses.
 *
 * Narrow on purpose, exactly as in `send-invite-email.fn.ts`: it is the seam a
 * test substitutes, and depending on the full step API would make that
 * substitution a chore for no benefit.
 */
interface StepLike {
  // Returns `unknown` rather than `T` because Inngest returns `Jsonify<T>` — a
  // step's result is serialised to JSON and parsed back before the next step
  // sees it. Callers narrow with a cast they can justify.
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
}
