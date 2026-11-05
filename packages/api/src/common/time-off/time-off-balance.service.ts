import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  availableHours,
  periodStartFor,
  roundHours,
  UNDECIDED_TIME_OFF_REQUEST_STATUSES,
  type TimeOffPolicyRules,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { agencyTodayIso } from '../../performance/performance.range';
import {
  TimeOffRequest,
  type TimeOffRequestDocument,
} from '../../time-off-requests/schemas/time-off-request.schema';
import { businessDateInstant, businessDay } from '../dates/business-dates';
import { balanceAsOf } from './balance-as-of';
import { HireDatesService } from './hire-dates.service';
import { LeaveLedgerService } from './leave-ledger.service';

/** Where a person stands on one policy with a balance, today. */
export interface TimeOffPosition {
  /** Today on the agency's calendar. */
  today: string;
  hireDate: string | null;
  /** The ledger through the end of today. */
  currentBalance: number;
  /**
   * Approved leave that has not happened yet plus requests still waiting
   * for a decision — the request named in `excludeRequestId` left out.
   */
  otherRequestedHours: number;
  /** Current balance − other requested hours: the card's Available hours. */
  availableHours: number;
  /** The same other leave by date — what the projection walks over. */
  otherLeave: Record<string, number>;
  /** Hours already used in the period today falls in; 0 without a usage cap. */
  usedThisPeriod: number;
}

/**
 * The balance numbers the screens show (PAC-165), defined once.
 *
 * In `common/` because two features read them: the request service (the
 * four lines in the form and the review window, the checks on sending) and
 * the People profile (Available beside Balance). Deriving them in each
 * would be two definitions of "available" waiting to disagree.
 *
 * The **balance is never stored**. Current balance is the ledger as of the
 * end of today; "other requested hours" joins two sources that cannot
 * overlap:
 *
 * - approved leave not yet happened comes from the **ledger** (`used` rows
 *   dated after today, net of reversals), so a request that straddles today
 *   counts its past days in the balance and its future days here, once;
 * - leave still waiting for a decision comes from the **requests**
 *   (Submitted and Changes Requested), which have no ledger rows yet.
 *
 * An Unlimited policy has no balance: every method returns `null` for it.
 */
@Injectable()
export class TimeOffBalanceService {
  constructor(
    @InjectModel(TimeOffRequest.name)
    private readonly requests: Model<TimeOffRequestDocument>,
    private readonly ledger: LeaveLedgerService,
    private readonly hireDates: HireDatesService,
  ) {}

  async position(input: {
    agencyId: string;
    policyId: Types.ObjectId;
    rules: Pick<
      TimeOffPolicyRules,
      'accrualType' | 'resetDateKind' | 'resetMonthDay' | 'annualUsageCapHours'
    >;
    userId: Types.ObjectId;
    timeZone: string;
    /** The request being made, edited or viewed. */
    excludeRequestId?: Types.ObjectId | null;
    now?: Date;
  }): Promise<TimeOffPosition | null> {
    const { agencyId, policyId, rules, userId, timeZone } = input;
    if (rules.accrualType === 'unlimited') return null;
    const now = input.now ?? new Date();
    const today = agencyTodayIso(timeZone, now);
    const asOf = balanceAsOf(timeZone, now);
    const exclude = input.excludeRequestId?.toString() ?? null;

    const [balances, upcoming, waiting, hireDates] = await Promise.all([
      this.ledger.balances(agencyId, policyId, [userId], asOf),
      this.ledger.leaveDays(agencyId, policyId, userId, { from: asOf }),
      this.requests
        .find({
          agencyId,
          employeeId: userId,
          policyId,
          status: { $in: UNDECIDED_TIME_OFF_REQUEST_STATUSES },
          deletedAt: null,
        })
        .select('days totalHours')
        .lean<
          {
            _id: Types.ObjectId;
            totalHours?: number;
            days?: { date: string; hours: number }[];
          }[]
        >(),
      this.hireDates.forUsers(agencyId, [userId]),
    ]);

    const otherLeave: Record<string, number> = {};
    let otherRequestedHours = 0;
    const add = (date: string, hours: number) => {
      if (hours <= 0) return;
      otherLeave[date] = roundHours((otherLeave[date] ?? 0) + hours);
      otherRequestedHours += hours;
    };
    for (const row of upcoming) {
      if (exclude && row.requestId?.toString() === exclude) continue;
      const date = businessDay(row.effectiveAt, timeZone);
      if (date) add(date, row.hours);
    }
    for (const request of waiting) {
      if (exclude && request._id.toString() === exclude) continue;
      for (const day of request.days ?? []) add(day.date, day.hours);
    }

    const hireDate = hireDates.get(userId.toString()) ?? null;
    const currentBalance = balances.get(userId.toString())?.current ?? 0;
    return {
      today,
      hireDate,
      currentBalance,
      otherRequestedHours: roundHours(otherRequestedHours),
      availableHours: availableHours(currentBalance, otherRequestedHours),
      otherLeave,
      usedThisPeriod:
        rules.annualUsageCapHours === null
          ? 0
          : await this.usedThisPeriod(
              agencyId,
              policyId,
              userId,
              periodStartFor(rules, hireDate, today),
              asOf,
              timeZone,
            ),
    };
  }

  /**
   * Leave taken since the period began, through today. With no period start
   * (the policy has never reset for this person) everything counts.
   */
  private async usedThisPeriod(
    agencyId: string,
    policyId: Types.ObjectId,
    userId: Types.ObjectId,
    periodStart: string | null,
    asOf: Date,
    timeZone: string,
  ): Promise<number> {
    const rows = await this.ledger.leaveDays(agencyId, policyId, userId, {
      from: periodStart
        ? businessDateInstant(periodStart, timeZone)
        : undefined,
      before: asOf,
    });
    return roundHours(rows.reduce((sum, row) => sum + row.hours, 0));
  }
}
