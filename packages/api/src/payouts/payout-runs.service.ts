import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  PAYOUT_RUN_GENERATING,
  type AccessContext,
  type PayoutRunResponse,
  type PayStatementStatus,
} from '@sfa/shared';
import { Types } from 'mongoose';
import { DEFAULT_AGENCY_TIME_ZONE } from '../common/dates/time-zones';
import { generateRun } from '../common/payouts/generate-run';
import {
  currentMonthIn,
  isMonthAfter,
  monthWindow,
} from '../common/payouts/month-window';
import { claimRun } from '../common/payouts/run-claim';
import { PayoutModelsService } from './payout-models.service';
import {
  EMPTY_RUN_COUNTS,
  runCountsFrom,
  runView,
  type LeanRun,
  type RunCounts,
} from './payout-views';
import { agencyOf, statementVisibility } from './statement-visibility';

/**
 * A month's run on the Payouts page (PAC-178): read it, and — the owner —
 * generate or recalculate it.
 *
 * Generate runs inline in the request, through the same claim and the same
 * `generateRun` the 1st-of-month job uses. A month is tens of statements, so
 * the request is the simplest place for it; the claim makes a click during
 * the job's run a 409 rather than a second computation.
 */
@Injectable()
export class PayoutRunsService {
  private readonly logger = new Logger(PayoutRunsService.name);

  constructor(private readonly payoutModels: PayoutModelsService) {}

  private get models() {
    return this.payoutModels.models;
  }

  private async timeZoneOf(agencyId: string): Promise<string> {
    const agency = await this.models.agency
      .findById(agencyId)
      .select({ timezone: 1 })
      .lean<{ timezone?: string } | null>();
    return agency?.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
  }

  /** Counts and totals over the run's statements the caller may see. */
  private async scopedCounts(
    access: AccessContext,
    branchId: string | null,
    runId: Types.ObjectId,
  ): Promise<RunCounts> {
    const rows = await this.models.payStatement.aggregate<{
      _id: PayStatementStatus;
      count: number;
      grossPremium: number;
      netCommission: number;
    }>([
      { $match: { ...statementVisibility(access, branchId), runId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          grossPremium: { $sum: '$totals.grossPremium' },
          netCommission: { $sum: '$totals.netCommission' },
        },
      },
    ]);
    return rows.length ? runCountsFrom(rows) : EMPTY_RUN_COUNTS;
  }

  async get(
    access: AccessContext,
    branchId: string | null,
    month: string,
  ): Promise<PayoutRunResponse> {
    const agencyId = agencyOf(access);
    const [timeZone, run] = await Promise.all([
      this.timeZoneOf(agencyId),
      this.models.payoutRun.findOne({ agencyId, month }).lean<LeanRun | null>(),
    ]);
    return {
      month,
      currentMonth: currentMonthIn(timeZone),
      run: run
        ? runView(run, await this.scopedCounts(access, branchId, run._id))
        : null,
    };
  }

  /**
   * Generate `month`, or recalculate it: every draft and disputed statement
   * is recomputed, sent and accepted ones are left as they were. 400 for a
   * month that has not started; 409 `PAYOUT_RUN_GENERATING` while the job or
   * another Generate is computing it.
   */
  async generate(
    access: AccessContext,
    branchId: string | null,
    month: string,
  ): Promise<PayoutRunResponse> {
    const agencyId = agencyOf(access);
    const timeZone = await this.timeZoneOf(agencyId);
    const now = new Date();
    if (isMonthAfter(month, currentMonthIn(timeZone, now))) {
      throw new BadRequestException(
        'That month has not started yet, so there is nothing to calculate.',
      );
    }
    const claim = await claimRun(this.models.payoutRun, {
      agencyId,
      month,
      trigger: 'manual',
      timeZone,
      window: monthWindow(month, timeZone),
      actorId: access.userId,
      now,
    });
    if (claim.outcome !== 'claimed') {
      throw new ConflictException({
        code: PAYOUT_RUN_GENERATING,
        message:
          'This month is being calculated right now. Try again in a minute.',
      });
    }
    const result = await generateRun(this.models, {
      runId: claim.runId,
      agencyId,
      now,
    });
    this.logger.log(
      `Payout run ${result.runId} (${month}) for agency ${agencyId}: ` +
        `${result.drafted} drafted, ${result.untouched} left as sent`,
    );
    return this.get(access, branchId, month);
  }
}
