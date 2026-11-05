import {
  STALE_PAYOUT_RUN_MINUTES,
  type PayoutRunStatus,
  type PayoutRunTrigger,
} from '@sfa/shared';
import { Types, type Model } from 'mongoose';
import type { InstantWindow } from '../../performance/performance.range';
import type { PayoutRun } from '../../payouts/schemas/payout-run.schema';

export type RunClaim =
  /** This caller owns the generation and must finish it (`ready` or `failed`). */
  | { outcome: 'claimed'; runId: Types.ObjectId }
  /** The job found the month already drafted after it ended: nothing to do. */
  | { outcome: 'exists'; runId: Types.ObjectId }
  /** Somebody else is generating it right now. */
  | { outcome: 'busy'; runId: Types.ObjectId | null };

/**
 * Claim one agency's month for generation (PAC-178 §4).
 *
 * The first claim is an upsert on the unique `{agencyId, month}`: only the
 * caller whose upsert **inserted** the row owns it, so the hourly job, a
 * second worker and the owner's Generate can race without computing the
 * month twice at once. An existing run is taken over with a conditional
 * update on the status and start time it was read with — again, one winner:
 *
 * | existing run | job (`cron`) | Generate (`manual`) |
 * |---|---|---|
 * | `generating`, started under 30 min ago | busy | busy |
 * | `generating`, older (its worker died) | take over | take over |
 * | `failed` | take over | take over |
 * | `ready`, generated after the month ended | exists — drafted once | take over (recalculate) |
 * | `ready`, generated while the month was still running | take over | take over |
 *
 * The last row is why a Generate on the 31st does not stop the 1st-of-month
 * draft: a month generated before it ended is partial, and the job finishes
 * it. Recalculating only rewrites draft and disputed statements, so a sent
 * one is never touched by either.
 */
export async function claimRun(
  model: Model<PayoutRun>,
  args: {
    agencyId: string;
    month: string;
    trigger: PayoutRunTrigger;
    timeZone: string;
    window: InstantWindow;
    actorId: string | null;
    now: Date;
  },
): Promise<RunClaim> {
  const { agencyId, month, trigger, now } = args;
  const generatedBy = args.actorId ? new Types.ObjectId(args.actorId) : null;
  const window = { from: args.window.$gte, to: args.window.$lt };

  const inserted = await model.updateOne(
    { agencyId, month },
    {
      $setOnInsert: {
        agencyId,
        month,
        status: 'generating',
        trigger,
        timeZone: args.timeZone,
        window,
        startedAt: now,
        finishedAt: null,
        generatedBy,
        error: null,
      },
    },
    { upsert: true },
  );
  if (inserted.upsertedCount === 1 && inserted.upsertedId) {
    return { outcome: 'claimed', runId: inserted.upsertedId };
  }

  const existing = await model
    .findOne({ agencyId, month })
    .select({ status: 1, startedAt: 1, window: 1 })
    .lean<{
      _id: Types.ObjectId;
      status: PayoutRunStatus;
      startedAt: Date;
      window?: { to?: Date } | null;
    } | null>();
  if (!existing) return { outcome: 'busy', runId: null };

  const staleBefore = now.getTime() - STALE_PAYOUT_RUN_MINUTES * 60_000;
  if (
    existing.status === 'generating' &&
    existing.startedAt.getTime() > staleBefore
  ) {
    return { outcome: 'busy', runId: existing._id };
  }
  const monthEnd = (existing.window?.to ?? args.window.$lt).getTime();
  if (
    trigger === 'cron' &&
    existing.status === 'ready' &&
    existing.startedAt.getTime() >= monthEnd
  ) {
    return { outcome: 'exists', runId: existing._id };
  }

  const taken = await model.updateOne(
    {
      _id: existing._id,
      status: existing.status,
      startedAt: existing.startedAt,
    },
    {
      $set: {
        status: 'generating',
        trigger,
        // The zone and window are re-read: a month recalculated after the
        // agency corrected its zone is computed on the corrected calendar.
        timeZone: args.timeZone,
        window,
        startedAt: now,
        finishedAt: null,
        generatedBy,
        error: null,
      },
    },
  );
  return taken.modifiedCount === 1
    ? { outcome: 'claimed', runId: existing._id }
    : { outcome: 'busy', runId: existing._id };
}
