/**
 * Round a currency amount to whole cents.
 *
 * Load-bearing wherever premiums are summed: `1200.10 + 899.95` is
 * `2100.0499999999997` in IEEE-754, and that value would land verbatim in the
 * Quoted and Sold scorecards. Legacy never hit this because Fillout handed it
 * pre-aggregated totals — computing them ourselves is exactly why it matters.
 */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Sum a list of currency amounts, rounded once at the end. */
export function sumCents(values: number[]): number {
  return roundCents(values.reduce((sum, value) => sum + value, 0));
}
