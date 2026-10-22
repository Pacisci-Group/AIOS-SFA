import { z } from 'zod';

/**
 * A business date as a form submits it: `YYYY-MM-DD`, the shape an
 * `<input type="date">` holds (PAC-159). Shared by the Sold, Quote and Lead
 * write paths so the three cannot disagree about what a date is. The
 * *meaning* — which calendar, which instant it is stored as — is
 * `businessDateInstant`'s; the rules that bound it (not in the future, not
 * before the lead, a sale not before its quote) are `business-date-rules.ts`.
 */
export const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a real date');
