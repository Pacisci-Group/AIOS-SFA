import {
  CREATABLE_POLICY_TYPES,
  CUSTOM_HOLIDAYS_MAX,
  customHolidayError,
  HOLIDAY_KEYS,
  POLICY_NAME_MAX_LENGTH,
  TIME_OFF_POLICY_TYPES,
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

const memberIds = z
  .array(objectId)
  .max(2000)
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

/** `POST /hr/policies` — the body's shape follows its `type`. */
export const createTimeOffPolicySchema = z.discriminatedUnion('type', [
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
]);
export type CreateTimeOffPolicyDto = z.infer<typeof createTimeOffPolicySchema>;

/**
 * `PATCH /hr/policies/:policyId` — at least one field. Whether `holiday` or
 * `workWeek` fits the stored policy is the service's check (it needs the row).
 */
export const updateTimeOffPolicySchema = z
  .object({
    name: name.optional(),
    holiday: holidayRules.optional(),
    workWeek: workWeekRules.optional(),
    memberIds: memberIds.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Send a name, rules, members, or several.',
  });
export type UpdateTimeOffPolicyDto = z.infer<typeof updateTimeOffPolicySchema>;

/** `GET /hr/policies?type=`. */
export const listTimeOffPoliciesQuerySchema = z.object({
  type: z.enum(TIME_OFF_POLICY_TYPES).optional(),
});
export type ListTimeOffPoliciesQueryDto = z.infer<
  typeof listTimeOffPoliciesQuerySchema
>;

export const policyIdParamSchema = objectId;

/** Re-exported for the controller's docs; only these two can be created. */
export { CREATABLE_POLICY_TYPES };
