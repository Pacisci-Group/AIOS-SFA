import { ALL_WEEKDAYS, CALENDAR_DAY_KINDS } from '@sfa/shared';
import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';
import { isValidIsoDate } from '../../performance/performance.range';

/** A calendar day as the calendar stores it. */
export const isoDate = z
  .string()
  .trim()
  .refine(isValidIsoDate, 'must be a real calendar date (YYYY-MM-DD)');

const year = z
  .number({ message: 'Choose a year.' })
  .int()
  .min(2000, 'Choose a year from 2000.')
  .max(2100, 'Choose a year up to 2100.');

/** Query strings arrive as text; a year is the one number here. */
const yearFromQuery = z.preprocess(
  (value) =>
    typeof value === 'string' && value !== '' ? Number(value) : value,
  year,
);

const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Country must be a two-letter code.');

const regionCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,10}$/, 'Region must be a short code.');

const reason = z
  .string()
  .trim()
  .min(1, 'Give a reason.')
  .max(500, 'Keep the reason under 500 characters.');

/** `GET /hr/calendar?year=`. Omitted → the agency's current year. */
export const calendarYearQuerySchema = z.object({
  year: yearFromQuery.optional(),
});
export type CalendarYearQueryDto = z.infer<typeof calendarYearQuerySchema>;

/** `PATCH /hr/calendar` — at least one of the three. */
export const updateAgencyCalendarSchema = z
  .object({
    workweek: z
      .array(z.number().int().min(0).max(6))
      .min(1, 'Pick at least one working day.')
      .max(7)
      .refine(
        (days) => new Set(days).size === days.length,
        'Each weekday once.',
      )
      .transform((days) =>
        [...new Set(days)]
          .sort((a, b) => a - b)
          .filter((day) => (ALL_WEEKDAYS as readonly number[]).includes(day)),
      )
      .optional(),
    country: countryCode.nullable().optional(),
    region: regionCode.nullable().optional(),
  })
  .refine(
    (body) =>
      body.workweek !== undefined ||
      body.country !== undefined ||
      body.region !== undefined,
    { message: 'Send a workweek, a country, a region, or several.' },
  );
export type UpdateAgencyCalendarDto = z.infer<
  typeof updateAgencyCalendarSchema
>;

const calendarDayInput = z.object({
  date: isoDate,
  kind: z.enum(CALENDAR_DAY_KINDS),
  label: z
    .string()
    .trim()
    .min(1, 'Give the day a label.')
    .max(120, 'Keep the label under 120 characters.'),
  reason: reason.optional(),
});

/**
 * `POST /hr/calendar/days`. A `manual` batch needs a reason on every row —
 * the audit trail for a hand change — and an `import` / `onboarding` one
 * carries none (the holiday's name is the whole story). Duplicate dates
 * within one batch are a 400; a date already on the calendar is the
 * service's 409.
 */
export const addCalendarDaysSchema = z
  .object({
    source: z.enum(['onboarding', 'import', 'manual']),
    days: z
      .array(calendarDayInput)
      .min(1, 'Add at least one day.')
      .max(400, 'At most 400 days per request.'),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.days.forEach((day, index) => {
      if (seen.has(day.date)) {
        ctx.addIssue({
          code: 'custom',
          path: ['days', index, 'date'],
          message: `${day.date} appears more than once.`,
        });
      }
      seen.add(day.date);
      if (body.source === 'manual' && !day.reason) {
        ctx.addIssue({
          code: 'custom',
          path: ['days', index, 'reason'],
          message: 'A reason is required for a manual change.',
        });
      }
    });
  });
export type AddCalendarDaysDto = z.infer<typeof addCalendarDaysSchema>;

/** `DELETE /hr/calendar/days/:id` — the body. */
export const removeCalendarDaySchema = z.object({ reason });
export type RemoveCalendarDayDto = z.infer<typeof removeCalendarDaySchema>;

export const calendarDayIdSchema = objectId;

/** `GET /hr/calendar/holiday-suggestions`. */
export const holidaySuggestionsQuerySchema = z.object({
  country: countryCode,
  region: regionCode.optional(),
  year: yearFromQuery,
});
export type HolidaySuggestionsQueryDto = z.infer<
  typeof holidaySuggestionsQuerySchema
>;

/** `GET /hr/calendar/holiday-regions`. */
export const holidayRegionsQuerySchema = z.object({
  country: countryCode.optional(),
});
export type HolidayRegionsQueryDto = z.infer<typeof holidayRegionsQuerySchema>;

/** `:year` on the proposal routes. */
export const proposalYearParamSchema = yearFromQuery;

/** `POST /hr/calendar/proposals/:year/confirm`. An empty list is allowed. */
export const confirmHolidayProposalSchema = z.object({
  dates: z.array(isoDate).max(400),
});
export type ConfirmHolidayProposalDto = z.infer<
  typeof confirmHolidayProposalSchema
>;
