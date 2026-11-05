/**
 * Money and percentages for the Payouts pages (PAC-176).
 *
 * Payouts is the first feature whose amounts are *cents-exact*: a commission,
 * a bonus, a chargeback. The dashboards' `formatMoney` copies round to whole
 * dollars, which is right for a sales total and wrong for a pay line — so
 * this one shows cents whenever there are any, and none when there are not
 * ("$50", "$12.50").
 *
 * Deliberately not a refactor of the per-feature copies: those round on
 * purpose, and changing them is a different change.
 */

const whole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const cents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `$50`, `$12.50`, `-$40.25`. Cents only when there are any. */
export function formatMoney(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? whole.format(rounded)
    : cents.format(rounded);
}

/** `10%`, `12.5%`. A percentage already on the 0–100 scale. */
export function formatPercent(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}
