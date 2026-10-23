import type { CalendarDayKind, Weekday } from "@sfa/shared";

/**
 * How a calendar day reads on screen (PAC-161). Token pairs only, on the
 * `X-600 dark:X-400` rule the lead and policy displays follow, so both themes
 * stay readable.
 */
export const DAY_KIND_LABELS: Record<CalendarDayKind, string> = {
  holiday: "Holiday",
  closure: "Closure",
  special_working_day: "Special working day",
};

export const DAY_KIND_CELL_CLASS: Record<CalendarDayKind, string> = {
  holiday: "bg-primary/15 text-primary font-semibold",
  closure: "bg-destructive/15 text-destructive font-semibold",
  special_working_day: "bg-success/15 text-success font-semibold",
};

export const DAY_KIND_SWATCH_CLASS: Record<CalendarDayKind, string> = {
  holiday: "bg-primary/60",
  closure: "bg-destructive/60",
  special_working_day: "bg-success/60",
};

export const SOURCE_LABELS = {
  onboarding: "Added at setup",
  import: "Imported",
  manual: "Added by hand",
  proposal: "Confirmed from a proposal",
} as const;

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
];

/** Monday-first, the way an office calendar reads. */
export const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_SHORT: Record<Weekday, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Sunday = 0, through a UTC anchor so the browser's zone cannot shift it. */
export function weekdayOf(year: number, month: number, day: number): Weekday {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday;
}

/** `'2026-11-26'` → `'Thu 26 Nov 2026'`, without touching the browser zone. */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${WEEKDAY_SHORT[weekdayOf(y, m, d)]} ${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}
