import {
  COMPENSATION_LABELS,
  monthlyAccrualHours,
  TIME_OFF_TYPE_LABELS,
  type TimeOffPolicyRules,
} from "@sfa/shared";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** `'01-01'` → `'January 1'`. */
export function monthDayLabel(monthDay: string): string {
  const [month, day] = monthDay.split("-").map(Number);
  return `${MONTH_NAMES[month - 1] ?? "?"} ${day}`;
}

/** `80` → `'80 h'`, `6.67` → `'6.67 h'`. */
export function formatBalance(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "Unlimited";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(2)} h`;
}

/** The reset date in words: "January 1" or "each person's hire anniversary". */
export function resetLabel(rules: TimeOffPolicyRules): string {
  if (rules.resetDateKind === "hire_anniversary") return "each person's hire anniversary";
  return rules.resetMonthDay ? monthDayLabel(rules.resetMonthDay) : "January 1";
}

/** How the hours arrive: "all at once on January 1" / "6.67 h on the 1st of each month". */
export function accrualLabel(rules: TimeOffPolicyRules): string {
  if (rules.accrualType === "unlimited") return "Unlimited";
  const hours = rules.hoursPerYear ?? 0;
  if (rules.accrualFrequency === "monthly") {
    return `${formatBalance(monthlyAccrualHours(hours))} on the 1st of each month, reset ${resetLabel(rules)}`;
  }
  return `all at once on ${resetLabel(rules)}`;
}

/** The list page's rules column: "80 h a year · all at once on January 1 · Paid". */
export function summarizeTimeOff(rules: TimeOffPolicyRules): string {
  const parts: string[] = [];
  if (rules.accrualType === "unlimited") {
    parts.push("Unlimited");
  } else if (rules.hoursPerYear === null) {
    parts.push("No hours set");
  } else {
    parts.push(`${formatBalance(rules.hoursPerYear)} a year`, accrualLabel(rules));
  }
  parts.push(COMPENSATION_LABELS[rules.compensation]);
  if (rules.timeOffType === "sick" && rules.annualUsageCapHours !== null) {
    parts.push(`${formatBalance(rules.annualUsageCapHours)} usage cap`);
  }
  return parts.join(" · ");
}

/** "Paid Time Off" / "Custom". */
export function timeOffKindLabel(rules: Pick<TimeOffPolicyRules, "timeOffType">): string {
  return TIME_OFF_TYPE_LABELS[rules.timeOffType];
}

/** `48` hours → `'2 days'`. */
export function noticeLabel(minNoticeHours: number | null): string {
  if (minNoticeHours === null) return "No minimum";
  const days = minNoticeHours / 24;
  if (Number.isInteger(days)) return `${days} day${days === 1 ? "" : "s"}`;
  return `${minNoticeHours} h`;
}
