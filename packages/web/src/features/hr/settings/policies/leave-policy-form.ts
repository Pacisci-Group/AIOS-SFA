import { z } from "zod";
import {
  ATTENDANCE_EVENT_TYPES,
  CARRYOVER_MODES,
  COVERAGE_NOTE_MODES,
  DEFAULT_LEAVE_POLICY_RULES,
  NEGATIVE_BALANCE_MODES,
  NOTIFICATION_TRIGGERS,
  PARTIAL_DAY_INCREMENTS,
  POINT_EARNING_CLASSIFICATIONS,
  POINT_RESET_BASES,
  POINT_SEQUENCE_MODES,
  PTO_PRORATION_MODES,
  PTO_RESET_BASES,
  ROUTING_RECIPIENTS,
  VALIDATION_MODES,
  type AttendanceEventType,
  type LeavePolicyRules,
  type NotificationTrigger,
  type PointEarningClassification,
  type RoutingRecipient,
  type UpsertLeavePolicyInput,
} from "@sfa/shared";
import type { SelectOption } from "@/components/form/fields";

/**
 * The leave-policy editor's form model (PAC-161): the §2 rules flattened
 * into the strings and booleans the field tier binds. Lists that are "a few
 * values" (reason lists, point ladders) are edited as text and parsed on
 * submit; rows with structure (leave types, blackouts, thresholds) stay
 * arrays. `toForm` / `fromForm` are the only two places that know both
 * shapes.
 */

const numeric = z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a number.");
const optionalNumeric = z.string().trim().regex(/^(\d+(\.\d+)?)?$/, "Enter a number.");
const integerList = z
  .string()
  .trim()
  .regex(/^\d+(\s*,\s*\d+)*$/, "Enter whole numbers separated by commas.");

export const leavePolicyFormSchema = z.object({
  name: z.string().trim().min(1, "Give the policy a name.").max(80),
  leaveTypes: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_]{0,39}$/, "Lowercase letters, digits and underscores."),
        label: z.string().trim().min(1, "Give the leave type a label."),
        drawsFromBalance: z.boolean(),
        active: z.boolean(),
      }),
    )
    .min(1, "Add at least one leave type."),
  reasonsTimeOff: z.string(),
  reasonsAttendance: z.string(),
  partialDayIncrementMinutes: z.string(),
  coverageNote: z.string(),
  acknowledgmentText: z.string().max(1000),
  validationOverlap: z.string(),
  validationClosure: z.string(),
  validationNonScheduledDay: z.string(),
  validationAdvanceNotice: z.string(),
  validationBlackout: z.string(),
  advanceNoticeDays: optionalNumeric,
  blackoutRanges: z.array(
    z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
      label: z.string().trim().min(1, "Label the blackout."),
    }),
  ),
  annualAllocationHours: numeric,
  resetBasis: z.string(),
  fiscalYearStart: z.string().trim().regex(/^((0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))?$/, "Use MM-DD."),
  proration: z.string(),
  carryoverMode: z.string(),
  carryoverCapHours: optionalNumeric,
  carryoverExpiryDays: optionalNumeric,
  negativeBalanceMode: z.string(),
  negativeFloorHours: optionalNumeric,
  reserveApprovedFutureLeave: z.boolean(),
  employeeCancelCutoffHours: numeric,
  reminderBusinessDays: numeric,
  escalationBusinessDays: numeric,
  upcomingLeaveLeadBusinessDays: numeric,
  tardyGraceMinutes: numeric,
  eventTypes: z.array(z.string()),
  pointsEnabled: z.boolean(),
  earningClassifications: z.array(z.string()),
  ladderTardy: integerList,
  ladderAbsence: integerList,
  sequences: z.string(),
  pointsResetBasis: z.string(),
  thresholds: z.array(
    z.object({
      points: numeric,
      recipients: z.array(z.string()),
      guidance: z.string().max(1000),
    }),
  ),
  routing: z.record(z.string(), z.array(z.string())),
});

export type LeavePolicyFormValues = z.infer<typeof leavePolicyFormSchema>;

const lines = (list: readonly string[]) => list.join("\n");
const parseLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const parseIntegers = (text: string) =>
  text
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
const numberOrNull = (text: string) => (text.trim() === "" ? null : Number(text));

export function toForm(name: string, rules: LeavePolicyRules): LeavePolicyFormValues {
  return {
    name,
    leaveTypes: rules.leaveTypes.map((type) => ({ ...type })),
    reasonsTimeOff: lines(rules.reasons.timeOff),
    reasonsAttendance: lines(rules.reasons.attendance),
    partialDayIncrementMinutes: String(rules.requests.partialDayIncrementMinutes),
    coverageNote: rules.requests.coverageNote,
    acknowledgmentText: rules.requests.acknowledgmentText,
    validationOverlap: rules.requests.validation.overlap,
    validationClosure: rules.requests.validation.closure,
    validationNonScheduledDay: rules.requests.validation.nonScheduledDay,
    validationAdvanceNotice: rules.requests.validation.advanceNotice,
    validationBlackout: rules.requests.validation.blackout,
    advanceNoticeDays:
      rules.requests.advanceNoticeDays === null ? "" : String(rules.requests.advanceNoticeDays),
    blackoutRanges: rules.requests.blackoutRanges.map((range) => ({ ...range })),
    annualAllocationHours: String(rules.pto.annualAllocationHours),
    resetBasis: rules.pto.resetBasis,
    fiscalYearStart: rules.pto.fiscalYearStart ?? "",
    proration: rules.pto.proration,
    carryoverMode: rules.pto.carryover.mode,
    carryoverCapHours:
      rules.pto.carryover.capHours === null ? "" : String(rules.pto.carryover.capHours),
    carryoverExpiryDays:
      rules.pto.carryover.expiryDays === null ? "" : String(rules.pto.carryover.expiryDays),
    negativeBalanceMode: rules.pto.negativeBalance.mode,
    negativeFloorHours:
      rules.pto.negativeBalance.floorHours === null
        ? ""
        : String(rules.pto.negativeBalance.floorHours),
    reserveApprovedFutureLeave: rules.pto.reserveApprovedFutureLeave,
    employeeCancelCutoffHours: String(rules.pto.employeeCancelCutoffHours),
    reminderBusinessDays: String(rules.reminders.reminderBusinessDays),
    escalationBusinessDays: String(rules.reminders.escalationBusinessDays),
    upcomingLeaveLeadBusinessDays: String(rules.reminders.upcomingLeaveLeadBusinessDays),
    tardyGraceMinutes: String(rules.attendance.tardyGraceMinutes),
    eventTypes: [...rules.attendance.eventTypes],
    pointsEnabled: rules.points.enabled,
    earningClassifications: [...rules.points.earningClassifications],
    ladderTardy: rules.points.ladders.tardy.join(", "),
    ladderAbsence: rules.points.ladders.absence.join(", "),
    sequences: rules.points.sequences,
    pointsResetBasis: rules.points.resetBasis,
    thresholds: rules.points.thresholds.map((threshold) => ({
      points: String(threshold.points),
      recipients: [...threshold.recipients],
      guidance: threshold.guidance,
    })),
    routing: Object.fromEntries(
      NOTIFICATION_TRIGGERS.map((trigger) => [trigger, [...(rules.routing[trigger] ?? [])]]),
    ),
  };
}

export const newPolicyForm = (): LeavePolicyFormValues =>
  toForm("Company policy", DEFAULT_LEAVE_POLICY_RULES);

/** The whole rules object, every section — arrays are replaced whole on PATCH. */
export function fromForm(values: LeavePolicyFormValues): UpsertLeavePolicyInput & { name: string } {
  const rules: LeavePolicyRules = {
    leaveTypes: values.leaveTypes.map((type) => ({
      key: type.key.trim(),
      label: type.label.trim(),
      drawsFromBalance: type.drawsFromBalance,
      active: type.active,
    })),
    reasons: {
      timeOff: parseLines(values.reasonsTimeOff),
      attendance: parseLines(values.reasonsAttendance),
    },
    requests: {
      partialDayIncrementMinutes: Number(values.partialDayIncrementMinutes),
      coverageNote: values.coverageNote as LeavePolicyRules["requests"]["coverageNote"],
      acknowledgmentText: values.acknowledgmentText.trim(),
      validation: {
        overlap: values.validationOverlap as LeavePolicyRules["requests"]["validation"]["overlap"],
        closure: values.validationClosure as LeavePolicyRules["requests"]["validation"]["closure"],
        nonScheduledDay:
          values.validationNonScheduledDay as LeavePolicyRules["requests"]["validation"]["nonScheduledDay"],
        advanceNotice:
          values.validationAdvanceNotice as LeavePolicyRules["requests"]["validation"]["advanceNotice"],
        blackout: values.validationBlackout as LeavePolicyRules["requests"]["validation"]["blackout"],
      },
      advanceNoticeDays: numberOrNull(values.advanceNoticeDays),
      blackoutRanges: values.blackoutRanges.map((range) => ({
        from: range.from,
        to: range.to,
        label: range.label.trim(),
      })),
    },
    pto: {
      annualAllocationHours: Number(values.annualAllocationHours),
      resetBasis: values.resetBasis as LeavePolicyRules["pto"]["resetBasis"],
      fiscalYearStart: values.fiscalYearStart.trim() || null,
      proration: values.proration as LeavePolicyRules["pto"]["proration"],
      carryover: {
        mode: values.carryoverMode as LeavePolicyRules["pto"]["carryover"]["mode"],
        capHours: numberOrNull(values.carryoverCapHours),
        expiryDays: numberOrNull(values.carryoverExpiryDays),
      },
      negativeBalance: {
        mode: values.negativeBalanceMode as LeavePolicyRules["pto"]["negativeBalance"]["mode"],
        floorHours: numberOrNull(values.negativeFloorHours),
      },
      reserveApprovedFutureLeave: values.reserveApprovedFutureLeave,
      employeeCancelCutoffHours: Number(values.employeeCancelCutoffHours),
    },
    reminders: {
      reminderBusinessDays: Number(values.reminderBusinessDays),
      escalationBusinessDays: Number(values.escalationBusinessDays),
      upcomingLeaveLeadBusinessDays: Number(values.upcomingLeaveLeadBusinessDays),
    },
    attendance: {
      tardyGraceMinutes: Number(values.tardyGraceMinutes),
      eventTypes: values.eventTypes as AttendanceEventType[],
    },
    points: {
      enabled: values.pointsEnabled,
      earningClassifications: values.earningClassifications as PointEarningClassification[],
      ladders: {
        tardy: parseIntegers(values.ladderTardy),
        absence: parseIntegers(values.ladderAbsence),
      },
      mapping: { noCallNoShow: "absence", leavingEarly: "tardy" },
      sequences: values.sequences as LeavePolicyRules["points"]["sequences"],
      resetBasis: values.pointsResetBasis as LeavePolicyRules["points"]["resetBasis"],
      thresholds: values.thresholds.map((threshold) => ({
        points: Number(threshold.points),
        recipients: threshold.recipients as RoutingRecipient[],
        guidance: threshold.guidance.trim(),
      })),
    },
    routing: Object.fromEntries(
      NOTIFICATION_TRIGGERS.map((trigger) => [
        trigger,
        (values.routing[trigger] ?? []) as RoutingRecipient[],
      ]),
    ) as Record<NotificationTrigger, RoutingRecipient[]>,
  };
  return { name: values.name.trim(), rules };
}

// ── Option lists ─────────────────────────────────────────────────────────────

const titled = (value: string) =>
  value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const VALIDATION_MODE_OPTIONS: SelectOption<string>[] = VALIDATION_MODES.map((v) => ({
  value: v,
  label: v === "off" ? "Off" : v === "warn" ? "Warn" : "Block",
}));
export const INCREMENT_OPTIONS: SelectOption<string>[] = PARTIAL_DAY_INCREMENTS.map((m) => ({
  value: String(m),
  label: `${m} minutes`,
}));
export const COVERAGE_NOTE_OPTIONS: SelectOption<string>[] = COVERAGE_NOTE_MODES.map((v) => ({
  value: v,
  label: titled(v),
}));
export const PTO_RESET_OPTIONS: SelectOption<string>[] = PTO_RESET_BASES.map((v) => ({
  value: v,
  label: titled(v),
}));
export const PRORATION_OPTIONS: SelectOption<string>[] = PTO_PRORATION_MODES.map((v) => ({
  value: v,
  label: v === "none" ? "None" : `By ${v}`,
}));
export const CARRYOVER_OPTIONS: SelectOption<string>[] = CARRYOVER_MODES.map((v) => ({
  value: v,
  label: titled(v),
}));
export const NEGATIVE_BALANCE_OPTIONS: SelectOption<string>[] = NEGATIVE_BALANCE_MODES.map(
  (v) => ({ value: v, label: titled(v) }),
);
export const SEQUENCE_OPTIONS: SelectOption<string>[] = POINT_SEQUENCE_MODES.map((v) => ({
  value: v,
  label: v === "separate" ? "Counted separately" : "Counted together",
}));
export const POINT_RESET_OPTIONS: SelectOption<string>[] = POINT_RESET_BASES.map((v) => ({
  value: v,
  label: titled(v),
}));

export const EVENT_TYPE_LABELS: Record<AttendanceEventType, string> = {
  call_in: "Call in",
  tardy: "Tardy",
  leaving_early: "Leaving early",
  other: "Other",
};
export const EVENT_TYPE_OPTIONS = ATTENDANCE_EVENT_TYPES.map((v) => ({
  value: v,
  label: EVENT_TYPE_LABELS[v],
}));

export const CLASSIFICATION_LABELS: Record<PointEarningClassification, string> = {
  unexcused: "Unexcused",
  no_call_no_show: "No call, no show",
};
export const CLASSIFICATION_OPTIONS = POINT_EARNING_CLASSIFICATIONS.map((v) => ({
  value: v,
  label: CLASSIFICATION_LABELS[v],
}));

export const RECIPIENT_LABELS: Record<RoutingRecipient, string> = {
  employee: "Employee",
  branch_reviewers: "Branch reviewers",
  hr_admins: "HR admins",
  adjusting_admin: "Adjusting admin",
};
export const RECIPIENT_OPTIONS = ROUTING_RECIPIENTS.map((v) => ({
  value: v,
  label: RECIPIENT_LABELS[v],
}));

export const TRIGGER_LABELS: Record<NotificationTrigger, string> = {
  "timeoff.submitted": "Time off submitted or resubmitted",
  "timeoff.changes_requested": "Changes requested",
  "timeoff.approved": "Approved",
  "timeoff.declined": "Declined",
  "timeoff.cancelled_by_admin": "Cancelled by an admin",
  "timeoff.overdue": "Request overdue",
  "timeoff.upcoming": "Upcoming approved leave",
  "attendance.submitted": "Attendance event submitted",
  "attendance.classified": "Event classified",
  "pto.adjusted": "PTO adjusted",
  "points.threshold": "Point threshold reached",
  "onboarding.pending": "Onboarding pending",
};
