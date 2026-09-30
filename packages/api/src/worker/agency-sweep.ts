import { Logger } from '@nestjs/common';
import type { Model, Types } from 'mongoose';
import type { Agency } from '../platform/schemas/agency.schema';

/**
 * Run a job once per tenant.
 *
 * Every scheduled function that touches tenant data needs this, and none of
 * them can get it the way the request path does. `AccessContext` is built from
 * a request — a cron has no request, no user and no agency, so a job written
 * against `access` cannot simply be pointed at a schedule. The tenant loop has
 * to live somewhere, and one shared loop is better than each function growing
 * its own subtly different one.
 *
 * ## Why per-agency, rather than one query across the collection
 *
 * A single `updateMany` over every tenant reads better and runs worse: the
 * indexes it would need to use are all prefixed with `agencyId`
 * (`{agencyId, 'renewal.dueAt'}` and friends), so a query without one cannot
 * use them and degrades to a collection scan. Looping the agencies keeps every
 * sweep on an index.
 *
 * It also bounds the blast radius of a bad tenant, which is the other half of
 * the contract here: **one agency's failure must not abort the sweep.** A
 * single tenant with corrupt data would otherwise silently stop every tenant
 * after it in the loop from being swept at all, and the symptom — some
 * agencies' tickets quietly going stale — looks nothing like the cause. Errors
 * are logged per agency and the loop continues; the return value says how many
 * failed so a caller can surface it.
 */
export interface AgencySweepResult {
  swept: number;
  failed: number;
}

export async function forEachAgency(
  agencyModel: Model<Agency>,
  logger: Logger,
  job: (agencyId: Types.ObjectId) => Promise<void>,
): Promise<AgencySweepResult> {
  // Suspended and inactive tenants are excluded: nobody is reading their
  // queues, and sweeping them is work that buys nothing. A tenant coming back
  // to `active` is picked up by the next tick with no backfill needed, because
  // these jobs derive from current state rather than replaying history.
  const agencies = await agencyModel
    .find({ status: 'active' }, { _id: 1 })
    .lean();

  let failed = 0;
  for (const agency of agencies) {
    try {
      await job(agency._id);
    } catch (error) {
      failed += 1;
      logger.error(
        `Sweep failed for agency ${String(agency._id)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  return { swept: agencies.length - failed, failed };
}
