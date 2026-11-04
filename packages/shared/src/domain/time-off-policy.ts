/**
 * Time off policies (PAC-174): the third HR policy type, in Gusto's shape.
 *
 * A time off policy is **one kind of time off** — PTO, Sick, Unpaid,
 * Bereavement or Custom — with a name, paid / unpaid, an accrual model and
 * the people enrolled in it. A person is in at most one policy of each
 * `timeOffType` (Custom excepted: it is Gusto's escape hatch, so someone may
 * be in several). Enrolling a person in a second policy of the same type
 * moves them, as Holiday and Work week policies already do.
 *
 * ## What is offered and what is reserved
 *
 * The payments epic (PAC-123) starts on this model, so every accrual setting
 * Gusto has is stored now even where nothing acts on it yet. Two values are
 * **reserved**: `hours_worked` (needs time tracking, PAC-167) and
 * `per_pay_period` (needs a pay schedule, PAC-123). They are in the enums so
 * offering them later is a one-line change to `OFFERED_*` with no migration,
 * and they are refused by the API's DTO until then.
 *
 * ## Locked after activation
 *
 * `compensation` and `accrualType: 'unlimited'` cannot change once a policy
 * is active (Gusto's rule, and the ledger's: an unlimited policy has no
 * balance to convert). Delete and recreate instead.
 *
 * ⚠ `time-off.ts` beside this file is the **legacy** SmartSuite vocabulary on
 * the migrated `timeOffRequests` rows (`'Unpaid' | 'PTO' | 'Sick'` labels).
 * Nothing is seeded from it; its `TimeOffType` is a label, this file's
 * `TimeOffTypeKey` is the policy key.
 */

export const TIME_OFF_TYPE_KEYS = [
  'pto',
  'sick',
  'unpaid',
  'bereavement',
  'custom',
] as const;
export type TimeOffTypeKey = (typeof TIME_OFF_TYPE_KEYS)[number];

export const COMPENSATIONS = ['paid', 'unpaid'] as const;
export type Compensation = (typeof COMPENSATIONS)[number];

export const ACCRUAL_TYPES = ['fixed_amount', 'unlimited', 'hours_worked'] as const;
export type AccrualType = (typeof ACCRUAL_TYPES)[number];

/** What the wizard offers; `hours_worked` waits for PAC-167. */
export const OFFERED_ACCRUAL_TYPES = ['fixed_amount', 'unlimited'] as const;
export type OfferedAccrualType = (typeof OFFERED_ACCRUAL_TYPES)[number];

export const ACCRUAL_FREQUENCIES = ['yearly', 'monthly', 'per_pay_period'] as const;
export type AccrualFrequency = (typeof ACCRUAL_FREQUENCIES)[number];

/** What the wizard offers; `per_pay_period` waits for PAC-123. */
export const OFFERED_ACCRUAL_FREQUENCIES = ['yearly', 'monthly'] as const;
export type OfferedAccrualFrequency = (typeof OFFERED_ACCRUAL_FREQUENCIES)[number];

export const RESET_DATE_KINDS = ['hire_anniversary', 'fixed'] as const;
export type ResetDateKind = (typeof RESET_DATE_KINDS)[number];

/** `MM-DD`: the same date for everyone, Gusto's default. */
export const DEFAULT_RESET_MONTH_DAY = '01-01';

/** Usage waiting period presets, in calendar days after hire. */
export const WAITING_PERIOD_PRESETS = [30, 60, 90] as const;
export const DEFAULT_WAITING_PERIOD_DAYS = 30;

export const TIME_OFF_DESCRIPTION_MAX_LENGTH = 500;
/** 24 × 365: an upper bound on any hours figure, not a business rule. */
export const TIME_OFF_HOURS_MAX = 8760;
/** Auto-approval: at most a year of calendar days, a year of notice. */
export const AUTO_APPROVE_MAX_CALENDAR_DAYS = 366;
export const AUTO_APPROVE_MAX_NOTICE_HOURS = 24 * 366;

export interface TimeOffTypeMeta {
  key: TimeOffTypeKey;
  /** The picker card and the type column. */
  label: string;
  /** Pre-filled policy name. */
  defaultName: string;
  description: string;
  defaultCompensation: Compensation;
  /** Unpaid Time Off is unpaid by definition; the rest choose until activation. */
  compensationLocked: boolean;
}

export const TIME_OFF_TYPE_META: Record<TimeOffTypeKey, TimeOffTypeMeta> = {
  pto: {
    key: 'pto',
    label: 'Paid Time Off',
    defaultName: 'Paid Time Off',
    description: 'Vacation and personal days, earned over the year.',
    defaultCompensation: 'paid',
    compensationLocked: false,
  },
  sick: {
    key: 'sick',
    label: 'Sick Leave',
    defaultName: 'Sick Leave',
    description: 'Time off when someone is ill, with an optional yearly usage cap.',
    defaultCompensation: 'paid',
    compensationLocked: false,
  },
  unpaid: {
    key: 'unpaid',
    label: 'Unpaid Time Off',
    defaultName: 'Unpaid Time Off',
    description: 'Tracked, never paid.',
    defaultCompensation: 'unpaid',
    compensationLocked: true,
  },
  bereavement: {
    key: 'bereavement',
    label: 'Bereavement',
    defaultName: 'Bereavement',
    description: 'Time off after a death in the family.',
    defaultCompensation: 'paid',
    compensationLocked: false,
  },
  custom: {
    key: 'custom',
    label: 'Custom',
    defaultName: 'Custom time off',
    description:
      'Anything else — jury duty, volunteering, a second policy of a kind someone is already in.',
    defaultCompensation: 'paid',
    compensationLocked: false,
  },
};

export const TIME_OFF_TYPE_LABELS: Record<TimeOffTypeKey, string> = Object.fromEntries(
  TIME_OFF_TYPE_KEYS.map((key) => [key, TIME_OFF_TYPE_META[key].label]),
) as Record<TimeOffTypeKey, string>;

export const COMPENSATION_LABELS: Record<Compensation, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
};

export const ACCRUAL_TYPE_LABELS: Record<AccrualType, string> = {
  fixed_amount: 'Fixed amount',
  unlimited: 'Unlimited',
  hours_worked: 'Hours worked',
};

export const ACCRUAL_FREQUENCY_LABELS: Record<AccrualFrequency, string> = {
  yearly: 'Yearly, all at once',
  monthly: 'Monthly',
  per_pay_period: 'Per pay period',
};

export const RESET_DATE_KIND_LABELS: Record<ResetDateKind, string> = {
  hire_anniversary: "Each person's hire anniversary",
  fixed: 'The same date for everyone',
};

// ── The rules ───────────────────────────────────────────────────────────

/** Gusto's two rules; a request must meet every rule that is set. */
export interface TimeOffAutoApprove {
  enabled: boolean;
  /** First day through last, weekends included. */
  maxCalendarDays: number | null;
  /** Hours between submission and the first day. */
  minNoticeHours: number | null;
}

/**
 * Everything a time off policy stores besides its name and people — the
 * ticket's §4 model, flat, so PAC-123's reader finds the names it was given.
 * Fields marked *reserved* are stored null until their feature exists.
 */
export interface TimeOffPolicyRules {
  timeOffType: TimeOffTypeKey;
  description: string | null;
  /** A label and a ledger flag only — no payroll here (PAC-123). Locked. */
  compensation: Compensation;
  /** `unlimited` is locked once active. */
  accrualType: AccrualType;
  /** Fixed amount: the total earned per year. */
  hoursPerYear: number | null;
  accrualFrequency: AccrualFrequency | null;
  resetDateKind: ResetDateKind | null;
  /** `MM-DD`, only when `resetDateKind` is `fixed`. */
  resetMonthDay: string | null;
  /** Reserved (hours worked): `accrualRate` hours per `accrualRateUnit` hours worked. */
  accrualRate: number | null;
  accrualRateUnit: number | null;
  maxBalanceHours: number | null;
  /** Reserved (hours worked). */
  maxAccruedPerYearHours: number | null;
  /** Hours that survive the reset; `0` = nothing carries; `null` = everything. */
  carryoverCapHours: number | null;
  /** Sick only: hours a person may *use* per year. */
  annualUsageCapHours: number | null;
  /** Usage waiting period: calendar days after hire before a request is allowed. */
  waitingPeriodDays: number | null;
  /** Reserved (hours worked). */
  accrualWaitingPeriodDays: number | null;
  allowNegativeBalance: boolean;
  /** Stored only; PAC-123 reads it. */
  payOutOnTermination: boolean;
  autoApprove: TimeOffAutoApprove;
}

/** The fields Unlimited nulls (Gusto's API rule). */
export const ACCRUAL_RULE_FIELDS = [
  'hoursPerYear',
  'accrualFrequency',
  'resetDateKind',
  'resetMonthDay',
  'accrualRate',
  'accrualRateUnit',
  'maxBalanceHours',
  'maxAccruedPerYearHours',
  'carryoverCapHours',
  'annualUsageCapHours',
] as const satisfies readonly (keyof TimeOffPolicyRules)[];

/** The fields locked once a policy is active. */
export const LOCKED_TIME_OFF_FIELDS = ['compensation', 'accrualType'] as const;

/** A new policy of `type`, before the admin touches anything. */
export function defaultTimeOffPolicyRules(type: TimeOffTypeKey): TimeOffPolicyRules {
  return {
    timeOffType: type,
    description: null,
    compensation: TIME_OFF_TYPE_META[type].defaultCompensation,
    accrualType: 'fixed_amount',
    hoursPerYear: null,
    accrualFrequency: 'yearly',
    resetDateKind: 'fixed',
    resetMonthDay: DEFAULT_RESET_MONTH_DAY,
    accrualRate: null,
    accrualRateUnit: null,
    maxBalanceHours: null,
    maxAccruedPerYearHours: null,
    carryoverCapHours: null,
    annualUsageCapHours: null,
    waitingPeriodDays: null,
    accrualWaitingPeriodDays: null,
    allowNegativeBalance: false,
    payOutOnTermination: false,
    autoApprove: { enabled: false, maxCalendarDays: null, minNoticeHours: null },
  };
}

/** `MM-DD` on a real calendar day of some year (29 Feb allowed). */
export function isValidMonthDay(value: string): boolean {
  const match = /^(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/**
 * Fills in what the chosen model makes meaningless, so two policies that
 * mean the same thing are stored the same way: Unlimited nulls every accrual
 * field and cannot pay out; an unpaid type is unpaid; a fixed reset date
 * is the only time `resetMonthDay` is kept; carryover has no meaning on a
 * lump sum granted on each person's own anniversary; the yearly cap on
 * usage is a Sick feature; auto-approval rules are dropped while it is off.
 */
export function normalizeTimeOffPolicyRules(rules: TimeOffPolicyRules): TimeOffPolicyRules {
  const next: TimeOffPolicyRules = {
    ...rules,
    description: rules.description?.trim() || null,
    autoApprove: { ...rules.autoApprove },
  };
  if (TIME_OFF_TYPE_META[next.timeOffType].compensationLocked) {
    next.compensation = TIME_OFF_TYPE_META[next.timeOffType].defaultCompensation;
  }
  if (next.accrualType === 'unlimited') {
    for (const field of ACCRUAL_RULE_FIELDS) next[field] = null;
    next.payOutOnTermination = false;
  }
  if (next.compensation === 'unpaid') next.payOutOnTermination = false;
  if (next.resetDateKind !== 'fixed') next.resetMonthDay = null;
  if (next.resetDateKind === 'hire_anniversary' && next.accrualFrequency === 'yearly') {
    next.carryoverCapHours = null;
  }
  if (next.timeOffType !== 'sick') next.annualUsageCapHours = null;
  if (!next.autoApprove.enabled) {
    next.autoApprove = { enabled: false, maxCalendarDays: null, minNoticeHours: null };
  }
  return next;
}

/**
 * The cross-field rules a single field's validation cannot express. One
 * source for the web form's `superRefine` and the API's DTO, so a policy the
 * wizard lets through is one the API accepts. Run on the normalized rules.
 * `null` when the rules hold together.
 */
export function timeOffPolicyRulesError(rules: TimeOffPolicyRules): string | null {
  const meta = TIME_OFF_TYPE_META[rules.timeOffType];
  if (meta.compensationLocked && rules.compensation !== meta.defaultCompensation) {
    return `${meta.label} is always ${COMPENSATION_LABELS[meta.defaultCompensation].toLowerCase()}.`;
  }
  if (rules.accrualType === 'fixed_amount') {
    if (!rules.hoursPerYear || rules.hoursPerYear <= 0) {
      return 'Enter the hours earned per year.';
    }
    if (!rules.accrualFrequency) return 'Choose how often the hours are earned.';
    if (!rules.resetDateKind) return 'Choose when the year resets.';
    if (rules.resetDateKind === 'fixed') {
      if (!rules.resetMonthDay || !isValidMonthDay(rules.resetMonthDay)) {
        return 'Choose the reset date.';
      }
    }
    if (
      rules.maxBalanceHours !== null &&
      rules.carryoverCapHours !== null &&
      rules.carryoverCapHours > rules.maxBalanceHours
    ) {
      return 'The carryover cap cannot be above the maximum balance.';
    }
  }
  if (rules.accrualType === 'unlimited' && rules.annualUsageCapHours !== null) {
    return 'An unlimited policy has no usage cap.';
  }
  if (rules.autoApprove.enabled) {
    const { maxCalendarDays, minNoticeHours } = rules.autoApprove;
    if (maxCalendarDays === null && minNoticeHours === null) {
      return 'Set at least one auto-approval rule, or turn auto-approval off.';
    }
  }
  return null;
}

// ── Suggested policies ──────────────────────────────────────────────────

export interface SuggestedTimeOffPolicy {
  key: Extract<TimeOffTypeKey, 'pto' | 'sick' | 'unpaid'>;
  name: string;
  /** The card's one line: "80 h a year". */
  summary: string;
  rules: TimeOffPolicyRules;
}

/**
 * The strip at the bottom of Settings → HR policies (Gusto's "Suggested
 * policies"). Clicking one opens the wizard pre-filled at Step 1; nothing is
 * saved until Activate.
 */
export const SUGGESTED_TIME_OFF_POLICIES: readonly SuggestedTimeOffPolicy[] = [
  {
    key: 'pto',
    name: 'Paid Time Off',
    summary: '80 hours a year, all at once on January 1',
    rules: { ...defaultTimeOffPolicyRules('pto'), hoursPerYear: 80 },
  },
  {
    key: 'sick',
    name: 'Sick Leave',
    summary: '40 hours a year, all at once on January 1',
    rules: { ...defaultTimeOffPolicyRules('sick'), hoursPerYear: 40, annualUsageCapHours: 40 },
  },
  {
    key: 'unpaid',
    name: 'Unpaid Time Off',
    summary: 'Unlimited, tracked but never paid',
    rules: normalizeTimeOffPolicyRules({
      ...defaultTimeOffPolicyRules('unpaid'),
      accrualType: 'unlimited',
    }),
  },
];
