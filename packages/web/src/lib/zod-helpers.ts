import { z } from "zod";

/**
 * A numeric form field that stays a **string** in form state — which is what a
 * number input actually holds — and is converted at the submit boundary.
 *
 * The alternative, `z.coerce.number()`, turns an untouched `""` into `0`, which
 * passes `.min(0)`, so a producer who never filled the field silently submits a
 * $0 premium. `z.preprocess` fixes that but makes the schema's input type
 * `unknown`, which collapses the form's inferred field paths — the thing every
 * field component is checked against. Validating the string is the honest
 * version.
 *
 * Introduced for the Quote Recap form (PAC-39); shared once the Sold wizard
 * (PAC-40) needed the same guarantee on Card 4's premium and item count.
 */
export function numericString(options: {
  required: string;
  min: number;
  max: number;
  tooSmall: string;
  tooLarge: string;
  integer?: string;
}) {
  return z
    .string()
    .trim()
    .min(1, options.required)
    .refine((v) => !Number.isNaN(Number(v)), "Enter a number")
    .refine(
      (v) => options.integer == null || Number.isInteger(Number(v)),
      options.integer ?? "Whole numbers only",
    )
    .refine((v) => Number(v) >= options.min, options.tooSmall)
    .refine((v) => Number(v) <= options.max, options.tooLarge);
}
