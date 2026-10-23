import {
  ATTENDANCE_EVENT_TYPES,
  CARRYOVER_MODES,
  COVERAGE_NOTE_MODES,
  NEGATIVE_BALANCE_MODES,
  NOTIFICATION_TRIGGERS,
  POINT_EARNING_CLASSIFICATIONS,
  POINT_RESET_BASES,
  POINT_SEQUENCE_MODES,
  PTO_PRORATION_MODES,
  PTO_RESET_BASES,
  ROUTING_RECIPIENTS,
  VALIDATION_MODES,
} from '@sfa/shared';
import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';
import { isoDate } from './calendar.dto';

/**
 * The leave-policy rules as a **patch** (PAC-161): every section optional,
 * every field inside it optional, arrays whole. Shapes and ranges only —
 * the rules that span fields (a fiscal-year start when the reset is fiscal)
 * are checked by `validateLeavePolicyRules` on the merged result, because a
 * patch that is fine on its own can be wrong against the stored policy.
 */

const label = (max: number) => z.string().trim().min(1).max(max);
const nonNegativeInt = z.number().int().min(0);
const positiveInt = z.number().int().min(1);
const hours = z.number().min(0).max(10_000);

const leaveType = z.object({
  key: z
    .string()
    .trim()
    .regex(
      /^[a-z][a-z0-9_]{0,39}$/,
      'A key is lowercase letters, digits and underscores.',
    ),
  label: label(60),
  drawsFromBalance: z.boolean(),
  active: z.boolean(),
});

const reasonList = z.array(label(80)).max(50);

const validationMode = z.enum(VALIDATION_MODES);

const blackoutRange = z.object({
  from: isoDate,
  to: isoDate,
  label: label(80),
});

const threshold = z.object({
  points: positiveInt,
  recipients: z.array(z.enum(ROUTING_RECIPIENTS)).max(4),
  guidance: z.string().trim().max(1000),
});

const ladder = z.array(positiveInt).max(20);

const recipients = z.array(z.enum(ROUTING_RECIPIENTS)).max(4);

/**
 * Spelled out per trigger rather than built from `NOTIFICATION_TRIGGERS`: a
 * generated object loses the literal key and value types, and the merge
 * into `LeavePolicyRules` is what catches a trigger added to the shared
 * tuple but not here.
 */
const routing = z
  .object({
    'timeoff.submitted': recipients,
    'timeoff.changes_requested': recipients,
    'timeoff.approved': recipients,
    'timeoff.declined': recipients,
    'timeoff.cancelled_by_admin': recipients,
    'timeoff.overdue': recipients,
    'timeoff.upcoming': recipients,
    'attendance.submitted': recipients,
    'attendance.classified': recipients,
    'pto.adjusted': recipients,
    'points.threshold': recipients,
    'onboarding.pending': recipients,
  } satisfies Record<(typeof NOTIFICATION_TRIGGERS)[number], unknown>)
  .partial();

export const leavePolicyRulesPatchSchema = z
  .object({
    leaveTypes: z.array(leaveType).min(1).max(20),
    reasons: z
      .object({ timeOff: reasonList, attendance: reasonList })
      .partial(),
    requests: z
      .object({
        partialDayIncrementMinutes: positiveInt,
        coverageNote: z.enum(COVERAGE_NOTE_MODES),
        acknowledgmentText: z.string().trim().max(1000),
        validation: z
          .object({
            overlap: validationMode,
            closure: validationMode,
            nonScheduledDay: validationMode,
            advanceNotice: validationMode,
            blackout: validationMode,
          })
          .partial(),
        advanceNoticeDays: nonNegativeInt.max(365).nullable(),
        blackoutRanges: z.array(blackoutRange).max(50),
      })
      .partial(),
    pto: z
      .object({
        annualAllocationHours: hours,
        resetBasis: z.enum(PTO_RESET_BASES),
        fiscalYearStart: z
          .string()
          .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Use MM-DD.')
          .nullable(),
        proration: z.enum(PTO_PRORATION_MODES),
        carryover: z
          .object({
            mode: z.enum(CARRYOVER_MODES),
            capHours: hours.nullable(),
            expiryDays: nonNegativeInt.max(3650).nullable(),
          })
          .partial(),
        negativeBalance: z
          .object({
            mode: z.enum(NEGATIVE_BALANCE_MODES),
            floorHours: hours.nullable(),
          })
          .partial(),
        reserveApprovedFutureLeave: z.boolean(),
        employeeCancelCutoffHours: nonNegativeInt.max(8760),
      })
      .partial(),
    reminders: z
      .object({
        reminderBusinessDays: nonNegativeInt.max(60),
        escalationBusinessDays: nonNegativeInt.max(60),
        upcomingLeaveLeadBusinessDays: nonNegativeInt.max(60),
      })
      .partial(),
    attendance: z
      .object({
        tardyGraceMinutes: nonNegativeInt.max(240),
        eventTypes: z.array(z.enum(ATTENDANCE_EVENT_TYPES)).max(4),
      })
      .partial(),
    points: z
      .object({
        enabled: z.boolean(),
        earningClassifications: z
          .array(z.enum(POINT_EARNING_CLASSIFICATIONS))
          .max(2),
        ladders: z.object({ tardy: ladder, absence: ladder }).partial(),
        mapping: z.object({
          noCallNoShow: z.literal('absence'),
          leavingEarly: z.literal('tardy'),
        }),
        sequences: z.enum(POINT_SEQUENCE_MODES),
        resetBasis: z.enum(POINT_RESET_BASES),
        thresholds: z.array(threshold).max(10),
      })
      .partial(),
    routing,
  })
  .partial();

export type LeavePolicyRulesPatchDto = z.infer<
  typeof leavePolicyRulesPatchSchema
>;

const policyName = z
  .string()
  .trim()
  .min(1, 'Give the policy a name.')
  .max(80, 'Keep the name under 80 characters.');

/** `POST /hr/leave-policies`: a name, and any rules that differ from the defaults. */
export const createLeavePolicySchema = z.object({
  name: policyName,
  rules: leavePolicyRulesPatchSchema.optional(),
});
export type CreateLeavePolicyDto = z.infer<typeof createLeavePolicySchema>;

/** `PATCH /hr/leave-policies/:id`: a name, rules, or both. */
export const updateLeavePolicySchema = z
  .object({
    name: policyName.optional(),
    rules: leavePolicyRulesPatchSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.rules !== undefined, {
    message: 'Send a name, rules, or both.',
  });
export type UpdateLeavePolicyDto = z.infer<typeof updateLeavePolicySchema>;

export const leavePolicyIdSchema = objectId;
