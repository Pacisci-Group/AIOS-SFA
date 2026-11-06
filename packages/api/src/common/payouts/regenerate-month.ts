import type { PayoutRunTrigger } from '@sfa/shared';
import type { Model, Types } from 'mongoose';
import type { Agency } from '../../platform/schemas/agency.schema';
import { DEFAULT_AGENCY_TIME_ZONE } from '../dates/time-zones';
import {
  generateRun,
  type GenerateRunResult,
  type PayoutModels,
} from './generate-run';
import { monthWindow } from './month-window';
import { claimRun } from './run-claim';

/**
 * Claim a month and calculate it — what the owner's Generate / Recalculate
 * does, and what a committed chargeback report does after it (PAC-180). One
 * path, so the two can never claim or generate a month differently.
 *
 * `busy` when the month is being calculated right now (the claim belongs to
 * someone else). A generation that throws has already marked its run
 * `failed`; the error is rethrown.
 */
export async function regenerateMonth(
  models: PayoutModels,
  args: {
    agencyId: string;
    month: string;
    timeZone: string;
    trigger: PayoutRunTrigger;
    actorId: string | null;
    now: Date;
  },
): Promise<
  | { outcome: 'generated'; result: GenerateRunResult }
  | { outcome: 'busy'; runId: Types.ObjectId | null }
> {
  const { agencyId, month, timeZone, trigger, actorId, now } = args;
  const claim = await claimRun(models.payoutRun, {
    agencyId,
    month,
    trigger,
    timeZone,
    window: monthWindow(month, timeZone),
    actorId,
    now,
  });
  if (claim.outcome !== 'claimed') {
    return { outcome: 'busy', runId: claim.runId };
  }
  const result = await generateRun(models, {
    runId: claim.runId,
    agencyId,
    now,
  });
  return { outcome: 'generated', result };
}

/** The agency's time zone — the calendar its pay months are on. */
export async function agencyTimeZone(
  agencyModel: Model<Agency>,
  agencyId: string,
): Promise<string> {
  const agency = await agencyModel
    .findById(agencyId)
    .select({ timezone: 1 })
    .lean<{ timezone?: string } | null>();
  return agency?.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
}
