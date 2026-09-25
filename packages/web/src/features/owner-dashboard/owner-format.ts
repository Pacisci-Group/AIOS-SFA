import type { OwnerDashboardPeriod } from "@/lib/owner-dashboard-api";
import { formatRangeLabel } from "@/lib/date-range";
import { NOT_AVAILABLE } from "@/lib/not-available";

/**
 * Formatting for the Owner dashboard (PAC-135).
 *
 * Kept out of the components for the reason `scorecard-format.ts` gives: the
 * `null` handling is a contract. The API returns `null` — never `0` — for a
 * figure that does not exist (an average over no households, a ratio over no
 * quotes), and rendering that as `$0` or `0%` would assert something false.
 */

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const COMPACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

/** `$185,834`. Whole dollars — nobody reads cents off a dashboard. */
export function formatMoney(value: number | null): string {
  return value === null ? NOT_AVAILABLE : CURRENCY.format(value);
}

/** `$1.9M` — for a sub line, where the full figure would crowd the card. */
export function formatMoneyCompact(value: number | null): string {
  return value === null ? NOT_AVAILABLE : COMPACT.format(value);
}

export function formatCount(value: number | null): string {
  return value === null ? NOT_AVAILABLE : value.toLocaleString("en-US");
}

/** `66.7%`, or `N/A`. */
export function formatPct(value: number | null): string {
  return value === null ? NOT_AVAILABLE : `${value.toLocaleString("en-US")}%`;
}

function spanDays(from: string, to: string): number {
  const day = (iso: string) => Date.parse(`${iso}T12:00:00.000Z`);
  return Math.round((day(to) - day(from)) / 86_400_000) + 1;
}

function monthName(iso: string): string {
  return new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}

/**
 * What a card is being compared with, in the owner's words.
 *
 * The server decides the window and echoes it; this only names it. Presets read
 * as the thing they are ("July", "same dates last year") rather than as a pair
 * of dates the reader has to decode — except `mtd`, where the dates *are* the
 * point: "Aug 1 – Aug 21" is what makes it clear the comparison is like for
 * like and not against the whole of August.
 */
export function comparisonLabel(period: OwnerDashboardPeriod): string {
  const { key, current, previous } = period;
  switch (key) {
    case "mtd":
      return formatRangeLabel(previous.from, previous.to);
    case "lastMonth":
      return monthName(previous.from);
    case "last3Months":
      return "previous 3 months";
    case "ytd":
      return "same dates last year";
    case "lastYear":
      return previous.from.slice(0, 4);
    case "custom": {
      const days = spanDays(current.from, current.to);
      return `previous ${days} day${days === 1 ? "" : "s"}`;
    }
  }
}

/** The exact comparison window, for a tooltip. */
export function comparisonDates(period: OwnerDashboardPeriod): string {
  return formatRangeLabel(period.previous.from, period.previous.to);
}
