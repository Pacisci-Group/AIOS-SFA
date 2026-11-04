import {
  AUTO_APPROVE_MAX_CALENDAR_DAYS,
  AUTO_APPROVE_MAX_NOTICE_HOURS,
  COMPENSATIONS,
  CREATABLE_POLICY_TYPES,
  CUSTOM_HOLIDAYS_MAX,
  customHolidayError,
  HOLIDAY_KEYS,
  HR_POLICY_TYPES,
  isValidMonthDay,
  normalizeTimeOffPolicyRules,
  OFFERED_ACCRUAL_FREQUENCIES,
  OFFERED_ACCRUAL_TYPES,
  POLICY_NAME_MAX_LENGTH,
  RESET_DATE_KINDS,
  roundHours,
  TIME_OFF_DESCRIPTION_MAX_LENGTH,
  TIME_OFF_HOURS_MAX,
  TIME_OFF_TYPE_KEYS,
  timeOffPolicyRulesError,
  type TimeOffPolicyRules,
  type Weekday,
} from '@sfa/shared';
import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';

const name = z
  .string()
  .trim()
  .min(1, 'Give the policy a name.')
  .max(
    POLICY_NAME_MAX_LENGTH,
    `Keep the name under ${POLICY_NAME_MAX_LENGTH} characters.`,
  );

const customHoliday = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string(),
    start: z.string().trim(),
    // Blank or missing → a single day.
    end: z.string().trim().optional(),
    repeatsYearly: z.boolean().default(false),
  })
  .transform((row) => ({
    ...row,
    name: row.name.trim(),
    end: row.end || row.start,
  }))
  .superRefine((row, ctx) => {
    const error = customHolidayError(row);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  });

const holidayRules = z.object({
  holidays: z
    .array(z.enum(HOLIDAY_KEYS))
    .max(HOLIDAY_KEYS.length)
    .transform((keys) => [...new Set(keys)]),
  customHolidays: z
    .array(customHoliday)
    .max(CUSTOM_HOLIDAYS_MAX, `At most ${CUSTOM_HOLIDAYS_MAX} custom holidays.`)
    .refine(
      (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
      'Each custom holiday once.',
    ),
});

const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time, HH:mm.');

const workWeekRules = z.object({
  days: z
    .array(
      z
        .object({
          weekday: z.number().int().min(0).max(6),
          start: clock,
          end: clock,
        })
        .refine((day) => day.end > day.start, {
          message: 'A working day must end after it starts.',
        }),
    )
    .min(1, 'Pick at least one working day.')
    .max(7)
    .refine(
      (days) => new Set(days.map((day) => day.weekday)).size === days.length,
      'Each weekday once.',
    )
    .transform((days) =>
      [...days]
        .sort((a, b) => a.weekday - b.weekday)
        .map((day) => ({ ...day, weekday: day.weekday as Weekday })),
    ),
});

// ── Time off (PAC-174) ──────────────────────────────────────────────────

const NOT_YET = 'That option is not available yet.';

/** Hours, two decimals, never negative. */
const hours = z
  .number()
  .min(0)
  .max(TIME_OFF_HOURS_MAX)
  .transform((value) => roundHours(value));

/** A field whose only accepted value is `null` until its feature lands. */
const reserved = z.null(NOT_YET);

/**
 * The time off rules, every field present (the wizard holds the whole form,
 * and `TimeOffPolicyRules` is the type the client sends). The cross-field
 * rules are checked **before** normalisation so a paid "Unpaid Time Off" is
 * a 400 rather than silently corrected, and the stored shape is the
 * normalised one so equal policies are stored equal.
 */
const timeOffRuleFields = z.object({
  timeOffType: z.enum(TIME_OFF_TYPE_KEYS),
  description: z
    .string()
    .trim()
    .max(TIME_OFF_DESCRIPTION_MAX_LENGTH)
    .nullable(),
  compensation: z.enum(COMPENSATIONS),
  accrualType: z.enum(OFFERED_ACCRUAL_TYPES, NOT_YET),
  hoursPerYear: hours.nullable(),
  accrualFrequency: z.enum(OFFERED_ACCRUAL_FREQUENCIES, NOT_YET).nullable(),
  resetDateKind: z.enum(RESET_DATE_KINDS).nullable(),
  resetMonthDay: z
    .string()
    .refine(isValidMonthDay, 'Use a real date, MM-DD.')
    .nullable(),
  accrualRate: reserved,
  accrualRateUnit: reserved,
  maxBalanceHours: hours.nullable(),
  maxAccruedPerYearHours: reserved,
  carryoverCapHours: hours.nullable(),
  annualUsageCapHours: hours.nullable(),
  waitingPeriodDays: z.number().int().min(0).max(3660).nullable(),
  accrualWaitingPeriodDays: reserved,
  allowNegativeBalance: z.boolean(),
  payOutOnTermination: z.boolean(),
  autoApprove: z.object({
    enabled: z.boolean(),
    maxCalendarDays: z
      .number()
      .int()
      .min(1)
      .max(AUTO_APPROVE_MAX_CALENDAR_DAYS)
      .nullable(),
    minNoticeHours: z
      .number()
      .min(0)
      .max(AUTO_APPROVE_MAX_NOTICE_HOURS)
      .transform((value) => roundHours(value))
      .nullable(),
  }),
});

const timeOffRules = timeOffRuleFields
  .superRefine((rules, ctx) => {
    const error = timeOffPolicyRulesError(rules);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  })
  .transform((rules) =>
    normalizeTimeOffPolicyRules(rules as TimeOffPolicyRules),
  );

/**
 * `PATCH` sends only what changed; the service merges it over the stored
 * rules and runs the same checks on the result (it needs the row for the
 * locks, so the whole-object validation cannot live here).
 */
const timeOffRulesPatch = timeOffRuleFields.partial();

/** `{ userId: hours }` — the starting balance of newly enrolled people. */
const startingBalanceHours = z
  .record(objectId, hours)
  .refine((map) => Object.keys(map).length <= 2000);

const memberIds = z
  .array(objectId)
  .max(2000)
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

/** `POST /hr/policies` — the body's shape follows its `type`. */
export const createHrPolicySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('holiday'),
    name,
    holiday: holidayRules,
    memberIds,
  }),
  z.object({
    type: z.literal('work_week'),
    name,
    workWeek: workWeekRules,
    memberIds,
  }),
  z.object({
    type: z.literal('time_off'),
    name,
    timeOff: timeOffRules,
    memberIds,
    startingBalanceHours: startingBalanceHours.optional(),
  }),
]);
export type CreateHrPolicyDto = z.infer<typeof createHrPolicySchema>;

/**
 * `PATCH /hr/policies/:policyId` — at least one field. Whether the rules
 * sent fit the stored policy is the service's check (it needs the row).
 */
export const updateHrPolicySchema = z
  .object({
    name: name.optional(),
    holiday: holidayRules.optional(),
    workWeek: workWeekRules.optional(),
    timeOff: timeOffRulesPatch.optional(),
    memberIds: memberIds.optional(),
    startingBalanceHours: startingBalanceHours.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Send a name, rules, members, or several.',
  })
  .refine((body) => !body.startingBalanceHours || body.memberIds, {
    message: 'Starting balances go with the member list they belong to.',
  });
export type UpdateHrPolicyDto = z.infer<typeof updateHrPolicySchema>;

/** `GET /hr/policies?type=`. */
export const listHrPoliciesQuerySchema = z.object({
  type: z.enum(HR_POLICY_TYPES).optional(),
});
export type ListHrPoliciesQueryDto = z.infer<typeof listHrPoliciesQuerySchema>;

export const policyIdParamSchema = objectId;
export const userIdParamSchema = objectId;

/** `POST /hr/policies/:policyId/members` — one person (PAC-162). */
export const enrolMemberSchema = z.object({
  userId: objectId,
  /** Time off only; refused for someone who was in the policy before. */
  startingBalanceHours: hours.optional(),
});
export type EnrolMemberDto = z.infer<typeof enrolMemberSchema>;

/** Re-exported for the controller's docs. */
export { CREATABLE_POLICY_TYPES };
