import { hasAtMostTwoDecimals, MAX_PAYOUT_AMOUNT } from "@sfa/shared";
import { z } from "zod";
import { numericString } from "@/lib/zod-helpers";

/**
 * The numeric fields of the Payouts forms (PAC-177), as strings in form state
 * (`numericString` says why) with the cents rule the API applies too.
 */

export function moneyString(required: string) {
  return numericString({
    required,
    min: 0,
    max: MAX_PAYOUT_AMOUNT,
    tooSmall: "Cannot be negative",
    tooLarge: `At most $${MAX_PAYOUT_AMOUNT.toLocaleString("en-US")}`,
  }).refine(
    (value) => hasAtMostTwoDecimals(Number(value)),
    "At most two decimals",
  );
}

export function percentString(required: string) {
  return numericString({
    required,
    min: 0,
    max: 100,
    tooSmall: "Between 0 and 100",
    tooLarge: "Between 0 and 100",
  }).refine(
    (value) => hasAtMostTwoDecimals(Number(value)),
    "At most two decimals",
  );
}

/** A whole number from `min` to `max` — a count of months, days or referrals. */
export function wholeString(
  required: string,
  { min, max }: { min: number; max: number },
) {
  return numericString({
    required,
    min,
    max,
    tooSmall: `At least ${min}`,
    tooLarge: `At most ${max}`,
    integer: "Whole numbers only",
  });
}

/**
 * A field that may be left blank for "none": `""` passes, anything else must
 * satisfy `schema`. Read it back with {@link blankNumber}.
 */
export function blankOr(schema: z.ZodType<string>) {
  return z.string().superRefine((value, ctx) => {
    if (value.trim() === "") return;
    for (const issue of schema.safeParse(value).error?.issues ?? []) {
      ctx.addIssue({ code: "custom", message: issue.message });
    }
  });
}

/** A blank-for-none field as sent: `null` when blank, else the number. */
export function blankNumber(raw: string): number | null {
  return raw.trim() === "" ? null : Number(raw);
}

/** A number for a form field: `""` for nothing, otherwise as typed back. */
export function toField(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * The first message of a touched array field's meta — the cross-row rules
 * (duplicate carrier, tiers out of order, …) attach to the array itself.
 */
export function arrayMessage(meta: {
  isTouched: boolean;
  errors: unknown[];
}): string | undefined {
  if (!meta.isTouched) return undefined;
  const first = meta.errors[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "message" in first) {
    return String((first as { message: unknown }).message);
  }
  return undefined;
}
