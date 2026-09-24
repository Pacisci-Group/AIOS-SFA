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
import { RenewalMaterializationService } from '../../common/renewal/renewal-materialization.service';
import { Agency } from '../../platform/schemas/agency.schema';
import { forEachAgency } from '../agency-sweep';

/**
 * Minimal surface of Inngest's `step`. Narrow on purpose — it is the seam a
 * test substitutes; see `sweep-event-log.fn.ts` for why `run` returns
 * `unknown`.
 */
type StepLike = {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
};

/**
 * Keeps every agency's renewal cycles in line with its policy book.
 *
 * ## Why this exists (PAC-99)
 *
 * The scan used to run **inline on the desk read**. `renewalDesk()` called
 * `materializeRenewalCycles` before returning rows, so whichever request won
 * the throttle paid for rolling renewal anchors forward, scanning ninety days
 * of the policy book and upserting cycles — while a CSR waited on the
 * response. Most requests skipped it and one paid for all of them, which is
 * the "the desk is randomly slow" shape that got reported.
 *
 * It was a deliberate stopgap, and both call sites said so: *"there is no
 * cron, so reading the desk is what makes renewals appear."* There is one now.
 *
 * ## Batched, unlike the status sweep
 *
 * `SyncTicketStatusFn` issues a handful of indexed range updates and needs no
 * cap. This does per-candidate upserts against a book that can be large, so
 * `RENEWAL_SCAN_BATCH` bounds each pass and the resumable cursor in
 * `RenewalScanState` carries the position forward. A backlog drains over
 * several ticks rather than being attempted at once — the same bargain
 * `sweep-event-log.fn.ts` makes.
 *
 * ## The throttle is still the lock
 *
 * `claimScanWindow` is untouched and still guards each agency. It was there to
 * stop concurrent *requests* double-scanning; it now also stops a worker run
 * and a lingering caller colliding, and stops two worker replicas doing the
 * same. Nothing about this function needs to know that — which is the point of
 * having left the lock where it was.
 */
@Injectable()
@InngestFunction()
export class MaterializeRenewalCyclesFn implements InngestFunctionProvider {
  private readonly logger = new Logger(MaterializeRenewalCyclesFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly renewals: RenewalMaterializationService,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<Agency>,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'materialize-renewal-cycles',
        name: 'Materialize renewal cycles',

        /**
         * Every five minutes, against a per-agency throttle of ten
         * (`RENEWAL_SCAN_INTERVAL_MS`). The tick being the finer of the two is
         * deliberate: the throttle decides how often an agency is *actually*
         * scanned, and a tick that merely finds the window closed costs one
         * indexed `findOneAndUpdate` that misses. Matching the two would mean
         * every skipped tick pushed the real interval out to twenty.
         */
        triggers: [cron('*/5 * * * *')],

        /** One at a time; overlapping sweeps would contend on the same claims. */
        concurrency: { limit: 1 },

        /**
         * No retries. The next tick recomputes from current state and the scan
         * is idempotent, so retrying is a slower route to the same place —
         * and a failure here usually means the database is unhappy, which
         * retrying does not help.
         */
        retries: 0,
      },
      ({ step }) => this.handle(step),
    );
  }

  /** Lifted out of `createFunction` so tests can call it directly. */
  async handle(step: StepLike): Promise<{ swept: number; failed: number }> {
    const result = (await step.run('materialize', () =>
      forEachAgency(this.agencyModel, this.logger, (agencyId) =>
        this.renewals.materializeForAgency(agencyId),
      ),
    )) as { swept: number; failed: number };

    if (result.failed > 0) {
      this.logger.warn(
        `${result.failed} of ${result.swept + result.failed} agency scans ` +
          `failed; their desks show the cycles they already had`,
      );
    }

    return result;
  }
}
