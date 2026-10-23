/**
 * Leave policies (PAC-161) — the §2 table of the PAC-148 epic as a typed
 * object, and the wire contract for `/hr/leave-policies/*`.
 *
 * ## Every value is a per-agency setting
 *
 * David's rule (2026-10-15): nothing with a count, threshold, formula input
 * or vocabulary is a platform constant. {@link DEFAULT_LEAVE_POLICY_RULES}
 * carries SFA's spec values, and they are what a **new** policy is pre-filled
 * with in the editor — never a stored row. An agency may hold zero policies
 * (Asad, 2026-10-22): that is the agency not using leave, and the app works
 * in that state. No policy means no leave requests and no employee
 * onboarding records (PAC-162 / PAC-165 enforce that through
 * `LeavePolicyService.hasActivePolicy`).
 *
 * ## No default policy
 *
 * Nothing is preselected anywhere. A policy is chosen per employee during
 * employee onboarding (PAC-162). A policy cannot be archived while any
 * employee is on it; archiving the last one is allowed.
 *
 * ## Snapshots
 *
 * Every engine reads a policy through `LeavePolicyService.effectiveRules`
 * (template + the employee's overrides) and a posted record stores a
 * {@link LeavePolicySnapshot} of the values it used, so a later edit never
 * recalculates history. `version` on the policy is what makes "which rules
 * was this posted under" answerable without diffing.
 */

export const VALIDATION_MODES = ['off', 'warn', 'block'] as const;
export type ValidationMode = (typeof VALIDATION_MODES)[number];

export const PTO_RESET_BASES = [
  'calendar_year',
  'fiscal_year',
  'hire_anniversary',
] as const;
export type PtoResetBasis = (typeof PTO_RESET_BASES)[number];

export const PTO_PRORATION_MODES = ['none', 'months', 'days'] as const;
export type PtoProrationMode = (typeof PTO_PRORATION_MODES)[number];

export const CARRYOVER_MODES = ['off', 'capped', 'unlimited'] as const;
export type CarryoverMode = (typeof CARRYOVER_MODES)[number];

export const NEGATIVE_BALANCE_MODES = ['block', 'floor', 'allow'] as const;
export type NegativeBalanceMode = (typeof NEGATIVE_BALANCE_MODES)[number];

export const COVERAGE_NOTE_MODES = ['off', 'optional', 'required'] as const;
export type CoverageNoteMode = (typeof COVERAGE_NOTE_MODES)[number];

export const ATTENDANCE_EVENT_TYPES = [
  'call_in',
  'tardy',
  'leaving_early',
  'other',
] as const;
export type AttendanceEventType = (typeof ATTENDANCE_EVENT_TYPES)[number];

export const POINT_EARNING_CLASSIFICATIONS = [
  'unexcused',
  'no_call_no_show',
] as const;
export type PointEarningClassification =
  (typeof POINT_EARNING_CLASSIFICATIONS)[number];

export const POINT_SEQUENCE_MODES = ['separate', 'combined'] as const;
export type PointSequenceMode = (typeof POINT_SEQUENCE_MODES)[number];

export const POINT_RESET_BASES = [
  'work_anniversary',
  'calendar_year',
  'rolling_12_months',
] as const;
export type PointResetBasis = (typeof POINT_RESET_BASES)[number];

/** The partial-day increments the request form offers (minutes). */
export const PARTIAL_DAY_INCREMENTS = [5, 10, 15, 30, 60] as const;

/**
 * Who a notification trigger reaches. Resolved at send time by the engines:
 * `branch_reviewers` are the `hr:write` holders in the employee's branch minus
 * the submitter, `hr_admins` the `agency:hr:admin` holders. If the submitter is
 * the only reviewer in their branch, `hr_admins` are notified instead (epic §9).
 */
export const ROUTING_RECIPIENTS = [
  'employee',
  'branch_reviewers',
  'hr_admins',
  'adjusting_admin',
] as const;
export type RoutingRecipient = (typeof ROUTING_RECIPIENTS)[number];

/**
 * Epic §9, one key per trigger. The HR engines emit these; nothing else.
 *
 * ⚠ `onboarding.pending` is **reserved, not consulted** (PAC-162): the
 * notification fires for a person who has no policy yet, so there is no
 * policy whose routing could apply. It is routed by a fixed rule — the
 * branch's `hr:write` holders, then the `agency:hr:admin` holders. The row
 * stays so a stored policy's `routing` keeps its shape.
 */
export const NOTIFICATION_TRIGGERS = [
  'timeoff.submitted',
  'timeoff.changes_requested',
  'timeoff.approved',
  'timeoff.declined',
  'timeoff.cancelled_by_admin',
  'timeoff.overdue',
  'timeoff.upcoming',
  'attendance.submitted',
  'attendance.classified',
  'pto.adjusted',
  'points.threshold',
  'onboarding.pending',
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

export interface LeaveTypeRule {
  /** Stable key a request stores; never renamed once used. */
  key: string;
  label: string;
  /** Whether a request of this type draws from the PTO balance. */
  drawsFromBalance: boolean;
  active: boolean;
}

export interface BlackoutRange {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  label: string;
}

export interface PointThreshold {
  points: number;
  recipients: RoutingRecipient[];
  /** Shown to the recipients with the contributing events. */
  guidance: string;
}

export interface LeavePolicyRules {
  leaveTypes: LeaveTypeRule[];
  reasons: {
    timeOff: string[];
    attendance: string[];
  };
  requests: {
    partialDayIncrementMinutes: number;
    coverageNote: CoverageNoteMode;
    acknowledgmentText: string;
    validation: {
      overlap: ValidationMode;
      closure: ValidationMode;
      nonScheduledDay: ValidationMode;
      advanceNotice: ValidationMode;
      blackout: ValidationMode;
    };
    /** Business days before the start; `null` = no rule (open with David). */
    advanceNoticeDays: number | null;
    blackoutRanges: BlackoutRange[];
  };
  pto: {
    annualAllocationHours: number;
    resetBasis: PtoResetBasis;
    /** `MM-DD`; required when `resetBasis === 'fiscal_year'`. */
    fiscalYearStart: string | null;
    proration: PtoProrationMode;
    carryover: {
      mode: CarryoverMode;
      /** Required when `mode === 'capped'`. */
      capHours: number | null;
      /** Days after the reset the carried hours expire; `null` = never. */
      expiryDays: number | null;
    };
    negativeBalance: {
      mode: NegativeBalanceMode;
      /** Required when `mode === 'floor'`: how far below zero is allowed. */
      floorHours: number | null;
    };
    reserveApprovedFutureLeave: boolean;
    /** Hours before the start an employee may still cancel an approved request. */
    employeeCancelCutoffHours: number;
  };
  reminders: {
    reminderBusinessDays: number;
    escalationBusinessDays: number;
    upcomingLeaveLeadBusinessDays: number;
  };
  attendance: {
    tardyGraceMinutes: number;
    eventTypes: AttendanceEventType[];
  };
  points: {
    enabled: boolean;
    earningClassifications: PointEarningClassification[];
    /** Points per occurrence in a cycle; the last value repeats. */
    ladders: {
      tardy: number[];
      absence: number[];
    };
    /** Fixed by the epic: NCNS counts on the absence ladder, leaving early on tardy. */
    mapping: {
      noCallNoShow: 'absence';
      leavingEarly: 'tardy';
    };
    sequences: PointSequenceMode;
    resetBasis: PointResetBasis;
    /** Ascending, unique `points`. */
    thresholds: PointThreshold[];
  };
  routing: Record<NotificationTrigger, RoutingRecipient[]>;
}

/**
 * SFA's spec values (David's spec v1.0, 2026-09-30), read through the epic's
 * §2 table. What a new policy is pre-filled with. The PTO allocation is a
 * placeholder until David names SFA's figure (plan, open question 3).
 */
export const DEFAULT_LEAVE_POLICY_RULES: LeavePolicyRules = {
  leaveTypes: [
    { key: 'paid', label: 'Paid', drawsFromBalance: true, active: true },
    { key: 'unpaid', label: 'Unpaid', drawsFromBalance: false, active: true },
  ],
  reasons: {
    timeOff: [
      'Illness',
      'Emergency',
      'Transportation',
      'Family',
      'Weather',
      'Appointment',
      'Other',
    ],
    attendance: [
      'Illness',
      'Emergency',
      'Transportation',
      'Family',
      'Weather',
      'Appointment',
      'Other',
    ],
  },
  requests: {
    partialDayIncrementMinutes: 15,
    coverageNote: 'optional',
    acknowledgmentText:
      'I confirm the dates and hours above are accurate and that my request is subject to review.',
    validation: {
      overlap: 'warn',
      closure: 'warn',
      nonScheduledDay: 'warn',
      advanceNotice: 'off',
      blackout: 'warn',
    },
    advanceNoticeDays: null,
    blackoutRanges: [],
  },
  pto: {
    annualAllocationHours: 80,
    resetBasis: 'calendar_year',
    fiscalYearStart: null,
    proration: 'none',
    carryover: { mode: 'off', capHours: null, expiryDays: null },
    negativeBalance: { mode: 'block', floorHours: null },
    reserveApprovedFutureLeave: true,
    employeeCancelCutoffHours: 24,
  },
  reminders: {
    reminderBusinessDays: 1,
    escalationBusinessDays: 2,
    upcomingLeaveLeadBusinessDays: 1,
  },
  attendance: {
    tardyGraceMinutes: 7,
    eventTypes: ['call_in', 'tardy', 'leaving_early', 'other'],
  },
  points: {
    enabled: true,
    earningClassifications: ['unexcused', 'no_call_no_show'],
    ladders: { tardy: [1, 2, 3, 4], absence: [2, 3, 4] },
    mapping: { noCallNoShow: 'absence', leavingEarly: 'tardy' },
    sequences: 'separate',
    resetBasis: 'work_anniversary',
    thresholds: [
      {
        points: 5,
        recipients: ['employee', 'hr_admins'],
        guidance:
          'Five attendance points in the current cycle. Review the contributing events with the employee.',
      },
      {
        points: 10,
        recipients: ['employee', 'hr_admins'],
        guidance:
          'Ten attendance points in the current cycle. Escalate per the agency handbook.',
      },
    ],
  },
  routing: {
    'timeoff.submitted': ['branch_reviewers'],
    'timeoff.changes_requested': ['employee'],
    'timeoff.approved': ['employee'],
    'timeoff.declined': ['employee'],
    'timeoff.cancelled_by_admin': ['employee'],
    'timeoff.overdue': ['branch_reviewers', 'hr_admins'],
    'timeoff.upcoming': ['employee', 'branch_reviewers'],
    'attendance.submitted': ['branch_reviewers'],
    'attendance.classified': ['employee'],
    'pto.adjusted': ['employee', 'adjusting_admin'],
    'points.threshold': ['employee', 'hr_admins'],
    'onboarding.pending': ['branch_reviewers'],
  },
};

export type LeavePolicyStatus = 'active' | 'archived';

export interface LeavePolicySummary {
  id: string;
  name: string;
  status: LeavePolicyStatus;
  /** Bumped on every edit; what a snapshot records. */
  version: number;
  /** `0` until PAC-162 attaches profiles. */
  employeeCount: number;
  /** ISO-8601. */
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface LeavePolicyView extends LeavePolicySummary {
  rules: LeavePolicyRules;
}

export interface LeavePoliciesResponse {
  policies: LeavePolicySummary[];
}

/**
 * `POST /hr/leave-policies`: a name, and optionally some of the rules —
 * every section left out is filled from {@link DEFAULT_LEAVE_POLICY_RULES}.
 * `PATCH` takes the same shape; a section left out is left alone.
 */
export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface UpsertLeavePolicyInput {
  name?: string;
  rules?: DeepPartial<LeavePolicyRules>;
}

/** What `LeavePolicyService.effectiveRules` returns for one employee. */
export interface EffectiveLeaveRules {
  policyId: string;
  policyName: string;
  policyVersion: number;
  /** Dotted paths the employee's overrides changed, e.g. `pto.annualAllocationHours`. */
  overriddenPaths: string[];
  rules: LeavePolicyRules;
}

/** What a posted record stores of the rules it was judged under. */
export interface LeavePolicySnapshot {
  policyId: string;
  policyName: string;
  policyVersion: number;
  /** ISO-8601 — when the snapshot was taken. */
  takenAt: string;
  rules: LeavePolicyRules;
}
