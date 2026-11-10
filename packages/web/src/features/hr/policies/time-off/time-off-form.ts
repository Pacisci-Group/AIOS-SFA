import {
  COMPENSATIONS,
  DEFAULT_RESET_MONTH_DAY,
  DEFAULT_WAITING_PERIOD_DAYS,
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
  TIME_OFF_TYPE_META,
  timeOffPolicyRulesError,
  type Compensation,
  type HrPolicyView,
  type OfferedAccrualFrequency,
  type OfferedAccrualType,
  type ResetDateKind,
  type SuggestedTimeOffPolicy,
  type TimeOffPolicyRules,
  type TimeOffTypeKey,
  type UpdateHrPolicyInput,
} from "@sfa/shared";
import { z } from "zod";

/**
 * The time off wizard's form state (PAC-174).
 *
 * Numbers are **strings** here — the `NumberField` contract (see
 * `lib/zod-helpers.ts`): an untouched box is `""`, never a silent `0`. The
 * conversion to `TimeOffPolicyRules` happens once, in {@link toRules}, and the
 * cross-field rules run on that result through the same
 * `timeOffPolicyRulesError` the API uses, so what the wizard lets through is
 * what the API accepts.
 *
 * Each "toggle + field" setting is two values (`waitingPeriodEnabled` +
 * `waitingPeriodDays`), so switching a setting off keeps what was typed in
 * case it is switched back on; {@link toRules} sends `null` while it is off.
 */
export interface TimeOffFormValues {
  timeOffType: TimeOffTypeKey;
  name: string;
  description: string;
  compensation: Compensation;
  accrualType: OfferedAccrualType;
  hoursPerYear: string;
  accrualFrequency: OfferedAccrualFrequency;
  resetDateKind: ResetDateKind;
  /** `MM` and `DD`, two selects; joined into `resetMonthDay`. */
  resetMonth: string;
  resetDay: string;
  maxBalanceHours: string;
  carryoverCapHours: string;
  annualUsageCapHours: string;
  waitingPeriodEnabled: boolean;
  waitingPeriodDays: string;
  allowNegativeBalance: boolean;
  payOutOnTermination: boolean;
  autoApproveEnabled: boolean;
  autoApproveMaxCalendarDays: string;
  /** Entered in days, stored in hours. */
  autoApproveMinNoticeDays: string;
  memberIds: string[];
  setBalances: boolean;
  /** `{ userId: hours }`, blank = the policy's default. */
  startingBalanceHours: Record<string, string>;
}

const str = (value: number | null | undefined): string =>
  value === null || value === undefined ? "" : String(value);

/** A blank form for `type`, as the picker hands over. */
export function timeOffDefaults(
  type: TimeOffTypeKey,
  preset: SuggestedTimeOffPolicy | null = null,
): TimeOffFormValues {
  const meta = TIME_OFF_TYPE_META[type];
  const rules = preset?.rules;
  const [month, day] = (rules?.resetMonthDay ?? DEFAULT_RESET_MONTH_DAY).split("-");
  return {
    timeOffType: type,
    name: preset?.name ?? meta.defaultName,
    description: rules?.description ?? "",
    compensation: rules?.compensation ?? meta.defaultCompensation,
    accrualType: rules?.accrualType === "unlimited" ? "unlimited" : "fixed_amount",
    hoursPerYear: str(rules?.hoursPerYear),
    accrualFrequency: rules?.accrualFrequency === "monthly" ? "monthly" : "yearly",
    resetDateKind: rules?.resetDateKind ?? "fixed",
    resetMonth: month,
    resetDay: day,
    maxBalanceHours: str(rules?.maxBalanceHours),
    carryoverCapHours: str(rules?.carryoverCapHours),
    annualUsageCapHours: str(rules?.annualUsageCapHours),
    waitingPeriodEnabled: rules?.waitingPeriodDays != null,
    waitingPeriodDays: str(rules?.waitingPeriodDays ?? DEFAULT_WAITING_PERIOD_DAYS),
    allowNegativeBalance: rules?.allowNegativeBalance ?? false,
    payOutOnTermination: rules?.payOutOnTermination ?? false,
    autoApproveEnabled: rules?.autoApprove.enabled ?? false,
    autoApproveMaxCalendarDays: str(rules?.autoApprove.maxCalendarDays),
    autoApproveMinNoticeDays: str(
      rules?.autoApprove.minNoticeHours != null
        ? roundHours(rules.autoApprove.minNoticeHours / 24)
        : null,
    ),
    memberIds: [],
    setBalances: false,
    startingBalanceHours: {},
  };
}

/** The shape `withForm` steps are typed against. */
export const EMPTY_TIME_OFF: TimeOffFormValues = timeOffDefaults("pto");

/** An activated policy, back into the form for the edit drawers. */
export function fromPolicy(
  policy: Extract<HrPolicyView, { type: "time_off" }>,
): TimeOffFormValues {
  const rules = policy.timeOff;
  const [month, day] = (rules.resetMonthDay ?? DEFAULT_RESET_MONTH_DAY).split("-");
  return {
    timeOffType: rules.timeOffType,
    name: policy.name,
    description: rules.description ?? "",
    compensation: rules.compensation,
    accrualType: rules.accrualType === "unlimited" ? "unlimited" : "fixed_amount",
    hoursPerYear: str(rules.hoursPerYear),
    accrualFrequency: rules.accrualFrequency === "monthly" ? "monthly" : "yearly",
    resetDateKind: rules.resetDateKind ?? "fixed",
    resetMonth: month,
    resetDay: day,
    maxBalanceHours: str(rules.maxBalanceHours),
    carryoverCapHours: str(rules.carryoverCapHours),
    annualUsageCapHours: str(rules.annualUsageCapHours),
    waitingPeriodEnabled: rules.waitingPeriodDays !== null,
    waitingPeriodDays: str(rules.waitingPeriodDays ?? DEFAULT_WAITING_PERIOD_DAYS),
    allowNegativeBalance: rules.allowNegativeBalance,
    payOutOnTermination: rules.payOutOnTermination,
    autoApproveEnabled: rules.autoApprove.enabled,
    autoApproveMaxCalendarDays: str(rules.autoApprove.maxCalendarDays),
    autoApproveMinNoticeDays: str(
      rules.autoApprove.minNoticeHours !== null
        ? roundHours(rules.autoApprove.minNoticeHours / 24)
        : null,
    ),
    memberIds: policy.members.map((member) => member.id),
    setBalances: false,
    startingBalanceHours: {},
  };
}

const num = (value: string): number | null =>
  value.trim() === "" ? null : Number(value);

/** The wire rules, normalised the way the API stores them. */
export function toRules(values: TimeOffFormValues): TimeOffPolicyRules {
  const notice = num(values.autoApproveMinNoticeDays);
  return normalizeTimeOffPolicyRules({
    timeOffType: values.timeOffType,
    description: values.description.trim() || null,
    compensation: values.compensation,
    accrualType: values.accrualType,
    hoursPerYear: num(values.hoursPerYear),
    accrualFrequency: values.accrualFrequency,
    resetDateKind: values.resetDateKind,
    resetMonthDay: `${values.resetMonth}-${values.resetDay}`,
    accrualRate: null,
    accrualRateUnit: null,
    maxBalanceHours: num(values.maxBalanceHours),
    maxAccruedPerYearHours: null,
    carryoverCapHours: num(values.carryoverCapHours),
    annualUsageCapHours: num(values.annualUsageCapHours),
    waitingPeriodDays: values.waitingPeriodEnabled ? num(values.waitingPeriodDays) : null,
    accrualWaitingPeriodDays: null,
    allowNegativeBalance: values.allowNegativeBalance,
    payOutOnTermination: values.payOutOnTermination,
    autoApprove: {
      enabled: values.autoApproveEnabled,
      maxCalendarDays: values.autoApproveEnabled
        ? num(values.autoApproveMaxCalendarDays)
        : null,
      minNoticeHours:
        values.autoApproveEnabled && notice !== null ? roundHours(notice * 24) : null,
    },
  });
}

/** The balances the admin typed for the people ticked, in hours. */
export function toStartingBalances(
  values: TimeOffFormValues,
): Record<string, number> | undefined {
  if (!values.setBalances || values.accrualType === "unlimited") return undefined;
  const chosen = new Set(values.memberIds);
  const entries = Object.entries(values.startingBalanceHours)
    .filter(([id, hours]) => chosen.has(id) && hours.trim() !== "")
    .map(([id, hours]) => [id, roundHours(Number(hours))] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** The sections of the Review step and of the activated policy page. */
export type TimeOffSection =
  | "basics"
  | "settings"
  | "accrual"
  | "enrollment"
  | "autoApprove";

/** The `PATCH` body for one section's drawer: only that section's fields. */
export function toSectionPatch(
  section: TimeOffSection,
  values: TimeOffFormValues,
): UpdateHrPolicyInput {
  const rules = toRules(values);
  switch (section) {
    case "basics":
      return {
        name: values.name.trim(),
        timeOff: {
          description: rules.description,
          compensation: rules.compensation,
          accrualType: rules.accrualType,
        },
      };
    case "settings":
      return {
        timeOff: {
          waitingPeriodDays: rules.waitingPeriodDays,
          allowNegativeBalance: rules.allowNegativeBalance,
          payOutOnTermination: rules.payOutOnTermination,
        },
      };
    case "accrual":
      return {
        timeOff: {
          hoursPerYear: rules.hoursPerYear,
          accrualFrequency: rules.accrualFrequency,
          resetDateKind: rules.resetDateKind,
          resetMonthDay: rules.resetMonthDay,
          maxBalanceHours: rules.maxBalanceHours,
          carryoverCapHours: rules.carryoverCapHours,
          annualUsageCapHours: rules.annualUsageCapHours,
        },
      };
    case "autoApprove":
      return { timeOff: { autoApprove: rules.autoApprove } };
    case "enrollment":
      return {
        memberIds: values.memberIds,
        startingBalanceHours: toStartingBalances(values),
      };
  }
}

// ── Validation ──────────────────────────────────────────────────────────

const optionalNumber = z
  .string()
  .refine((v) => v.trim() === "" || !Number.isNaN(Number(v)), "Enter a number")
  .refine((v) => v.trim() === "" || Number(v) >= 0, "Cannot be negative")
  .refine(
    (v) => v.trim() === "" || Number(v) <= TIME_OFF_HOURS_MAX,
    `At most ${TIME_OFF_HOURS_MAX}`,
  );

const MONTH_DAY = /^\d{2}$/;

/**
 * Field-level rules plus the cross-field ones, each placed on the field the
 * admin can fix. The last check is the shared `timeOffPolicyRulesError`, so
 * a policy that passes here is one the API will store.
 */
export const timeOffFormSchema = z
  .object({
    timeOffType: z.enum(TIME_OFF_TYPE_KEYS),
    name: z
      .string()
      .trim()
      .min(1, "Give the policy a name.")
      .max(POLICY_NAME_MAX_LENGTH, `Keep the name under ${POLICY_NAME_MAX_LENGTH} characters.`),
    description: z
      .string()
      .max(TIME_OFF_DESCRIPTION_MAX_LENGTH, `Keep it under ${TIME_OFF_DESCRIPTION_MAX_LENGTH} characters.`),
    compensation: z.enum(COMPENSATIONS),
    accrualType: z.enum(OFFERED_ACCRUAL_TYPES),
    hoursPerYear: optionalNumber,
    accrualFrequency: z.enum(OFFERED_ACCRUAL_FREQUENCIES),
    resetDateKind: z.enum(RESET_DATE_KINDS),
    resetMonth: z.string().regex(MONTH_DAY),
    resetDay: z.string().regex(MONTH_DAY),
    maxBalanceHours: optionalNumber,
    carryoverCapHours: optionalNumber,
    annualUsageCapHours: optionalNumber,
    waitingPeriodEnabled: z.boolean(),
    waitingPeriodDays: optionalNumber,
    allowNegativeBalance: z.boolean(),
    payOutOnTermination: z.boolean(),
    autoApproveEnabled: z.boolean(),
    autoApproveMaxCalendarDays: optionalNumber,
    autoApproveMinNoticeDays: optionalNumber,
    memberIds: z.array(z.string()),
    setBalances: z.boolean(),
    startingBalanceHours: z.record(z.string(), z.string()),
  })
  .superRefine((values, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    if (values.accrualType === "fixed_amount") {
      const hours = num(values.hoursPerYear);
      if (hours === null || hours <= 0) {
        issue(["hoursPerYear"], "Enter the hours earned per year.");
      }
      if (
        values.resetDateKind === "fixed" &&
        !isValidMonthDay(`${values.resetMonth}-${values.resetDay}`)
      ) {
        issue(["resetDay"], "That day does not exist in that month.");
      }
      const max = num(values.maxBalanceHours);
      const carry = num(values.carryoverCapHours);
      if (max !== null && carry !== null && carry > max) {
        issue(["carryoverCapHours"], "The carryover cap cannot be above the maximum balance.");
      }
    }
    if (values.waitingPeriodEnabled) {
      const days = num(values.waitingPeriodDays);
      if (days === null || !Number.isInteger(days) || days < 1) {
        issue(["waitingPeriodDays"], "Enter the waiting period in whole days.");
      }
    }
    if (values.autoApproveEnabled) {
      const days = num(values.autoApproveMaxCalendarDays);
      const notice = num(values.autoApproveMinNoticeDays);
      if (days === null && notice === null) {
        issue(["autoApproveMaxCalendarDays"], "Set at least one rule, or turn auto-approval off.");
      }
      if (days !== null && (!Number.isInteger(days) || days < 1)) {
        issue(["autoApproveMaxCalendarDays"], "Whole days, at least 1.");
      }
    }
    if (values.setBalances) {
      for (const id of values.memberIds) {
        const typed = values.startingBalanceHours[id];
        if (typed === undefined || typed.trim() === "") continue;
        const hours = Number(typed);
        if (Number.isNaN(hours) || hours < 0) {
          issue(["startingBalanceHours", id], "Hours, zero or more.");
        }
      }
    }
    // The shared rule set, for anything the checks above did not already say.
    if (!ctx.issues.length) {
      const error = timeOffPolicyRulesError(toRules(values));
      if (error) issue(["hoursPerYear"], error);
    }
  });
