import { EMPLOYEE_PROFILE_STATUSES } from '@sfa/shared';
import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';
import { multiValue } from '../../leads/dto/multi-value';
import { isoDate } from './calendar.dto';
import { leavePolicyRulesPatchSchema } from './leave-policy.dto';
import { workScheduleSchema } from './schedule-template.dto';

/**
 * The employee-profile endpoints' inputs (PAC-162). Shapes and ranges here;
 * everything that needs the agency's calendar, policy or clock — the date
 * bounds, the override merge, the allocation keys — is `common/hr/`'s.
 *
 * `overrides` reuses the policy rules **patch** schema on purpose: an
 * unknown path must be a 400 here, because `mergeRules` ignores paths the
 * template does not have and a typo would otherwise vanish silently.
 */

const monthDay = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Use MM-DD.');

const reason = z
  .string()
  .trim()
  .max(500, 'Keep the reason under 500 characters.');

const hours = z.number().min(0).max(8760);

/** Leave-type key → hours. Which keys are allowed depends on the policy. */
const allocations = z.record(
  z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Not a leave type key.'),
  hours,
);

const assignmentFields = {
  leavePolicyId: objectId,
  overrides: leavePolicyRulesPatchSchema.optional(),
  scheduleTemplateId: objectId.nullable().optional(),
  scheduleOverride: workScheduleSchema.nullable().optional(),
  allocations: allocations.optional(),
};

/** `POST /hr/employees/:userId/activate`. */
export const activateEmployeeSchema = z.object({
  ...assignmentFields,
  hireDate: isoDate,
  workAnniversary: monthDay.nullable().optional(),
  effectiveFrom: isoDate.optional(),
  reason: reason.optional(),
});
export type ActivateEmployeeDto = z.infer<typeof activateEmployeeSchema>;

/** `PUT /hr/employees/:userId/assignment`. */
export const setEmployeeAssignmentSchema = z.object({
  ...assignmentFields,
  effectiveFrom: isoDate.optional(),
  reason: reason.min(1, 'Give a reason for the change.'),
});
export type SetEmployeeAssignmentDto = z.infer<
  typeof setEmployeeAssignmentSchema
>;

/** `PATCH /hr/employees/:userId` — facts only. */
export const updateEmployeeFactsSchema = z
  .object({
    hireDate: isoDate.optional(),
    workAnniversary: monthDay.nullable().optional(),
    dateOfBirth: isoDate.nullable().optional(),
    showBirthday: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Nothing to update.',
  });
export type UpdateEmployeeFactsDto = z.infer<typeof updateEmployeeFactsSchema>;

/** `POST /hr/employees/:userId/terminate`. */
export const terminateEmployeeSchema = z.object({
  terminationDate: isoDate,
  reason: reason.min(1, 'Give a reason.'),
});
export type TerminateEmployeeDto = z.infer<typeof terminateEmployeeSchema>;

/** `PATCH /hr/me/profile` — the two birthday fields, nothing else. */
export const updateMyHrProfileSchema = z
  .object({
    dateOfBirth: isoDate.nullable().optional(),
    showBirthday: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) => body.dateOfBirth !== undefined || body.showBirthday !== undefined,
    { message: 'Nothing to update.' },
  );
export type UpdateMyHrProfileDto = z.infer<typeof updateMyHrProfileSchema>;

/** `GET /hr/employees` — the Employees and Onboardings lists. */
export const listEmployeesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Name or email. */
  q: z.string().trim().max(120).optional(),
  /** Multi-select, ORed. */
  status: z.preprocess(
    multiValue,
    z
      .array(z.enum(EMPLOYEE_PROFILE_STATUSES))
      .max(EMPLOYEE_PROFILE_STATUSES.length)
      .optional(),
  ),
  branchId: objectId.optional(),
  leavePolicyId: objectId.optional(),
});
export type ListEmployeesDto = z.infer<typeof listEmployeesSchema>;

export const employeeUserIdSchema = objectId;
