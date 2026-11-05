import { agencyTodayYmd } from "@/lib/dates";

/**
 * Calendar months as `YYYY-MM` — the pay month of the Payouts pages
 * (PAC-178). Plain strings on purpose: they sort and compare as months, and
 * they are what the API takes.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): boolean {
  return MONTH.test(value);
}

/** The agency's current month (its zone, the browser's as a fallback). */
export function agencyMonth(
  timeZone: string | undefined,
  now: Date = new Date(),
): string {
  return agencyTodayYmd(timeZone, now).slice(0, 7);
}

/** `month` moved by `delta` months, across year ends. */
export function addMonths(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  const anchor = new Date(Date.UTC(year, index, 1));
  return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "October 2026". */
export function formatMonth(month: string): string {
  if (!isMonth(month)) return month;
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `count` months ending with `latest`, newest first. */
export function recentMonths(latest: string, count: number): string[] {
  return Array.from({ length: count }, (_, back) => addMonths(latest, -back));
}
