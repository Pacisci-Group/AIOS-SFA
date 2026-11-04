import type { TimeOffPolicyRules } from '@sfa/shared';

/** The time off fields as stored; `autoApprove` may be absent on `.lean()`. */
export type TimeOffFieldsLean = Partial<
  Omit<TimeOffPolicyRules, 'autoApprove'> & {
    autoApprove?: Partial<TimeOffPolicyRules['autoApprove']>;
  }
>;

/**
 * The stored time off fields as the wire rules. `.lean()` fills no schema
 * defaults, so every field is pinned here — the policy page and the People
 * profile (PAC-162) read the same shape from the same mapper.
 */
export function timeOffRulesOf(row: TimeOffFieldsLean): TimeOffPolicyRules {
  return {
    timeOffType: row.timeOffType ?? 'custom',
    description: row.description ?? null,
    compensation: row.compensation ?? 'paid',
    accrualType: row.accrualType ?? 'fixed_amount',
    hoursPerYear: row.hoursPerYear ?? null,
    accrualFrequency: row.accrualFrequency ?? null,
    resetDateKind: row.resetDateKind ?? null,
    resetMonthDay: row.resetMonthDay ?? null,
    accrualRate: row.accrualRate ?? null,
    accrualRateUnit: row.accrualRateUnit ?? null,
    maxBalanceHours: row.maxBalanceHours ?? null,
    maxAccruedPerYearHours: row.maxAccruedPerYearHours ?? null,
    carryoverCapHours: row.carryoverCapHours ?? null,
    annualUsageCapHours: row.annualUsageCapHours ?? null,
    waitingPeriodDays: row.waitingPeriodDays ?? null,
    accrualWaitingPeriodDays: row.accrualWaitingPeriodDays ?? null,
    allowNegativeBalance: row.allowNegativeBalance ?? false,
    payOutOnTermination: row.payOutOnTermination ?? false,
    autoApprove: {
      enabled: row.autoApprove?.enabled ?? false,
      maxCalendarDays: row.autoApprove?.maxCalendarDays ?? null,
      minNoticeHours: row.autoApprove?.minNoticeHours ?? null,
    },
  };
}
