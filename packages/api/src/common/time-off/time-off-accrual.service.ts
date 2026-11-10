import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  accrualPeriodKey,
  cappedAllocation,
  monthlyAccrualDue,
  monthlyAccrualHours,
  resetDueOn,
  resetPeriodKey,
  resetRows,
  roundHours,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  TimeOffPolicy,
  type TimeOffPolicyDocument,
} from '../../hr/schemas/time-off-policy.schema';
import { Agency } from '../../platform/schemas/agency.schema';
import { agencyTodayIso } from '../../performance/performance.range';
import { businessDateInstant } from '../dates/business-dates';
import { DEFAULT_AGENCY_TIME_ZONE } from '../dates/time-zones';
import { HireDatesService } from './hire-dates.service';
import { LeaveLedgerService } from './leave-ledger.service';

export interface AgencyAccrualResult {
  /** `allocation` rows written this call (monthly twelfths and yearly grants). */
  allocations: number;
  /** People whose period was reset this call. */
  resets: number;
}

/** A lean fixed-amount policy; only the fields the sweep reads. */
type PolicyLean = Pick<
  TimeOffPolicy,
  | 'accrualType'
  | 'accrualFrequency'
  | 'resetDateKind'
  | 'resetMonthDay'
  | 'hoursPerYear'
  | 'maxBalanceHours'
  | 'carryoverCapHours'
> & { _id: Types.ObjectId; memberIds?: Types.ObjectId[] };

/**
 * The per-agency body of the `accrue-time-off` job (PAC-174): posts the
 * monthly twelfth on the 1st and runs each person's yearly reset on their
 * reset day, both on the agency's own calendar. Lives in `common/` so the
 * worker may call it; the maths is `@sfa/shared`'s, the rows are the ledger
 * service's.
 *
 * ## Today, on the agency's clock
 *
 * One cron ticks every half hour in UTC and asks, per agency, what its
 * calendar says (`agencyTodayIso`). Every tick of a given local day asks the
 * same question and reaches the same `periodKey`, so the first tick after
 * local midnight writes and the rest find the rows there.
 *
 * ## Reset first, then accrue
 *
 * On a day that is both (a monthly policy resetting on 1 January) the period
 * closes before the twelfth lands in the new one. The balance a reset
 * computes from is read once; when the reset's rows were already written by
 * an earlier tick that balance already includes them, and `postOnce` saying
 * "not written" is how this tells, so the yearly grant is capped against the
 * right number either way.
 *
 * ## What it does not do
 *
 * Back-fill a day the worker slept through entirely: the next tick posts
 * the next period, and the gap is visible by `periodKey`. A manual
 * adjustment (PAC-165) is the tool for that. Unlimited policies have no
 * balance and are never read; archived ones are skipped with everything
 * else under `archivedAt`.
 */
@Injectable()
export class TimeOffAccrualService {
  private readonly logger = new Logger(TimeOffAccrualService.name);

  constructor(
    @InjectModel(TimeOffPolicy.name)
    private readonly policies: Model<TimeOffPolicyDocument>,
    @InjectModel(Agency.name) private readonly agencies: Model<Agency>,
    private readonly ledger: LeaveLedgerService,
    private readonly hireDates: HireDatesService,
  ) {}

  async sweepAgency(
    agencyId: Types.ObjectId,
    now: Date,
  ): Promise<AgencyAccrualResult> {
    const result: AgencyAccrualResult = { allocations: 0, resets: 0 };
    const agency = await this.agencies
      .findById(agencyId)
      .select('timezone')
      .lean<{ timezone?: string } | null>();
    if (!agency) return result;
    // `.lean()` applies no defaults; an agency predating the field reads undefined.
    const timeZone = agency.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
    const today = agencyTodayIso(timeZone, now);
    const effectiveAt = businessDateInstant(today, timeZone);
    const agencyKey = agencyId.toString();

    const policies = await this.policies
      .find({
        agencyId: agencyKey,
        archivedAt: null,
        accrualType: 'fixed_amount',
      })
      .select(
        'accrualType accrualFrequency resetDateKind resetMonthDay hoursPerYear maxBalanceHours carryoverCapHours memberIds',
      )
      .lean<PolicyLean[]>();

    for (const policy of policies) {
      const members = policy.memberIds ?? [];
      if (!members.length || !policy.hoursPerYear) continue;
      const monthly =
        policy.accrualFrequency === 'monthly' && monthlyAccrualDue(today);
      const hireDates =
        policy.resetDateKind === 'hire_anniversary'
          ? await this.hireDates.forUsers(agencyKey, members)
          : null;
      const due = members.filter((userId) =>
        resetDueOn(policy, hireDates?.get(userId.toString()) ?? null, today),
      );
      if (!monthly && !due.length) continue;

      const balances = await this.ledger.balances(policy._id, members);
      const source = (kind: 'accrual' | 'reset') => ({ kind, id: policy._id });
      const base = (userId: Types.ObjectId) =>
        balances.get(userId.toString()) ?? 0;

      for (const userId of due) {
        const balance = base(userId);
        const rows = resetRows(balance, policy.carryoverCapHours);
        const lost = roundHours(-(rows.expiration + rows.carryover));
        const key = resetPeriodKey(today);
        const common = {
          agencyId: agencyKey,
          policyId: policy._id,
          userId,
          effectiveAt,
          periodKey: key,
        };
        const wrote = await this.ledger.postOnce({
          ...common,
          kind: 'expiration',
          hours: rows.expiration,
          reason: lost > 0 ? 'carryover_cap' : null,
          source: source('reset'),
        });
        await this.ledger.postOnce({
          ...common,
          kind: 'carryover',
          hours: rows.carryover,
          reason: lost > 0 ? 'carryover_cap' : null,
          source: source('reset'),
        });
        // Already reset by an earlier tick today: the balance read includes it.
        const afterReset = wrote ? rows.carryover : balance;
        balances.set(userId.toString(), afterReset);
        if (wrote) result.resets += 1;

        if (policy.accrualFrequency === 'yearly') {
          const hours = cappedAllocation(
            policy.hoursPerYear,
            afterReset,
            policy.maxBalanceHours,
          );
          const granted = await this.ledger.postOnce({
            ...common,
            kind: 'allocation',
            hours,
            periodKey: accrualPeriodKey('yearly', today),
            reason: hours < policy.hoursPerYear ? 'max_balance' : null,
            source: source('accrual'),
          });
          if (granted) {
            result.allocations += 1;
            balances.set(userId.toString(), roundHours(afterReset + hours));
          }
        }
      }

      if (monthly) {
        const twelfth = monthlyAccrualHours(policy.hoursPerYear);
        for (const userId of members) {
          const hours = cappedAllocation(
            twelfth,
            base(userId),
            policy.maxBalanceHours,
          );
          const granted = await this.ledger.postOnce({
            agencyId: agencyKey,
            policyId: policy._id,
            userId,
            effectiveAt,
            kind: 'allocation',
            hours,
            periodKey: accrualPeriodKey('monthly', today),
            reason: hours < twelfth ? 'max_balance' : null,
            source: source('accrual'),
          });
          if (granted) result.allocations += 1;
        }
      }
    }

    if (result.allocations || result.resets) {
      this.logger.log(
        `Agency ${agencyKey}: ${result.allocations} allocation(s), ${result.resets} reset(s) on ${today}`,
      );
    }
    return result;
  }
}
