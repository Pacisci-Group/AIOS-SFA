/**
 * Formatting for the scorecards (PAC-10 / PAC-11).
 *
 * Split out of the components because the `null` handling is a contract, not a
 * presentation detail: the API returns `null` — never `0` — for an average with
 * no households behind it, and every caller must render that as an em dash
 * rather than as `$0.00`, which would assert something false.
 */

const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Whole dollars — the mockup shows `$42,500`, never cents. */
export function formatCurrency(value: number): string {
  return CURRENCY.format(value);
}

/** `$1,328`, or `—` when there is nothing to average. */
export function formatCurrencyOrDash(value: number | null): string {
  return value === null ? '—' : CURRENCY.format(value);
}

/** `2.1`, or `—`. One decimal, matching the mockup's items-per-household. */
export function formatDecimalOrDash(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

/** `1 Item` / `12 Items`. */
export function formatItems(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'Item' : 'Items'}`;
}
