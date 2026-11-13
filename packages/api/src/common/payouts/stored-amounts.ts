import { hasAtMostTwoDecimals, MAX_PAYOUT_AMOUNT } from '@sfa/shared';

/**
 * The payout number rules (`@sfa/shared` `domain/payouts.ts`) as Mongoose prop
 * options, for every schema that stores a payout amount or percentage —
 * `paymentStructures` and `Agency.payouts`.
 *
 * The zod DTOs refuse all of this first; these are the last line, so a write
 * that skips the DTO (a script, a later feature) cannot store a value the
 * statement would compute with differently. They apply on updates only with
 * `runValidators: true`, which every payouts update path passes.
 */

export const TWO_DECIMALS = {
  validator: (value: number) => hasAtMostTwoDecimals(value),
  message: 'Path `{PATH}` has more than two decimals.',
};

export const WHOLE_NUMBER = {
  validator: (value: number) => Number.isInteger(value),
  message: 'Path `{PATH}` must be a whole number.',
};

/** A dollar amount: 0 to `MAX_PAYOUT_AMOUNT`, at most two decimals. */
export const MONEY_PROP = {
  type: Number,
  min: 0,
  max: MAX_PAYOUT_AMOUNT,
  validate: TWO_DECIMALS,
};

/** A percentage: 0–100, at most two decimals. */
export const PERCENT_PROP = {
  type: Number,
  min: 0,
  max: 100,
  validate: TWO_DECIMALS,
};

/**
 * A percentage that may be `null` (a setting that is off, such as a minimum
 * bundle rate). Mongoose runs custom validators on `null` too — `min`/`max`
 * skip it, `TWO_DECIMALS` would not — so the decimals check lets it through.
 */
export const NULLABLE_PERCENT_PROP = {
  type: Number,
  min: 0,
  max: 100,
  default: null,
  validate: {
    validator: (value: number | null) =>
      value === null || hasAtMostTwoDecimals(value),
    message: TWO_DECIMALS.message,
  },
};
