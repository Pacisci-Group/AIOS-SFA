import type { Logger } from '@nestjs/common';
import type { Model, Types } from 'mongoose';

/**
 * Bring `Household.totalActivePolicies` back in line with reality, after a
 * write that added or retired a policy.
 *
 * Lived on the ticket-anchored transfer until PAC-126 retired it, which meant
 * the **sold path never recounted at all** — every ordinary sale left the
 * stored count where the migration put it. The household card computes its
 * headline from the live policy list so nobody saw it there, but the Clients
 * list sorts on the stored field. Every booking passes here now: the Sold
 * intake, and the 1-800 service intake (PAC-173 PR 5), which adds a policy with
 * no deal.
 *
 * Recounted rather than incremented so a re-run is still correct, and
 * best-effort: callers run it after their commit, and a stale count is a worse
 * reason to fail a request than no reason.
 */
export async function recountHouseholdPolicies(
  models: { policy: Model<any>; household: Model<any> },
  householdId: Types.ObjectId,
  logger: Pick<Logger, 'warn'>,
): Promise<void> {
  try {
    const active = await models.policy.countDocuments({
      householdId,
      active: true,
    });
    await models.household.updateOne(
      { _id: householdId },
      { $set: { totalActivePolicies: active } },
    );
  } catch (error) {
    logger.warn(
      `Household policy recount failed for ${householdId.toString()}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
