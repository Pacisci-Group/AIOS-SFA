import type { DeepKeys } from "@tanstack/react-form";
import type { OfferedAccrualType } from "@sfa/shared";
import type { TimeOffFormValues } from "./time-off-form";

export type TimeOffStepId = "basics" | "settings" | "accrual" | "enrollment" | "review";

export interface TimeOffStep {
  id: TimeOffStepId;
  label: string;
  /**
   * The field paths this step owns, as path **roots** — the contract the
   * Onboard Agency wizard's `validateStep` uses: a nested field's error
   * blocks its own step rather than surfacing three pages later.
   */
  fields: Array<DeepKeys<TimeOffFormValues>>;
}

/** Gusto's five steps, in order. Data, so a step cannot forget its fields. */
export const TIME_OFF_STEPS: readonly TimeOffStep[] = [
  {
    id: "basics",
    label: "Basic setup",
    fields: ["name", "description", "compensation", "accrualType"],
  },
  {
    id: "settings",
    label: "Settings",
    fields: [
      "waitingPeriodEnabled",
      "waitingPeriodDays",
      "allowNegativeBalance",
      "payOutOnTermination",
    ],
  },
  {
    id: "accrual",
    label: "Accrual",
    fields: [
      "hoursPerYear",
      "accrualFrequency",
      "resetDateKind",
      "resetMonth",
      "resetDay",
      "maxBalanceHours",
      "carryoverCapHours",
      "annualUsageCapHours",
    ],
  },
  {
    id: "enrollment",
    label: "Enrollment",
    fields: ["memberIds", "setBalances", "startingBalanceHours"],
  },
  {
    id: "review",
    label: "Review",
    fields: [
      "autoApproveEnabled",
      "autoApproveMaxCalendarDays",
      "autoApproveMinNoticeDays",
    ],
  },
];

/** Unlimited has no balance to configure: the Accrual step disappears. */
export function visibleSteps(accrualType: OfferedAccrualType): readonly TimeOffStep[] {
  return accrualType === "unlimited"
    ? TIME_OFF_STEPS.filter((step) => step.id !== "accrual")
    : TIME_OFF_STEPS;
}
