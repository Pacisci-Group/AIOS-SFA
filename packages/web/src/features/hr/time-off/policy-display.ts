import {
  holidaysInYear,
  WEEKDAY_LABELS,
  type HolidayPolicyRules,
  type TimeOffPolicySummary,
  type TimeOffPolicyType,
  type WorkWeekDay,
} from "@sfa/shared";
import { CalendarHeart, Clock, Plane, type LucideIcon } from "lucide-react";

/**
 * What each policy type looks like on Settings → Time off (PAC-161 v3): the
 * card, the create route, and the one-line summary of a policy's rules.
 */
export interface PolicyTypeMeta {
  type: TimeOffPolicyType;
  /** Plural, for the card and the filtered list's heading. */
  label: string;
  /** Singular, for buttons and the wizard title. */
  singular: string;
  description: string;
  icon: LucideIcon;
  /** `null` while the type cannot be created yet. */
  createPath: string | null;
}

export const POLICY_TYPE_META: Record<TimeOffPolicyType, PolicyTypeMeta> = {
  holiday: {
    type: "holiday",
    label: "Holiday policies",
    singular: "holiday policy",
    description: "The days the office closes, every year.",
    icon: CalendarHeart,
    createPath: "/settings/time-off/new/holiday",
  },
  work_week: {
    type: "work_week",
    label: "Work week policies",
    singular: "work week policy",
    description: "The days and hours people work.",
    icon: Clock,
    createPath: "/settings/time-off/new/work-week",
  },
  time_off: {
    type: "time_off",
    label: "Time off policies",
    singular: "time off policy",
    description: "PTO, sick and unpaid leave, with hours per year.",
    icon: Plane,
    // PAC-174.
    createPath: null,
  },
};

export const POLICY_TYPE_ORDER: readonly TimeOffPolicyType[] = [
  "holiday",
  "work_week",
  "time_off",
];

/** Today as `YYYY-MM-DD` on this device — display only. */
export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const SHORT_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function utcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** `'Thu, Nov 26, 2026'`. */
export function formatDay(iso: string): string {
  return DAY_FORMAT.format(utcDate(iso));
}

/** `'Nov 26'`. */
export function formatShortDay(iso: string): string {
  return SHORT_FORMAT.format(utcDate(iso));
}

/** `'Dec 28 – Jan 2'`, or one day. */
export function formatRange(start: string, end: string): string {
  if (start === end) return formatShortDay(start);
  return `${formatShortDay(start)} – ${formatShortDay(end)}`;
}

/** The next closure a Holiday policy has, from today. */
export function nextHoliday(
  rules: HolidayPolicyRules,
  today: string,
): { date: string; name: string } | null {
  const year = Number(today.slice(0, 4));
  for (const candidate of [year, year + 1]) {
    const next = holidaysInYear(rules, candidate).find((row) => row.date >= today);
    if (next) return next;
  }
  return null;
}

/** Hours in a working day, e.g. 8 or 7.5. */
export function dayHours(day: Pick<WorkWeekDay, "start" | "end">): number {
  const minutes = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  return Math.max(0, minutes(day.end) - minutes(day.start)) / 60;
}

export function formatHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/** `'Mon–Fri'`, `'Mon, Wed, Fri'`. Days are consecutive when they say so. */
export function formatWeekdays(days: readonly WorkWeekDay[]): string {
  const sorted = [...days].map((d) => d.weekday).sort((a, b) => a - b);
  if (!sorted.length) return "No days";
  const short = (n: number) => WEEKDAY_LABELS[n as 0].slice(0, 3);
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (consecutive && sorted.length > 2) {
    return `${short(sorted[0])}–${short(sorted[sorted.length - 1])}`;
  }
  return sorted.map(short).join(", ");
}

/** `'9:00 AM'` from `'09:00'`. */
export function formatClock(value: string): string {
  const [h, m] = value.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** The rules column on the list. */
export function summarizePolicy(policy: TimeOffPolicySummary, today: string): string {
  if (policy.type === "holiday") {
    const year = Number(today.slice(0, 4));
    const count = holidaysInYear(policy.holiday, year).length;
    const next = nextHoliday(policy.holiday, today);
    const days = `${count} day${count === 1 ? "" : "s"} off in ${year}`;
    return next ? `${days} · next ${next.name}, ${formatShortDay(next.date)}` : days;
  }
  const days = policy.workWeek.days;
  const total = days.reduce((sum, day) => sum + dayHours(day), 0);
  const sameHours = days.every(
    (day) => day.start === days[0]?.start && day.end === days[0]?.end,
  );
  const hours = sameHours && days[0]
    ? `${formatClock(days[0].start)} – ${formatClock(days[0].end)}`
    : "varied hours";
  return `${formatWeekdays(days)} · ${hours} · ${formatHours(total)} a week`;
}
